'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseTurns } = require('./lib/transcript');
const { Session } = require('./lib/amelia');
const { buildReports, decodeExport } = require('./lib/pipeline');
const { loadConfig } = require('./lib/config');
const pkg = require('./package.json');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const hostOk = (host, list) => list.some((p) => { p = p.toLowerCase(); return p.startsWith('*.') ? host.endsWith(p.slice(1)) && host.length > p.length - 1 : host === p; });
const LOGIN = (msg) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SoundHound | Amelia Custom Metrics Report</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4fa;color:#241a3f;font:15px/1.5 system-ui,Segoe UI,sans-serif}@media(prefers-color-scheme:dark){body{background:#161225;color:#eee9fb}form{background:#201a35!important;border-color:#383054!important}input{background:#161225!important;color:#eee9fb!important;border-color:#383054!important}}form{background:#fff;border:1px solid #e3deef;border-radius:14px;padding:26px;width:min(380px,92vw)}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 14px;color:#6b6485;font-size:13px}input{width:100%;padding:10px;border:1px solid #e3deef;border-radius:8px;font:inherit;margin-bottom:12px}button{width:100%;padding:10px;border:0;border-radius:8px;background:#5b2fb5;color:#fff;font:inherit;font-weight:600;cursor:pointer}.e{color:#b3261e;margin:0 0 10px;font-size:13px}</style></head><body><form method="post" action="/login"><h1>SoundHound | Amelia Custom Metrics Report</h1><p>Enter the access code you were given.</p>${msg ? `<div class="e">${msg}</div>` : ''}<input type="password" name="code" autocomplete="off" autofocus aria-label="Access code"><button>Continue</button></form></body></html>`;

function createApp(cfg, { ROOT = __dirname } = {}) {
  const H = cfg.hosted && cfg.hosted.enabled ? cfg.hosted : null;
  if (H && !H.accessCode) throw new Error('Hosted mode needs an access code: set ACCESS_CODE.');
  if (H && !H.allowedHosts.length) throw new Error('Hosted mode needs the Amelia addresses people may use: set ALLOWED_AMELIA_HOSTS (e.g. your-host.example.com).');
  const app = express(); const ymd = /^\d{4}-\d\d-\d\d$/; if (H) app.set('trust proxy', 1); app.disable('x-powered-by');
  const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const mkState = () => ({ session: null, jobs: new Map(), runs: new Map() });
  // One visitor on a personal computer; in hosted mode every sign-in gets its own state, reports folder and Amelia session.
  const LOCAL = { id: 'local', state: mkState(), dir: cfg.reportsDir, last: Date.now() }; const visitors = new Map(); const fails = new Map();
  const wipe = (v) => { if (H && v.dir) fs.rmSync(v.dir, { recursive: true, force: true }); };
  if (H) { fs.rmSync(cfg.reportsDir, { recursive: true, force: true }); const t = setInterval(() => { for (const [k, v] of visitors) if (Date.now() - v.last > H.idleMinutes * 60000) { wipe(v); visitors.delete(k); } }, 60000); t.unref(); app.locals.timer = t; }
  const cookieOf = (req, n) => (String(req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find((c) => c[0] === n) || [])[1] || '';
  const V = (req) => { if (!H) return LOCAL; const v = visitors.get(cookieOf(req, 'amc')); if (!v) return null; v.last = Date.now(); return v; };

  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); if (H) { res.setHeader('Cache-Control', 'no-store'); if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000'); } next(); });
  app.get('/healthz', (req, res) => res.type('text').send('ok'));
  if (H) {
    app.get('/login', (req, res) => res.type('html').send(LOGIN('')));
    app.post('/login', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
      const ip = req.ip; const f = fails.get(ip) || { n: 0, at: Date.now() }; if (Date.now() - f.at > 15 * 60000) { f.n = 0; f.at = Date.now(); }
      if (f.n >= 10) return res.status(429).type('html').send(LOGIN('Too many attempts. Try again in 15 minutes.'));
      if (!same(String((req.body || {}).code || ''), H.accessCode)) { f.n++; fails.set(ip, f); return res.status(401).type('html').send(LOGIN('That access code is not right.')); }
      if (visitors.size >= H.maxVisitors) return res.status(503).type('html').send(LOGIN('The tool is busy. Try again in a few minutes.'));
      const token = crypto.randomBytes(32).toString('hex'); visitors.set(token, { id: token, state: mkState(), dir: path.join(cfg.reportsDir, sha(token).toString('hex').slice(0, 24)), last: Date.now() }); fails.delete(ip);
      res.setHeader('Set-Cookie', `amc=${token}; HttpOnly; SameSite=Strict; Path=/${req.secure ? '; Secure' : ''}`); res.redirect('/');
    });
    app.use((req, res, next) => { if (V(req)) return next(); if (req.path.startsWith('/api/') || req.path.startsWith('/reports/')) return res.status(401).json({ error: 'Enter the access code to continue.', locked: true }); res.redirect('/login'); });
    app.post('/api/logout', (req, res) => { const t = cookieOf(req, 'amc'); const v = visitors.get(t); if (v) { wipe(v); visitors.delete(t); } res.setHeader('Set-Cookie', 'amc=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({ ok: true }); });
  }
  const common = (v) => ({ reportsDir: v.dir, dictionaryDir: cfg.dictionariesDir, taxonomyDir: cfg.dictionariesDir, templatePath: cfg.templatePath, powerpoint: cfg.powerpoint, containedCalls: cfg.containedCalls, defaultDictionary: cfg.defaultDictionary, timeLabel: cfg.defaults.timeLabel });
  app.use(express.json({ limit: '1mb' })); app.use(express.static(path.join(ROOT, 'static')));
  app.get('/reports/:file', (req, res) => { const v = V(req); const f = req.params.file; if (!/^amelia-custom-metrics_[\w.-]+\.(html|pptx|csv)$/.test(f)) return res.status(404).end(); if (/\.(pptx|csv)$/.test(f)) res.setHeader('Content-Disposition', `attachment; filename="${f}"`); res.sendFile(f, { root: v.dir, dotfiles: 'deny' }, (e) => { if (e && !res.headersSent) res.status(404).end(); }); });
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.message }));
  const urls = (r) => ({ base: r.base, files: Object.fromEntries(Object.entries(r.files).map(([k, f]) => [k, '/reports/' + f])), summary: r.summary });

  app.get('/api/state', wrap((req, res) => { const { state } = V(req); res.json({ version: pkg.version, hosted: !!H, defaults: cfg.defaults, configured: H ? false : cfg.hasConnection, baseUrl: cfg.connection.base_url, authMode: cfg.connection.auth_mode, connected: !!state.session, user: state.session && state.session.user, domains: state.session ? state.session.domains : [] }); }));
  const checkAmelia = (address) => { // hosted: only the Amelia hosts on the allow-list, over https (the server calls them on the visitor's behalf)
    let u; try { u = new URL(/^https?:\/\//i.test(String(address || '').trim()) ? String(address).trim() : 'https://' + String(address || '').trim()); } catch (_) { throw bad('Enter the Amelia address, e.g. https://your-host/Amelia.'); }
    if (u.username || u.password) throw bad('Leave the user name and password out of the address.'); if (u.protocol !== 'https:' && !H.allowInsecureAmelia) throw bad('The Amelia address must start with https://.');
    if (!hostOk(u.hostname.toLowerCase(), H.allowedHosts)) throw bad('That Amelia address is not on this tool’s list of allowed addresses. Ask the person who runs this tool to add it.'); };
  app.post('/api/connect', wrap(async (req, res) => {
    const v = V(req); const b = req.body || {}; const c = H ? {} : cfg.connection; const mode = (b.mode || (c.auth_mode === 'session_cookie' ? 'cookie' : 'password')) === 'cookie' ? 'cookie' : 'password'; if (H) checkAmelia(b.baseUrl);
    const s = new Session({ baseUrl: b.baseUrl || c.base_url, mode, username: b.username || c.username, password: b.password || c.password, cookie: b.cookie || c.session_cookie }); let info; try { info = await s.connect(); } catch (e) { throw bad(e.message); } v.state.session = s; res.json(info);
  }));
  // Transcripts stay in memory only (never written to the reports folder or the shareable dashboard).
  const remember = (state, r) => { state.runs.set(r.base, { at: Date.now(), conversations: r.conversations || [], model: r.model }); while (state.runs.size > 5) state.runs.delete(state.runs.keys().next().value); };
  const hhmmss = (t) => new Date(t * 1000).toISOString().slice(11, 19);
  app.get('/api/transcript', wrap((req, res) => {
    const { state } = V(req); const id = String(req.query.id || '').replace(/\s+/g, '').toUpperCase(); const runs = [...state.runs.entries()].reverse();
    if (!runs.length) return res.json({ found: false, reason: 'no-run', message: 'No report has been built in this session yet. Build a report first (transcripts are held in memory only, never saved).' });
    const list = (runs[0][1].model.detail || []).map((d) => ({ id: d.id, outcome: d.outcome, when: d.when }));
    if (!id) return res.json({ found: false, reason: 'no-id', suggestions: list, base: runs[0][0] });
    for (const [base, run] of runs) {
      const c = run.conversations.find((x) => String(x.id).toUpperCase() === id); if (!c) continue;
      const pc = (run.model.perConversation || []).find((x) => String(x.id).toUpperCase() === id) || {}; const dt = (run.model.detail || []).find((x) => String(x.id).toUpperCase() === id) || {};
      const turns = parseTurns(c._transcript).map((t) => ({ who: t.who, label: t.who === 'amelia' ? 'Amelia' : t.who === 'agent' ? 'Agent' : 'Caller', time: hhmmss(t.t), text: t.text }));
      return res.json({ found: true, base, id: c.id, domain: c.domain, created: c.date, when: dt.when || '', channel: c.channel, outcome: pc.outcome || '', recorded: pc.recorded || '', handleSec: c.handleSec, closedBy: c.closedBy, escalated: c.escalated, agentHandled: c.agentHandled, escalateAbandoned: c.escAbandoned, ameliaAbandoned: c.ameliaAbandoned, resolution: c.resolution, topics: c.topics, queue: c.queue, turns, suggestions: list });
    }
    res.json({ found: false, reason: 'not-in-report', suggestions: list, message: `“${id}” is not in the latest report’s export.` });
  }));
  const startJob = (state, fn) => { const id = crypto.randomUUID(); const job = { id, status: 'running', log: [], error: null, report: null }; state.jobs.set(id, job); const log = (t) => job.log.push(`${new Date().toTimeString().slice(0, 8)}  ${t}`);
    Promise.resolve().then(() => fn(log)).then((r) => { remember(state, r); job.report = urls(r); job.status = 'done'; log(`Report ready: ${r.summary.rows} conversations, ${r.summary.transcripts} transcripts analysed.`); }).catch((e) => { job.status = 'error'; job.error = e.message; log('Stopped: ' + e.message); }); return job; };
  app.post('/api/generate', wrap(async (req, res) => {
    const v = V(req); const { state } = v; if (!state.session) throw bad('Connect to Amelia first.', 409); const b = req.body || {}; if (!b.domainId) throw bad('Choose a domain.'); if (!ymd.test(b.from || '') || !ymd.test(b.to || '') || b.from > b.to) throw bad('Choose a valid period (From on or before To).');
    if ((Date.parse(b.to) - Date.parse(b.from)) / 864e5 > 120) throw bad('That period is long; choose 120 days or fewer, or run it in parts.');
    const dom = state.session.domains.find((d) => d.id === String(b.domainId)) || {}; const job = startJob(state, async (log) => { log(`Asking Amelia for the conversations of ${dom.name || b.domainId}, ${b.from} to ${b.to}…`); const text = await state.session.pullExport({ domainId: b.domainId, from: b.from, to: b.to, timeZone: b.timeZone || cfg.defaults.timezone, transcripts: true }, log); log('Reading the conversations and their transcripts…'); return buildReports(text, { ...common(v), customer: b.customer || cfg.defaults.customer, title: b.title }); });
    res.json({ jobId: job.id });
  }));
  app.post('/api/upload', (req, res, next) => express.raw({ type: () => true, limit: H ? `${H.maxUploadMb}mb` : '300mb' })(req, res, next), wrap(async (req, res) => {
    const v = V(req); if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('The file is empty.'); const job = startJob(v.state, async (log) => { log(`Reading ${Math.round(req.body.length / 1024)} KB…`); return buildReports(decodeExport(req.body), { ...common(v), customer: req.query.customer || cfg.defaults.customer, title: req.query.title }); }); res.json({ jobId: job.id });
  }));
  app.get('/api/jobs/:id', wrap((req, res) => { const j = V(req).state.jobs.get(req.params.id); if (!j) throw bad('Unknown job.', 404); res.json(j); }));
  app.get('/api/reports', wrap((req, res) => { const dir = V(req).dir; fs.mkdirSync(dir, { recursive: true }); const g = new Map(); for (const f of fs.readdirSync(dir)) { const m = f.match(/^(amelia-custom-metrics_.+?)(_conversations)?\.(html|pptx|csv)$/); if (!m) continue; const e = g.get(m[1]) || { base: m[1], files: {}, mtime: 0 }; e.files[m[2] ? 'csv' : m[3] === 'html' ? 'dashboard' : m[3]] = '/reports/' + f; e.mtime = Math.max(e.mtime, fs.statSync(path.join(dir, f)).mtimeMs); g.set(m[1], e); } res.json({ reports: [...g.values()].sort((a, b) => b.mtime - a.mtime).slice(0, 30) }); }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.status === 413 ? 'That file is too large for this tool.' : err.message })); return app;
}
function start(cfg, opts) { return new Promise((resolve) => { const app = createApp(cfg, opts); const srv = app.listen(cfg.port, cfg.host || '127.0.0.1', () => resolve(srv)); srv.on('close', () => app.locals.timer && clearInterval(app.locals.timer)); }); }
module.exports = { createApp, start };
if (require.main === module) { const cfg = loadConfig(__dirname); start(cfg).then((s) => console.log(`\n  SoundHound | Amelia Custom Metrics Report v${pkg.version}${cfg.hosted.enabled ? ' (hosted)' : ''}\n  ${cfg.hosted.enabled ? 'Listening on port ' + s.address().port : 'Open http://127.0.0.1:' + s.address().port}\n`)); }
