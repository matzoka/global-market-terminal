// Global Market Terminal — Cloudflare Worker entry point.
//
// This module replaces the original Node.js HTTP server (server.mjs).
// Static assets (HTML/CSS/JS/fonts/images) are served by Cloudflare's
// Static Assets binding (env.ASSETS); this handler only owns the JSON API
// routes and attaches security headers to every response.
//
// The original Node-specific pieces (http.createServer / listen, file-based
// cache.json, IP allow-listing) were removed during the Cloudflare migration.

import { dashboard, dailyBars, health } from './market-service.mjs';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
};

function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  };
}

function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders(), ...extraHeaders },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/v1/health') {
        return jsonResponse(200, health());
      }
      if (url.pathname === '/api/v1/dashboard') {
        return jsonResponse(200, await dashboard(url.searchParams.get('refresh') === '1'));
      }
      const match = url.pathname.match(/^\/api\/v1\/instruments\/([A-Z0-9_]+)\/bars$/);
      if (match) {
        const size = Number.parseInt(url.searchParams.get('limit') || '60', 10);
        const payload = await dailyBars(match[1], Number.isFinite(size) ? size : 60);
        return payload ? jsonResponse(200, payload) : jsonResponse(404, { error: 'unknown_instrument' });
      }
      // Everything else (HTML/CSS/JS/fonts/images) is served by Static Assets.
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse) {
        const headers = new Headers(assetResponse.headers);
        for (const [key, value] of Object.entries(securityHeaders())) headers.set(key, value);
        return new Response(assetResponse.body, { status: assetResponse.status, headers });
      }
      return jsonResponse(404, { error: 'not_found' });
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_failed', path: url.pathname, message: error.message }));
      return jsonResponse(500, { error: 'internal_error' });
    }
  },
};
