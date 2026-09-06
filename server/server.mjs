import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { dashboard, dailyBars, health } from './market-service.mjs';

const root = resolve(join(fileURLToPath(new URL('..', import.meta.url))));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}
function securityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('content-security-policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
}
function clientAddress(request) {
  return (request.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
function ipv4Number(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const number = Number(part);
    if (!Number.isInteger(number) || number < 0 || number > 255) return null;
    result = (result * 256) + number;
  }
  return result >>> 0;
}
function matchesIpv4Cidr(address, rule) {
  const [network, prefixText, extra] = String(rule).split('/');
  const prefix = Number(prefixText), client = ipv4Number(address), base = ipv4Number(network);
  if (extra != null || client == null || base == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (client & mask) === (base & mask);
}
function isAllowedClient(request) {
  if (!config.allowedClientIps.size) return true;
  const address = clientAddress(request);
  return address === '127.0.0.1' || address === '::1' || [...config.allowedClientIps].some((rule) => rule === address || matchesIpv4Cidr(address, rule));
}
async function serveStatic(pathname, response) {
  const rawPath = pathname === '/' ? '/index.html' : pathname;
  const localPath = resolve(root, `.${normalize(rawPath)}`);
  if (!localPath.startsWith(root) || !contentTypes[extname(localPath)]) return sendJson(response, 404, { error: 'not_found' });
  try {
    const file = await stat(localPath);
    if (!file.isFile()) return sendJson(response, 404, { error: 'not_found' });
    response.writeHead(200, { 'content-type': contentTypes[extname(localPath)], 'cache-control': 'no-cache' });
    createReadStream(localPath).pipe(response);
  } catch { sendJson(response, 404, { error: 'not_found' }); }
}

const server = createServer(async (request, response) => {
  securityHeaders(response);
  if (!isAllowedClient(request)) return sendJson(response, 403, { error: 'client_not_allowed' });
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/v1/health') return sendJson(response, 200, health());
    if (url.pathname === '/api/v1/dashboard') return sendJson(response, 200, await dashboard(url.searchParams.get('refresh') === '1'));
    const match = url.pathname.match(/^\/api\/v1\/instruments\/([A-Z0-9_]+)\/bars$/);
    if (match) {
      const size = Number.parseInt(url.searchParams.get('limit') || '60', 10);
      const payload = await dailyBars(match[1], Number.isFinite(size) ? size : 60);
      return payload ? sendJson(response, 200, payload) : sendJson(response, 404, { error: 'unknown_instrument' });
    }
    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(JSON.stringify({ event: 'request_failed', path: url.pathname, message: error.message }));
    return sendJson(response, 500, { error: 'internal_error' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ event: 'gmt1_started', host: config.host, port: config.port, provider: config.provider }));
});
