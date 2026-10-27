'use strict';
// A pretend Amelia admin console that behaves like the real one where it matters: init → login, session-auth header, and GET requests that
// carry X-Requested-With or X-CSRF-TOKEN are REJECTED (HTTP 400), exactly like the real console. Download styles can be restricted.
const http = require('http');
const zlib = require('zlib');
const AdmZip = require('adm-zip');
function create({ csv, count = 0, polls = 1, download = 'nav', pack = 'zip', cookie = 'GOODCOOKIE', domains } = {}) {
  const o = { csv, polls, download, pack, hits: [], polled: 0, last: {}, headersSeen: [] }; const doms = domains || { 1: { id: '1', code: 'demo', name: 'Demo' }, 2: { id: '2', code: 'pennstatehealth', name: 'Penn State Health' } };
  const n = count || (csv ? csv.split('\n').length - 2 : 0);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const h = req.headers; const send = (code, body, extra = {}) => { res.writeHead(code, { 'content-type': typeof body === 'string' ? 'application/json' : 'application/octet-stream', ...extra }); res.end(body); };
    o.hits.push(`${req.method} ${u.pathname}`); const p = u.pathname.replace(/^\/Amelia/, ''); let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const ck = Object.fromEntries((h.cookie || '').split(/;\s*/).filter(Boolean).map((x) => [x.split('=')[0], x.slice(x.indexOf('=') + 1)]));
      const authed = h['x-amelia-session-auth'] === 'AUTH' || ck.amelia_s === cookie;
      if (p === '/admin/api/init') { return send(200, JSON.stringify({ csrfToken: 'CSRF1', loggedIn: authed, user: { anonymous: !authed, email: authed ? 'tester@example.com' : undefined }, domains: authed ? doms : {}, appConfig: { ameliaVersion: '7.3.10.2' } }), { 'x-amelia-session-auth': authed ? 'AUTH' : 'PRIME', ...(authed ? { 'set-cookie': `amelia_s=${cookie}; Path=/` } : {}) }); }
      if (p === '/admin/api/login' && req.method === 'POST') { const b = JSON.parse(body || '{}'); if (h['x-amelia-session-auth'] !== 'PRIME' || h['x-csrf-token'] !== 'CSRF1') return send(400, '{"error":"missing handshake"}'); if (b.username !== 'tester' || b.password !== 'secret') return send(401, '{"error":"bad credentials"}'); return send(200, JSON.stringify({ user: { anonymous: false, email: 'tester@example.com' }, csrfToken: 'CSRF2' }), { 'x-amelia-session-auth': 'AUTH', 'set-cookie': `amelia_s=${cookie}; Path=/` }); }
      if (!p.startsWith('/admin/api/metrics/conversations/export/')) return send(404, '{}');
      if (!authed && !(o.download === 'nav' && p.includes('/download/') && ck.amelia_s === cookie)) return send(401, '{"error":"not signed in"}');
      if (req.method === 'GET' && (h['x-requested-with'] || h['x-csrf-token'])) return send(400, '{"error":"unexpected header on GET"}');   // the real console does this
      const tail = p.split('/export/')[1]; o.last[tail.split('/')[0]] = Object.fromEntries(u.searchParams);
      if (tail === 'check') return send(200, JSON.stringify({ exportCount: n, isValid: true }));
      if (tail === 'request') return send(200, '"11111111-2222-3333-4444-555555555555"');
      if (tail === 'list') { o.polled += 1; return send(200, JSON.stringify({ content: [{ id: '11111111-2222-3333-4444-555555555555', status: o.polled > o.polls ? 'COMPLETE' : 'RUNNING' }] })); }
      if (tail.startsWith('download/')) {
        const nav = h['sec-fetch-mode'] === 'navigate'; if (o.download === 'none') return send(400, '{"error":"download refused"}'); if (o.download === 'nav' && !nav) return send(400, '{"error":"download needs a browser navigation"}'); if (o.download === 'api' && nav) return send(400, '{"error":"download needs the api header"}');
        const buf = Buffer.from(o.csv); const data = o.pack === 'zip' ? (() => { const z = new AdmZip(); z.addFile('conversations.csv', buf); return z.toBuffer(); })() : o.pack === 'gzip' ? zlib.gzipSync(buf) : buf; return send(200, data);
      }
      return send(404, '{}');
    });
  });
  return { server, o };
}
module.exports = { create };
