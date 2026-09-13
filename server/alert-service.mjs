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

// Statuses that represent an actual data problem (not a normal quality label).
function isAbnormal(status) {
  return status === 'UNAVAILABLE' || status === 'STALE';
}

function severityFor({ status, consecutive, affectedCount }) {
  if (status === 'UNAVAILABLE') return affectedCount >= CRITICAL_AFFECTED_THRESHOLD ? 'CRITICAL' : 'WARNING';
  if (status === 'STALE') {
    if (consecutive >= CONSECUTIVE_THRESHOLD) return affectedCount >= 2 ? 'CRITICAL' : 'WARNING';
    return 'INFO'; // single STALE first failure: record only
  }
  return 'INFO';
}

function incidentKey(provider, reason, severity) {
  return `${provider}|${reason || 'unknown'}|${severity}`;
}

function rank(sev) {
  return sev === 'CRITICAL' ? 3 : sev === 'WARNING' ? 2 : 1;
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

function formatAlert({ severity, provider, affected, status, reason, firstDetected, count, total }) {
  return [
    `⚠️ Global Market Terminal — データ取得障害（${severityLabel(severity)}）`,
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
    `※同一障害の継続中は再通知しません（内容が変化した場合を除く）`,
    `※復旧時に再度通知します`,
  ].join('\n');
}

function formatRecovery({ provider, affected, firstDetected, recoveredAt, durationMinutes }) {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  const durationLabel = hours > 0 ? `${hours}時間${minutes}分` : `${minutes}分`;
  return [
    `✅ Global Market Terminal — 復旧`,
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
    const status = group.rows[0].status;
    const stored = await safeGet(kv, groupKey);
    const consecutive = (stored && stored.status === status) ? (stored.consecutiveFailures || 0) + 1 : 1;
    const severity = severityFor({ status, consecutive, affectedCount: affected.length });

    if (severity === 'INFO') {
      // Record only; no Discord notification.
      await safePut(kv, groupKey, {
        status, reason: group.reason, consecutiveFailures: consecutive,
        firstDetectedAt: stored?.firstDetectedAt || new Date(nowMs).toISOString(),
        lastDetectedAt: new Date(nowMs).toISOString(),
        lastAlertAt: stored?.lastAlertAt || null,
        severity, affected, alerted: stored?.alerted || false, recoveryNotified: false,
      });
      continue;
    }

    const lastAlertAt = stored?.lastAlertAt ? Date.parse(stored.lastAlertAt) : 0;
    const inCooldown = nowMs - lastAlertAt < ALERT_COOLDOWN_MS;
    // Escalate (re-notify within cooldown) when severity worsens, or when this is
    // a fresh occurrence after a prior recovery (stored status RECOVERED).
    const escalated = (stored?.status === 'RECOVERED') || (stored?.severity && rank(stored.severity) < rank(severity));

    if (!inCooldown || escalated) {
      const text = formatAlert({
        severity, provider: group.provider, affected, status, reason: group.reason,
        firstDetected: stored?.firstDetectedAt || new Date(nowMs).toISOString(),
        count: affected.length, total,
      });
      const ok = await sendDiscordAlert(webhookUrl, text);
      if (ok) alertsSent++;
    }

    await safePut(kv, groupKey, {
      status, reason: group.reason, consecutiveFailures: consecutive,
      firstDetectedAt: stored?.firstDetectedAt || new Date(nowMs).toISOString(),
      lastDetectedAt: new Date(nowMs).toISOString(),
      lastAlertAt: (inCooldown && !escalated) ? (stored?.lastAlertAt || null) : new Date(nowMs).toISOString(),
      severity, affected, alerted: true, recoveryNotified: false,
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
      provider: stored.provider || groupKey.split('|')[0],
      affected: stored.affected || [],
      firstDetected: stored.firstDetectedAt,
      recoveredAt: new Date(nowMs).toISOString(),
      durationMinutes: durationMin,
    });
    const ok = await sendDiscordAlert(webhookUrl, text);
    if (ok) recovered++;
    await safePut(kv, groupKey, { ...stored, recoveryNotified: true, status: 'RECOVERED', consecutiveFailures: 0 });
  }

  return { evaluated: total, alertsSent, recovered };
}
