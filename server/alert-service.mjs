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

const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // same incident re-notification suppressed 30min
const CONSECUTIVE_THRESHOLD = 2; // 2 consecutive failures -> WARNING/CRITICAL

// Statuses that represent an actual data problem (not a normal quality label).
function isAbnormal(status) {
  return status === 'UNAVAILABLE' || status === 'STALE';
}

function severityFor({ status, consecutive, affectedCount }) {
  if (status === 'UNAVAILABLE') return 'CRITICAL';
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

function formatAlert({ severity, provider, affected, status, reason, firstDetected, count, total }) {
  return [
    `GMT ALERT — ${severity}`,
    '',
    `Provider:`,
    `${provider}`,
    '',
    `Affected:`,
    `${affected.join(', ')}`,
    '',
    `Status:`,
    `${status}`,
    '',
    `Reason:`,
    `${reason || 'unknown'}`,
    '',
    `First detected:`,
    `${firstDetected}`,
    '',
    `Affected count:`,
    `${count}/${total}`,
  ].join('\n');
}

function formatRecovery({ provider, affected, recoveredAt, durationMinutes }) {
  return [
    `GMT RECOVERED`,
    '',
    `Provider:`,
    `${provider}`,
    '',
    `Affected:`,
    `${affected.join(', ')}`,
    '',
    `Recovered:`,
    `${recoveredAt}`,
    '',
    `Duration:`,
    `${durationMinutes} minutes`,
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
    if (activeGroupKeys.has(groupKey)) continue;
    const stored = await safeGet(kv, groupKey);
    if (!stored || stored.recoveryNotified || !stored.alerted) continue;
    const durationMin = stored.firstDetectedAt
      ? Math.max(0, Math.round((nowMs - Date.parse(stored.firstDetectedAt)) / 60000))
      : 0;
    const text = formatRecovery({
      provider: stored.provider || groupKey.split('|')[0],
      affected: stored.affected || [],
      recoveredAt: new Date(nowMs).toISOString(),
      durationMinutes: durationMin,
    });
    const ok = await sendDiscordAlert(webhookUrl, text);
    if (ok) recovered++;
    await safePut(kv, groupKey, { ...stored, recoveryNotified: true, status: 'RECOVERED', consecutiveFailures: 0 });
  }

  return { evaluated: total, alertsSent, recovered };
}
