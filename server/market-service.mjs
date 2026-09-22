import { config, primaryProviderReady } from './config.mjs';
import { instruments, byId, indexIds, metalIds, sectorIds, researchIds } from './instruments.mjs';
import { createAlpacaProvider } from './providers/alpaca.mjs';
import { createEodhdProvider } from './providers/eodhd.mjs';
import { createMetalsDevProvider } from './providers/metals-dev.mjs';
import { createTwelveDataProvider } from './providers/twelvedata.mjs';
import { createCoinGeckoProvider } from './providers/coingecko.mjs';
import { createFrankfurterProvider } from './providers/frankfurter.mjs';
import { createYahooFtseProvider } from './providers/yahoo-ftse.mjs';
import { createYahooMetalFuturesProvider } from './providers/yahoo-metal-futures.mjs';
import { createYahooIndexProvider } from './providers/yahoo-index.mjs';

let snapshots = new Map();
let bars = new Map();
let lastRefreshAt = 0;
const barRequests = new Map();
const barCacheMs = 15 * 60 * 1000;
let metalsKv = null;
const METALS_SPOT_KEY = 'metals_dev_spot';
// Metals.Dev Free tier = 100 requests/month. Acquisition is Cron-only with a
// 12h cooldown so the WHOLE account (all isolates) targets ~60-62 req/month,
// leaving generous headroom. NOTE: Workers KV is eventually consistent and is NOT
// a strict distributed lock, so this is a target, not a hard guarantee.
const METALS_COOLDOWN_MS = 12 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// GMT-UX-02: freshness / health contract.
//
// A quote's delivery status (PARTIAL_REALTIME / REALTIME / EOD / ...) describes
// provenance, NOT whether our cached copy is current. Freshness is a separate,
// single signal that answers "may I trust this value right now?":
//
//   FRESH       : successfully refreshed within the provider's TTL.
//   STALE       : last-known-good retained past its TTL (or provider failure).
//   UNKNOWN     : never evaluated in this instance (cold isolate / not loaded).
//   UNAVAILABLE : no usable value and no last-known-good to fall back to.
//
// UNKNOWN must never be presented as normal. FRESHNESS_ORDER is the single
// "worst wins" ordering used by the header, cards and badges so mixed states
// cannot be decided by array position.
export const FRESHNESS = Object.freeze({ FRESH: 'FRESH', STALE: 'STALE', UNKNOWN: 'UNKNOWN', UNAVAILABLE: 'UNAVAILABLE' });
export const FRESHNESS_ORDER = Object.freeze([FRESHNESS.FRESH, FRESHNESS.UNKNOWN, FRESHNESS.STALE, FRESHNESS.UNAVAILABLE]);
const FRESHNESS_RANK = Object.freeze(Object.fromEntries(FRESHNESS_ORDER.map((value, index) => [value, index])));

export function worstFreshness(values) {
  return values.reduce((worst, value) => (FRESHNESS_RANK[value] > FRESHNESS_RANK[worst] ? value : worst), FRESHNESS.FRESH);
}

const primaryProvider = !primaryProviderReady() ? null
  : config.provider === 'alpaca' ? createAlpacaProvider(config.alpacaApiKeyId, config.alpacaApiSecretKey)
  : createTwelveDataProvider(config.twelveDataApiKey);
const providers = [
  createCoinGeckoProvider(),
  primaryProvider,
  // When Alpaca remains the primary U.S. equity source, a configured Twelve
  // Data key can still cover the separate FX research universe.
  // Basic-plan credits are intentionally reserved for the five FX pairs;
  // the primary/equity, EOD index and metals providers retain their own
  // coverage instead of consuming the FX quota in one oversized batch.
  config.provider !== 'twelvedata' && config.twelveDataApiKey ? createTwelveDataProvider(config.twelveDataApiKey, { fxOnly: true }) : null,
  config.eodhdApiToken ? createEodhdProvider(config.eodhdApiToken) : null,
  createFrankfurterProvider(),
  createYahooFtseProvider(),
  createYahooMetalFuturesProvider(),
  createYahooIndexProvider(),
].filter(Boolean);
// Metals.Dev spot is acquired ONLY via refreshMetalsSpot() on the Cron path and
// served from KV on the dashboard path. It is intentionally excluded from the
// live refreshQuotes() provider loop so dashboard traffic cannot consume quota.
const metalsDevProvider = config.metalsDevApiKey ? createMetalsDevProvider(config.metalsDevApiKey) : null;
const metalInstruments = () => (metalsDevProvider ? instruments.filter((item) => metalsDevProvider.supports(item)) : []);

function now() { return new Date().toISOString(); }
function qualityFor(id) {
  if (config.realtimeInstrumentIds.has(id)) return 'REALTIME';
  if (config.delayedInstrumentIds.has(id)) return 'DELAYED';
  if (config.eodInstrumentIds.has(id)) return 'EOD';
  return 'UNVERIFIED';
}
function providerFor(instrument) { return providers.find((candidate) => candidate.supports(instrument)) || null; }
// Per-provider freshness TTL. Falls back to the shared quote cache window when a
// provider does not declare its own minimum refresh interval. Metals.Dev spot is
// Cron/KV-managed with a 12h cooldown, so its cache is considered fresh for 12h.
function providerTtlMs(providerId) {
  if (providerId === 'METALS_DEV_SPOT') return METALS_COOLDOWN_MS;
  const owner = providers.find((candidate) => candidate.id === providerId);
  return owner?.minimumRefreshMs || config.quoteCacheSeconds * 1000;
}
// Derive the freshness contract for one quote. Returns both the freshness label
// and the audit facts the UI needs (expiry, age, TTL) so callers never compute
// them differently.
export function freshnessFor(quote, nowMs) {
  const empty = { freshness: FRESHNESS.UNKNOWN, expiresAt: null, ageSeconds: null, providerTtlSeconds: null };
  if (!quote) return empty;
  const ttl = providerTtlMs(quote.provider);
  const status = quote.status || 'UNKNOWN';
  const fetched = Date.parse(quote.fetchedAt || quote.receivedAt || '');
  const ageSeconds = Number.isFinite(fetched) ? Math.max(0, Math.floor((nowMs - fetched) / 1000)) : null;
  const meta = { expiresAt: Number.isFinite(fetched) ? new Date(fetched + ttl).toISOString() : null, ageSeconds, providerTtlSeconds: Math.round(ttl / 1000) };
  if (status === 'UNAVAILABLE') return { freshness: FRESHNESS.UNAVAILABLE, ...meta };
  if (status === 'UNKNOWN') return { freshness: FRESHNESS.UNKNOWN, ...meta };
  if (status === 'STALE') return { freshness: FRESHNESS.STALE, ...meta };
  // A live value is FRESH only when we can prove it was refreshed inside its TTL.
  if (!Number.isFinite(fetched)) return { freshness: FRESHNESS.UNKNOWN, ...meta };
  return { freshness: (nowMs - fetched) <= ttl ? FRESHNESS.FRESH : FRESHNESS.STALE, ...meta };
}
function withFreshness(quote, nowMs) { return { ...quote, ...freshnessFor(quote, nowMs) }; }

// Aggregate dashboard/health freshness into one worst-value summary.
export function summarizeFreshness(instrumentOut) {
  const counts = { FRESH: 0, STALE: 0, UNKNOWN: 0, UNAVAILABLE: 0 };
  instrumentOut.forEach((item) => {
    const value = item?.quote?.freshness;
    if (value && counts[value] != null) counts[value]++; else counts.UNKNOWN++;
  });
  const present = FRESHNESS_ORDER.filter((value) => counts[value] > 0);
  return { status: worstFreshness(present), counts, total: instrumentOut.length, evaluated: instrumentOut.length - counts.UNKNOWN, order: FRESHNESS_ORDER };
}
function barsProviderFor(instrument) {
  return providers.find((candidate) => {
    if (typeof candidate.getDailyBars !== 'function') return false;
    return typeof candidate.supportsDailyBars === 'function' ? candidate.supportsDailyBars(instrument) : candidate.supports(instrument);
  }) || null;
}
function unavailable(instrument, reason) {
  const source = providerFor(instrument) || (metalsDevProvider && metalsDevProvider.supports(instrument) ? metalsDevProvider : null);
  return {
    instrumentId: instrument.id, status: 'UNAVAILABLE', provider: source?.id || 'COVERAGE_PENDING',
    providerSymbol: instrument.providerSymbol, deliveryLabel: 'NO APPROVED FREE SOURCE', asOf: null, receivedAt: now(), reason,
  };
}
function displayStatus(instrument, quote) { return quote.status || qualityFor(instrument.id); }

function primaryFreshEnough() { return Date.now() - lastRefreshAt < config.quoteCacheSeconds * 1000; }
function providerLastSuccess(provider) {
  return instruments.filter((item) => provider.supports(item)).reduce((latest, item) => {
    const quote = snapshots.get(item.id);
    if (quote?.provider !== provider.id) return latest;
    const timestamp = Date.parse(quote.fetchedAt || quote.receivedAt || '');
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
}
// Read the cached Metals.Dev spot snapshot from KV (dashboard path — no upstream call).
async function loadMetalsSpotCache() {
  if (!metalsKv) return null;
  try {
    const raw = await metalsKv.get(METALS_SPOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
// Persist the latest Metals.Dev spot snapshot (success OR failure) to KV.
async function saveMetalsSpotCache(record) {
  if (!metalsKv) return;
  try { await metalsKv.put(METALS_SPOT_KEY, JSON.stringify(record)); } catch { /* best-effort */ }
}

// Cron-only Metals.Dev spot acquisition. Respects a 12h cooldown read from KV so
// every Worker isolate shares the SAME last-attempt gate (no retry storm while
// quota is exhausted). Saves success quotes + fetchedAt, and on failure the
// attemptedAt + reason, so dashboard reads a stable cached state either way.
export async function refreshMetalsSpot(kv = null) {
  if (kv) metalsKv = kv;
  if (!metalsDevProvider) return null;
  const cache = await loadMetalsSpotCache();
  if (cache?.attemptedAt && Date.now() - Date.parse(cache.attemptedAt) < METALS_COOLDOWN_MS) {
    return cache; // cooldown not elapsed — do not call upstream, suppress retries
  }
  const eligible = metalInstruments();
  const receivedAt = now();
  try {
    const quotes = await metalsDevProvider.getQuotes(eligible);
    const quotesMap = new Map();
    eligible.forEach((item) => {
      const quote = quotes.get(item.id);
      if (quote) quotesMap.set(item.id, { ...quote, status: displayStatus(item, quote), provider: metalsDevProvider.id, receivedAt, fetchedAt: receivedAt, delaySeconds: null });
    });
    const record = { attemptedAt: receivedAt, status: 'OK', quotes: Object.fromEntries(quotesMap) };
    await saveMetalsSpotCache(record);
    return record;
  } catch (error) {
    // Persist the failure (with reason) and the cooldown so we do NOT retry hard
    // while quota is exhausted (error 1203) — protects the remaining monthly budget.
    const record = { attemptedAt: receivedAt, status: 'FAILED', reason: error.message };
    await saveMetalsSpotCache(record);
    // error.detail (when the provider sets it) carries the upstream status/response
    // body/symbols/params for diagnosis. It never includes the api_key.
    console.error(JSON.stringify({ event: 'metals_spot_refresh_failed', at: receivedAt, message: error.message, detail: error.detail || null }));
    return record;
  }
}
function providerDue(provider, force) {
  const minRefresh = provider.minimumRefreshMs || config.quoteCacheSeconds * 1000;
  const lastSuccess = providerLastSuccess(provider);
  // Manual refresh is deliberately unable to bypass EODHD/Metals.Dev quotas.
  if (provider === primaryProvider && force) return true;
  return !lastSuccess || Date.now() - lastSuccess >= minRefresh;
}
function retainOrMarkUnavailable(instrument, reason, receivedAt) {
  const previous = snapshots.get(instrument.id);
  if (previous?.price) snapshots.set(instrument.id, { ...previous, status: 'STALE', receivedAt, reason });
  else snapshots.set(instrument.id, unavailable(instrument, reason));
}

// GMT-UX-05: refresh hardening.
//   - single-flight: concurrent callers share ONE provider refresh (no duplicated
//     upstream requests, no thundering herd from many dashboard clients).
//   - parallel + deadline: providers run concurrently; a slow provider is cut off
//     instead of serialising the whole refresh (worst case no longer ~188s).
//   - partial success: Promise.allSettled + per-provider isolation means one
//     failed provider never marks healthy providers' data unusable.
//   - forced-refresh limiting: `?refresh=1` cannot bypass quotas/TTLs faster than
//     FORCE_REFRESH_MIN_INTERVAL_MS, so free tiers are not burned by refresh spam.
const FORCE_REFRESH_MIN_INTERVAL_MS = config.forceRefreshMinIntervalMs;
const PROVIDER_REFRESH_DEADLINE_MS = config.providerRefreshDeadlineMs;
let refreshPromise = null;
let lastForceRefreshAt = 0;

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('provider_deadline_exceeded')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function refreshProvider(provider, receivedAt) {
  const eligible = instruments.filter((item) => provider.supports(item));
  if (!eligible.length) return;
  try {
    const quotes = await withDeadline(provider.getQuotes(eligible), PROVIDER_REFRESH_DEADLINE_MS);
    eligible.forEach((item) => {
      const quote = quotes.get(item.id);
      if (!quote) return retainOrMarkUnavailable(item, 'provider_returned_no_quote', receivedAt);
      snapshots.set(item.id, {
        ...quote, status: displayStatus(item, quote), provider: provider.id, receivedAt, fetchedAt: receivedAt,
        delaySeconds: quote.status === 'PARTIAL_REALTIME' ? 0 : null,
      });
    });
  } catch (error) {
    eligible.forEach((item) => retainOrMarkUnavailable(item, 'provider_request_failed', receivedAt));
    console.error(JSON.stringify({ event: 'quote_refresh_failed', provider: provider.id, at: receivedAt, message: error.message, detail: error.detail || null }));
  }
}

async function refreshQuotes(force = false) {
  if (force) {
    if (Date.now() - lastForceRefreshAt < FORCE_REFRESH_MIN_INTERVAL_MS) force = false; // throttle abuse
    else lastForceRefreshAt = Date.now();
  }
  if (refreshPromise) return refreshPromise; // single-flight: join the in-flight refresh
  if (!force && primaryFreshEnough()) return; // cache still valid
  refreshPromise = (async () => {
    lastRefreshAt = Date.now();
    const receivedAt = now();
    const due = providers.filter((provider) => providerDue(provider, force));
    await Promise.allSettled(due.map((provider) => refreshProvider(provider, receivedAt)));
    instruments.filter((item) => !providerFor(item) && !metalsDevProvider?.supports(item)).forEach((item) => snapshots.set(item.id, unavailable(item, 'not_covered_by_configured_sources')));
  })();
  try { return await refreshPromise; } finally { refreshPromise = null; }
}

export async function refreshAndInspect(kv = null) {
  if (kv) metalsKv = kv;
  await refreshQuotes(false);
  // Surface the Cron-acquired Metals.Dev spot snapshot (from KV) for alert evaluation.
  // Metals.Dev is Cron/KV-managed and intentionally excluded from the live
  // refreshQuotes() provider loop, so its state MUST come from the KV cache only —
  // never from a synthetic not_covered snapshot left by refreshQuotes().
  const metalsCache = await loadMetalsSpotCache();
  const rows = instruments.map((item) => {
    let quote;
    if (metalsDevProvider?.supports(item)) {
      // KV cache takes precedence for metals; ignore any snapshot left by refreshQuotes.
      quote = metalsCache?.status === 'OK'
        ? (metalsCache.quotes?.[item.id] || unavailable(item, 'metals_spot_cache_empty'))
        : unavailable(item, metalsCache?.reason || 'metals_spot_unavailable');
    } else {
      quote = snapshots.get(item.id) || unavailable(item, 'not_loaded');
    }
    return {
      id: item.id,
      status: quote.status || 'UNKNOWN',
      reason: quote.reason || null,
      provider: quote.provider || null,
    };
  });
  return rows;
}

export async function dashboard(force = false, kv = null) {
  if (kv) metalsKv = kv;
  await refreshQuotes(force);
  // Metals.Dev spot is served from the Cron-written KV cache; dashboard traffic
  // NEVER triggers an upstream call (quota guard). Successful cache -> quotes;
  // failed/expired cache -> UNAVAILABLE with the stored reason.
  const metalsCache = await loadMetalsSpotCache();
  const nowMs = Date.now();
  const instrumentsOut = instruments.map((item) => {
    let quote;
    if (metalsDevProvider?.supports(item) && metalsCache) {
      quote = metalsCache.status === 'OK'
        ? (metalsCache.quotes?.[item.id] || unavailable(item, 'metals_spot_cache_empty'))
        : unavailable(item, metalsCache.reason || 'metals_spot_unavailable');
    } else {
      quote = snapshots.get(item.id) || unavailable(item, 'not_loaded');
    }
    return { ...item, quote: withFreshness(quote, nowMs) };
  });
  return {
    generatedAt: now(), provider: providers.map((provider) => provider.id).join(',') || 'NOT_CONFIGURED',
    quoteCacheSeconds: config.quoteCacheSeconds,
    instruments: instrumentsOut,
    groups: { indices: indexIds, sectors: sectorIds, metals: metalIds, research: researchIds, chart: 'ACWI' },
    // GMT-UX-02/06: one worst-value health summary the UI can render without
    // re-deriving the ordering from individual instrument statuses.
    health: summarizeFreshness(instrumentsOut),
  };
}

export async function dailyBars(id, outputSize = 60) {
  const instrument = byId.get(id);
  if (!instrument) return null;
  const provider = barsProviderFor(instrument);
  if (!provider || typeof provider.getDailyBars !== 'function') return { instrumentId: id, provider: provider?.id || 'NOT_CONFIGURED', status: 'UNAVAILABLE', bars: [], reason: 'not_covered_by_configured_sources' };
  const requestedLimit = Math.min(500, Math.max(2, Number.parseInt(outputSize, 10) || 60));
  const previous = bars.get(id);
  const previousAge = Date.now() - Date.parse(previous?.receivedAt || '');
  if (previous?.bars?.length >= requestedLimit && Number.isFinite(previousAge) && previousAge < barCacheMs) return { ...previous, cacheAgeSeconds: Math.floor(previousAge / 1000) };
  if (barRequests.has(id)) return barRequests.get(id);
  const request = (async () => {
    try {
      const result = await provider.getDailyBars(instrument, requestedLimit);
      const status = provider.id === 'ALPACA_IEX' ? 'PARTIAL_REALTIME' : provider.id === 'COINGECKO_PUBLIC' ? 'DELAYED' : provider.id === 'FRANKFURTER_ECB' ? 'EOD' : provider.id === 'YAHOO_FINANCE_FTSE' ? 'UNVERIFIED' : provider.id === 'YAHOO_FINANCE_METAL_FUTURES' ? 'UNVERIFIED' : provider.id === 'YAHOO_FINANCE_INDEX' ? 'UNVERIFIED' : qualityFor(id);
      const deliveryLabel = provider.id === 'ALPACA_IEX' ? 'IEX DAILY BARS — SINGLE U.S. EXCHANGE' : provider.id === 'COINGECKO_PUBLIC' ? 'COINGECKO DAILY PRICE — AGGREGATED REFERENCE' : provider.id === 'FRANKFURTER_ECB' ? 'FRANKFURTER — ECB DAILY REFERENCE' : provider.id === 'YAHOO_FINANCE_FTSE' ? 'YAHOO FINANCE — FTSE 100 INDEX' : provider.id === 'YAHOO_FINANCE_METAL_FUTURES' ? 'YAHOO FINANCE — METAL FUTURES REFERENCE' : provider.id === 'YAHOO_FINANCE_INDEX' ? 'YAHOO FINANCE — INDEX REFERENCE' : null;
      const response = { instrumentId: id, provider: provider.id, status, deliveryLabel, receivedAt: now(), requestedLimit, bars: result };
      bars.set(id, response);
      return response;
    } catch (error) {
      if (previous?.bars?.length) return { ...previous, status: 'STALE', receivedAt: now(), reason: 'provider_request_failed' };
      return { instrumentId: id, provider: provider.id, status: 'UNAVAILABLE', bars: [], receivedAt: now(), reason: 'provider_request_failed' };
    } finally { barRequests.delete(id); }
  })();
  barRequests.set(id, request);
  return request;
}

export async function health(kv = null) {
  if (kv) metalsKv = kv;
  const sourceList = providers.map((provider) => provider.id);
  let unavailableCount = 0;
  let staleCount = 0;
  for (const item of instruments) {
    // Metals.Dev spot lives in KV (Cron-written) and is checked separately below,
    // independent of whether the provider object is currently configured.
    if (item.kind === 'metal') continue;
    const quote = snapshots.get(item.id);
    // Only count instruments we have actually evaluated. Instruments whose
    // quote has not been fetched yet (cold/separate instance) are unknown,
    // not unavailable — counting them would over-report incidents.
    if (!quote) continue;
    if (quote.status === 'UNAVAILABLE') unavailableCount++;
    else if (quote.status === 'STALE') staleCount++;
  }
  // Account for Metals.Dev spot via its KV cache (no upstream call here).
  // Count metals regardless of whether the provider object is currently wired,
  // as long as the instrument registry defines metal cards.
  const metalCards = instruments.filter((item) => item.kind === 'metal');
  let metalsCache = null;
  if (metalCards.length) {
    metalsCache = await loadMetalsSpotCache();
    for (const item of metalCards) {
      if (!metalsCache) { unavailableCount++; continue; }
      if (metalsCache.status === 'OK') {
        if (!metalsCache.quotes?.[item.id]) unavailableCount++;
      } else {
        unavailableCount++; // FAILED / quota-exhausted -> unavailable
      }
    }
  }
  // GMT-UX-02: also expose the freshness contract here (independent of the
  // legacy unavailable/stale counts above, which are kept for compatibility).
  const nowMs = Date.now();
  const freshnessCounts = { FRESH: 0, STALE: 0, UNKNOWN: 0, UNAVAILABLE: 0 };
  for (const item of instruments) {
    const quote = item.kind === 'metal'
      ? (metalsCache?.status === 'OK' ? metalsCache.quotes?.[item.id] : null)
      : snapshots.get(item.id);
    freshnessCounts[freshnessFor(quote, nowMs).freshness]++;
  }
  const presentFreshness = FRESHNESS_ORDER.filter((value) => freshnessCounts[value] > 0);
  return {
    status: sourceList.length ? 'ready' : 'configuration_required', provider: sourceList.join(',') || 'NOT_CONFIGURED',
    providerConfigured: sourceList.length > 0, quoteCacheSeconds: config.quoteCacheSeconds,
    instrumentCount: instruments.length, unavailableCount, staleCount,
    degraded: unavailableCount > 0 || staleCount > 0,
    freshness: worstFreshness(presentFreshness), freshnessCounts,
    freeCoverage: 'World reference: ACWI ETF / EOD indices; FX: Twelve Data quote + ECB daily reference; crypto: CoinGecko aggregated reference; metals: quota-cached spot reference',
  };
}
