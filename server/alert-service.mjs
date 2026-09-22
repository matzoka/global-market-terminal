import { byId } from './instruments.mjs';

// P2-ALERT Phase A: incident evaluation + Discord notification.
//
// Design boundaries (per approval):
//   - All Discord/secret state comes from `env` (Cloudflare bindings), never
//     process.env / source / config / logs / git history.
//   - KV binding name: env.GMT_ALERT_STATE (optional; if absent, evaluation is
//     skipped with a console warning — GMT keeps serving normally).
//   - Discord Webhook URL: env.DISCORD_WEBHOOK_URL (optional; if absent, skip).
//   - Alert delivery failures MUST NOT affect dashboard/health/quote refresh.
//   - No dependency libraries; plain fetch to the webhook.

// ---------------------------------------------------------------------------
// GMT-UX-09: notification channel separation.
//
// Incidents, human approvals, and market signals have different audiences,
// urgency and noise budgets. They are separated by an explicit channel so a
// message never mixes two purposes and a future policy change (mute market
// signals, page on incidents) cannot accidentally affect the others. Only the
// system-alerts channel is wired today; approvals and market-signals exist as
// reserved, independently-addressable channels (GMT-UX-11 is out of scope).
export const ALERT_CHANNELS = Object.freeze({
  SYSTEM_ALERTS: Object.freeze({ id: 'system-alerts', label: 'システム障害', webhookEnv: 'DISCORD_WEBHOOK_URL', policy: 'severity=worst-value, 12h reminder, retry until delivered' }),
  APPROVALS: Object.freeze({ id: 'approvals', label: '承認・確認', webhookEnv: 'DISCORD_WEBHOOK_APPROVALS_URL', policy: 'human action required' }),
  MARKET_SIGNALS: Object.freeze({ id: 'market-signals', label: '市場シグナル', webhookEnv: 'DISCORD_WEBHOOK_MARKET_SIGNALS_URL', policy: 'watchlist thresholds, noise-limited' }),
});
const SYSTEM_CHANNEL = ALERT_CHANNELS.SYSTEM_ALERTS;

// The Cron trigger runs every 30min (wrangler.jsonc). A same-incident
// re-notification cooldown of 12h keeps this a "reminder", not a resend on
// every cron tick: the same unresolved incident notifies once, then again at
// most every 12h, regardless of how often evaluateAlerts runs meanwhile.
const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const CONSECUTIVE_THRESHOLD = 2; // 2 consecutive failures -> WARNING/CRITICAL
// UNAVAILABLE outages affecting fewer instruments than this stay WARNING (partial
// failure, rest of the dashboard still usable); at or above this many instruments
// in one incident, treat it as a broad/CRITICAL outage.
const CRITICAL_AFFECTED_THRESHOLD = 5;
// GMT-UX-01: a failed delivery must NOT be suppressed for the full 12h cooldown.
// Instead it is retried with bounded backoff (1m doubles up to 30m) until the
// webhook accepts the message, so an incident notification is not permanently lost.
const DELIVERY_RETRY_BASE_MS = 60 * 1000;
const DELIVERY_RETRY_MAX_MS = 30 * 60 * 1000;
const SEVERITY_RANK = Object.freeze({ INFO: 0, WARNING: 1, CRITICAL: 2 });

// Statuses that represent an actual data problem (not a normal quality label).
function isAbnormal(status) {
  return status === 'UNAVAILABLE' || status === 'STALE';
}

// GMT-UX-01: severity ordering is now explicit and monotonic —
// STALE is always LESS severe than UNAVAILABLE (the pre-fix logic could rank a
// STALE incident CRITICAL while a broad UNAVAILABLE stayed WARNING).
function severityForStatus(status, consecutive, affectedCount) {
  if (status === 'UNAVAILABLE') return affectedCount >= CRITICAL_AFFECTED_THRESHOLD ? 'CRITICAL' : 'WARNING';
  if (status === 'STALE') return consecutive >= CONSECUTIVE_THRESHOLD ? 'WARNING' : 'INFO';
  return 'INFO';
}
function worstSeverity(severities) {
  return severities.reduce((worst, value) => (SEVERITY_RANK[value] > SEVERITY_RANK[worst] ? value : worst), 'INFO');
}
// When one incident mixes STALE and UNAVAILABLE rows, the worst status wins
// instead of whichever row happened to be first in the array.
function worstStatus(statuses) {
  if (statuses.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (statuses.includes('STALE')) return 'STALE';
  return statuses[0] || 'UNKNOWN';
}
function deliveryBackoffMs(failures) {
  return Math.min(DELIVERY_RETRY_MAX_MS, DELIVERY_RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
}

function incidentKey(provider, reason, severity) {
  return `${provider}|${reason || 'unknown'}|${severity}`;
}

function rank(sev) {
  return SEVERITY_RANK[sev] || 0;
}

function mask(url) {
  // Avoid logging the secret webhook URL; keep only a short prefix for tracing.
  if (!url) return '<unset>';
  try { return new URL(url).host; } catch { return '<invalid>'; }
}

async function safeGet(kv, key) {
  try { return await kv.get(key, { type: 'json' }); } catch { return null; }
}
async function safePut(kv, key, value) {
  try { await kv.put(key, JSON.stringify(value)); } catch (err) {
    console.error(JSON.stringify({ event: 'alert_kv_write_failed', key, message: err.message }));
  }
}

export async function sendDiscordAlert(webhookUrl, text) {
  if (!webhookUrl) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ event: 'alert_delivery_failed', status: res.status, webhookHost: mask(webhookUrl) }));
    }
    return res.ok;
  } catch (err) {
    console.error(JSON.stringify({ event: 'alert_delivery_failed', message: err.message, webhookHost: mask(webhookUrl) }));
    return false;
  }
}

// Metals are the one instrument group whose registered `name` is still English
// (GOLD/SILVER/PLATINUM/PALLADIUM) — this is the group the reported incident
// actually affects, so it gets an explicit Japanese label. Every other group
// (FX/crypto/ETF) already has a Japanese `name` in instruments.mjs; indices and
// equities fall back to their (English) registered name plus the ID, which is
// still unambiguous even if not fully localized.
const METAL_JP_NAMES = { XAU: '金', XAG: '銀', XPT: 'プラチナ', XPD: 'パラジウム' };

function displayName(id) {
  const label = METAL_JP_NAMES[id] || byId.get(id)?.name || id;
  return `${label}（${id}）`;
}

function severityLabel(severity) {
  return severity === 'CRITICAL' ? '重大' : severity === 'WARNING' ? '警告' : severity;
}

function statusLabel(status) {
  if (status === 'UNAVAILABLE') return 'データ取得不能';
  if (status === 'STALE') return 'データが更新されていません（古いデータ）';
  return status;
}

// Known failure reasons rendered in plain Japanese. Unrecognized reasons
// (including new `provider_http_NNN` status codes) fall back to a generic
// message that still surfaces the raw reason code for follow-up.
function reasonLabel(reason) {
  const httpMatch = /^provider_http_(\d+)$/.exec(reason || '');
  if (httpMatch) return `データ提供元が HTTP ${httpMatch[1]} を返しました`;
  const known = {
    provider_request_failed: 'データ提供元への通信に失敗しました',
    provider_returned_no_quote: 'データ提供元から有効な価格が返されませんでした',
    provider_invalid_payload: 'データ提供元の応答形式が不正です',
    not_covered_by_configured_sources: '有効なデータ取得元が設定されていません',
    metals_spot_cache_empty: '貴金属スポット価格のキャッシュが空です',
    metals_spot_unavailable: '貴金属スポット価格を取得できていません',
  };
  if (reason && known[reason]) return known[reason];
  return reason ? `不明な障害（${reason}）` : '不明な障害';
}

// Renders an ISO timestamp as JST (UTC+9), e.g. "2026-09-08 15:30 JST".
function toJst(iso) {
  const date = new Date(iso || '');
  if (Number.isNaN(date.getTime())) return iso || '不明';
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())} JST`;
}

function formatAlert({ severity, channel, provider, affected, status, reason, firstDetected, count, total }) {
  return [
    `⚠️ Global Market Terminal — データ取得障害（${severityLabel(severity)}）`,
    '',
    `通知チャネル：#${channel || SYSTEM_CHANNEL.id}（${ALERT_CHANNELS.SYSTEM_ALERTS.label}）`,
    '',
    `データ提供元：`,
    provider,
    '',
    `対象：`,
    affected.map(displayName).join('\n'),
    '',
    `状態：`,
    statusLabel(status),
    '',
    `原因：`,
    reasonLabel(reason),
    '',
    `初回検出：`,
    toJst(firstDetected),
    '',
    `影響：`,
    `${total}項目中${count}項目`,
    '',
    // Describe the ACTUAL behaviour implemented in evaluateAlerts():
    // within the cooldown the incident is re-notified only when it escalates
    // (or after a recovery), and an unresolved incident is re-notified every
    // ALERT_COOLDOWN_MS (12h). Earlier wording claimed "no re-notification
    // while ongoing", which contradicted the 12h reminder users receive.
    `※同一障害が継続中の場合、12時間ごとにこの通知を再送します`,
    `※重症度が上がった場合は、12時間を待たずに再通知します`,
    `※復旧時に再度通知します`,
  ].join('\n');
}

function formatRecovery({ channel, provider, affected, firstDetected, recoveredAt, durationMinutes }) {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  const durationLabel = hours > 0 ? `${hours}時間${minutes}分` : `${minutes}分`;
  return [
    `✅ Global Market Terminal — 復旧`,
    '',
    `通知チャネル：#${channel || SYSTEM_CHANNEL.id}（${ALERT_CHANNELS.SYSTEM_ALERTS.label}）`,
    '',
    `データ提供元：`,
    provider,
    '',
    `対象：`,
    affected.map(displayName).join('\n'),
    '',
    `障害開始：`,
    toJst(firstDetected),
    '',
    `復旧：`,
    toJst(recoveredAt),
    '',
    `障害継続時間：`,
    durationLabel,
  ].join('\n');
}

// Evaluate inspection rows (from market-service.refreshAndInspect) and emit
// Discord alerts as needed. Resilient to missing KV / webhook env bindings.
export async function evaluateAlerts(rows, env = {}, ctx = {}) {
  const kv = env.GMT_ALERT_STATE || null;
  const webhookUrl = env.DISCORD_WEBHOOK_URL || null;
  if (!kv) {
    console.warn(JSON.stringify({ event: 'alert_eval_skipped', reason: 'GMT_ALERT_STATE KV binding not configured' }));
    return { evaluated: rows.length, alertsSent: 0, recovered: 0 };
  }

  const total = rows.length;
  const nowMs = Date.now();

  // Keys already stored in KV (for recovery detection).
  let storedKeys = new Set();
  try {
    const listed = await kv.list?.();
    storedKeys = new Set((listed?.keys || []).map((k) => k.name));
  } catch { storedKeys = new Set(); }

  // Group abnormal rows by provider+reason.
  const groups = new Map();
  for (const row of rows) {
    if (!isAbnormal(row.status)) continue;
    const key = `${row.provider}|${row.reason || 'unknown'}`;
    if (!groups.has(key)) groups.set(key, { provider: row.provider, reason: row.reason, rows: [] });
    groups.get(key).rows.push(row);
  }

  let alertsSent = 0;
  let recovered = 0;
  const activeGroupKeys = new Set(groups.keys());

  for (const [groupKey, group] of groups) {
    const affected = group.rows.map((r) => r.id);
    const statuses = [...new Set(group.rows.map((r) => r.status))];
    const status = worstStatus(statuses);
    const stored = await safeGet(kv, groupKey);
    const consecutive = (stored && stored.status === status) ? (stored.consecutiveFailures || 0) + 1 : 1;
    // GMT-UX-01: severity is the WORST across every status present in the
    // incident, so a mixed STALE+UNAVAILABLE incident can no longer be decided by
    // whichever row happened to be first.
    const severity = worstSeverity(statuses.map((value) => severityForStatus(value, consecutive, affected.length)));

    if (severity === 'INFO') {
      // Record only; no Discord notification.
      await safePut(kv, groupKey, {
        channel: SYSTEM_CHANNEL.id, provider: group.provider, status, reason: group.reason, consecutiveFailures: consecutive,
        firstDetectedAt: stored?.firstDetectedAt || new Date(nowMs).toISOString(),
        lastDetectedAt: new Date(nowMs).toISOString(),
        lastAlertAt: stored?.lastAlertAt || null,
        severity, affected, alerted: stored?.alerted || false, recoveryNotified: false,
        deliveryFailures: stored?.deliveryFailures || 0, nextAttemptAt: null,
      });
      continue;
    }

    const lastAlertAt = stored?.lastAlertAt ? Date.parse(stored.lastAlertAt) : 0;
    const inCooldown = nowMs - lastAlertAt < ALERT_COOLDOWN_MS;
    // Escalate (re-notify within cooldown) when severity worsens, or when this is
    // a fresh occurrence after a prior recovery (stored status RECOVERED).
    const escalated = (stored?.status === 'RECOVERED') || (stored?.severity && rank(stored.severity) < rank(severity));
    // A failed delivery schedules a short retry; a successful alert is governed
    // by the 12h reminder cooldown instead.
    const nextAttemptAt = stored?.nextAttemptAt ? Date.parse(stored.nextAttemptAt) : 0;
    const deliveryRequired = Boolean(webhookUrl);
    const shouldAttempt = deliveryRequired && (!inCooldown || escalated) && !(nowMs < nextAttemptAt);

    let delivered = false;
    if (shouldAttempt) {
      const text = formatAlert({
        severity, channel: SYSTEM_CHANNEL.id, provider: group.provider, affected, status, reason: group.reason,
        firstDetected: stored?.firstDetectedAt || new Date(nowMs).toISOString(),
        count: affected.length, total,
      });
      delivered = await sendDiscordAlert(webhookUrl, text);
      if (delivered) alertsSent++;
    }

    // GMT-UX-01: "sent" is recorded ONLY when delivery actually succeeded (or no
    // channel is configured, so there is nothing to deliver). A configured channel
    // that FAILED does not start the 12h cooldown and is retried with bounded
    // backoff, so an incident notification is never silently lost for 12h.
    const succeeded = delivered || !deliveryRequired;
    const deliveryFailures = succeeded ? 0 : (stored?.deliveryFailures || 0) + (shouldAttempt ? 1 : 0);
    await safePut(kv, groupKey, {
      channel: SYSTEM_CHANNEL.id, provider: group.provider, status, reason: group.reason, consecutiveFailures: consecutive,
      firstDetectedAt: stored?.firstDetectedAt || new Date(nowMs).toISOString(),
      lastDetectedAt: new Date(nowMs).toISOString(),
      lastAlertAt: succeeded ? new Date(nowMs).toISOString() : (stored?.lastAlertAt || null),
      severity, affected, alerted: succeeded ? true : Boolean(stored?.alerted), recoveryNotified: false,
      deliveryFailures,
      nextAttemptAt: succeeded ? null : (shouldAttempt ? new Date(nowMs + deliveryBackoffMs(deliveryFailures)).toISOString() : (stored?.nextAttemptAt || null)),
    });
  }

  // Recovery: stored incidents no longer present in the current abnormal groups.
  for (const groupKey of storedKeys) {
    // Skip the Metals.Dev spot cache key (METALS_DEV_SPOT), which is NOT an
    // incident record — it is the Cron-written quote cache and must never be
    // treated as a recoverable incident.
    if (groupKey === 'metals_dev_spot') continue;
    if (activeGroupKeys.has(groupKey)) continue;
    const stored = await safeGet(kv, groupKey);
    if (!stored || stored.recoveryNotified || !stored.alerted) continue;
    const durationMin = stored.firstDetectedAt
      ? Math.max(0, Math.round((nowMs - Date.parse(stored.firstDetectedAt)) / 60000))
      : 0;
    const text = formatRecovery({
      channel: stored.channel || SYSTEM_CHANNEL.id,
      provider: stored.provider || groupKey.split('|')[0],
      affected: stored.affected || [],
      firstDetected: stored.firstDetectedAt,
      recoveredAt: new Date(nowMs).toISOString(),
      durationMinutes: durationMin,
    });
    // GMT-UX-01: only mark the incident recovered once recovery delivery
    // succeeded (or no channel is configured); otherwise retry with backoff.
    const backoffUntil = stored.nextAttemptAt ? Date.parse(stored.nextAttemptAt) : 0;
    const deliveryRequired = Boolean(webhookUrl);
    let delivered = false;
    if (deliveryRequired && !(nowMs < backoffUntil)) {
      delivered = await sendDiscordAlert(webhookUrl, text);
      if (delivered) recovered++;
    }
    const succeeded = delivered || !deliveryRequired;
    const deliveryFailures = succeeded ? 0 : (stored.deliveryFailures || 0) + (nowMs < backoffUntil ? 0 : 1);
    await safePut(kv, groupKey, {
      ...stored,
      channel: stored.channel || SYSTEM_CHANNEL.id,
      recoveryNotified: succeeded,
      status: succeeded ? 'RECOVERED' : stored.status,
      consecutiveFailures: succeeded ? 0 : stored.consecutiveFailures,
      deliveryFailures,
      nextAttemptAt: succeeded ? null : new Date(nowMs + deliveryBackoffMs(deliveryFailures)).toISOString(),
    });
  }

  return { evaluated: total, alertsSent, recovered };
}
