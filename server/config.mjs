import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// On Cloudflare Workers, environment variables and secrets are injected into
// process.env automatically (via wrangler.jsonc `vars` / `secret` bindings),
// so no .env file loading is needed or available.

const intFromEnv = (name, fallback, min, max) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

const provider = (process.env.MARKET_DATA_PROVIDER || 'none').trim().toLowerCase();
const idSet = (name) => new Set((process.env[name] || '').split(',').map((id) => id.trim().toUpperCase()).filter(Boolean));
const ipSet = (name) => new Set((process.env[name] || '').split(',').map((ip) => ip.trim()).filter(Boolean));

export const config = Object.freeze({
  host: process.env.HOST || '127.0.0.1',
  port: intFromEnv('PORT', 8787, 1, 65535),
  allowedClientIps: ipSet('LAN_ALLOWED_CLIENT_IPS'),
  provider: ['alpaca', 'twelvedata'].includes(provider) ? provider : 'none',
  alpacaApiKeyId: (process.env.ALPACA_API_KEY_ID || '').trim(),
  alpacaApiSecretKey: (process.env.ALPACA_API_SECRET_KEY || '').trim(),
  alpacaFeed: 'iex',
  twelveDataApiKey: (process.env.TWELVE_DATA_API_KEY || '').trim(),
  eodhdApiToken: (process.env.EODHD_API_TOKEN || '').trim(),
  metalsDevApiKey: (process.env.METALS_DEV_API_KEY || '').trim(),
  quoteCacheSeconds: intFromEnv('QUOTE_CACHE_SECONDS', 60, 15, 3600),
  realtimeInstrumentIds: idSet('MARKET_DATA_REALTIME_IDS'),
  delayedInstrumentIds: idSet('MARKET_DATA_DELAYED_IDS'),
  eodInstrumentIds: idSet('MARKET_DATA_EOD_IDS'),
});

export function primaryProviderReady() {
  if (config.provider === 'alpaca') return config.alpacaApiKeyId.length > 0 && config.alpacaApiSecretKey.length > 0;
  return config.provider === 'twelvedata' && config.twelveDataApiKey.length > 0;
}

// Kept as the public readiness signal for the existing startup checks.
export function providerReady() { return primaryProviderReady(); }
