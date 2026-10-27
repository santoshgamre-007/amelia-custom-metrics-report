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

function createApp(cfg, { ROOT = __dirname } = {}) {
  const app = express(); const state = { session: null, jobs: new Map(), runs: new Map() }; const ymd = /^\d{4}-\d\d-\d\d$/;
  const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const common = { reportsDir: cfg.reportsDir, dictionaryDir: cfg.dictionariesDir, taxonomyDir: cfg.dictionariesDir, templatePath: cfg.templatePath, powerpoint: cfg.powerpoint, containedCalls: cfg.containedCalls, defaultDictionary: cfg.defaultDictionary, timeLabel: cfg.defaults.timeLabel };
  app.use(express.json({ limit: '1mb' })); app.use(express.static(path.join(ROOT, 'static')));
  app.use('/reports', express.static(cfg.reportsDir, { setHeaders: (r, f) => { if (/\.(pptx|csv)$/.test(f)) r.setHeader('Content-Disposition', `attachment; filename="${path.basename(f)}"`); } }));
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.message }));
  const urls = (r) => ({ base: r.base, files: Object.fromEntries(Object.entries(r.files).map(([k, f]) => [k, '/reports/' + f])), summary: r.summary });

  app.get('/api/state', wrap((req, res) => res.json({ version: pkg.version, defaults: cfg.defaults, configured: cfg.hasConnection, baseUrl: cfg.connection.base_url, authMode: cfg.connection.auth_mode, connected: !!state.session, user: state.session && state.session.user, domains: state.session ? state.session.domains : [] })));
  app.post('/api/connect', wrap(async (req, res) => {
    const b = req.body || {}; const c = cfg.connection; const mode = (b.mode || (c.auth_mode === 'session_cookie' ? 'cookie' : 'password')) === 'cookie' ? 'cookie' : 'password';
    const s = new Session({ baseUrl: b.baseUrl || c.base_url, mode, username: b.username || c.username, password: b.password || c.password, cookie: b.cookie || c.session_cookie }); let info; try { info = await s.connect(); } catch (e) { throw bad(e.message); } state.session = s; res.json(info);
  }));
  // Transcripts stay in memory on this computer only (never written to the reports folder or the shareable dashboard).
  const remember = (r) => { state.runs.set(r.base, { at: Date.now(), conversations: r.conversations || [], model: r.model }); while (state.runs.size > 5) state.runs.delete(state.runs.keys().next().value); };
  const hhmmss = (t) => new Date(t * 1000).toISOString().slice(11, 19);
  app.get('/api/transcript', wrap((req, res) => {
    const id = String(req.query.id || '').replace(/\s+/g, '').toUpperCase(); const runs = [...state.runs.entries()].reverse();
    if (!runs.length) return res.json({ found: false, reason: 'no-run', message: 'No report has been built since this app started. Build a report first (transcripts are held in memory only, never saved).' });
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
  const startJob = (fn) => { const id = crypto.randomUUID(); const job = { id, status: 'running', log: [], error: null, report: null }; state.jobs.set(id, job); const log = (t) => job.log.push(`${new Date().toTimeString().slice(0, 8)}  ${t}`);
    Promise.resolve().then(() => fn(log)).then((r) => { remember(r); job.report = urls(r); job.status = 'done'; log(`Report ready: ${r.summary.rows} conversations, ${r.summary.transcripts} transcripts analysed.`); }).catch((e) => { job.status = 'error'; job.error = e.message; log('Stopped: ' + e.message); }); return job; };
  app.post('/api/generate', wrap(async (req, res) => {
    if (!state.session) throw bad('Connect to Amelia first.', 409); const b = req.body || {}; if (!b.domainId) throw bad('Choose a domain.'); if (!ymd.test(b.from || '') || !ymd.test(b.to || '') || b.from > b.to) throw bad('Choose a valid period (From on or before To).');
    if ((Date.parse(b.to) - Date.parse(b.from)) / 864e5 > 120) throw bad('That period is long; choose 120 days or fewer, or run it in parts.');
    const dom = state.session.domains.find((d) => d.id === String(b.domainId)) || {}; const job = startJob(async (log) => { log(`Asking Amelia for the conversations of ${dom.name || b.domainId}, ${b.from} to ${b.to}…`); const text = await state.session.pullExport({ domainId: b.domainId, from: b.from, to: b.to, timeZone: b.timeZone || cfg.defaults.timezone, transcripts: true }, log); log('Reading the conversations and their transcripts…'); return buildReports(text, { ...common, customer: b.customer || cfg.defaults.customer, title: b.title }); });
    res.json({ jobId: job.id });
  }));
  app.post('/api/upload', express.raw({ type: () => true, limit: '300mb' }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('The file is empty.'); const job = startJob(async (log) => { log(`Reading ${Math.round(req.body.length / 1024)} KB…`); return buildReports(decodeExport(req.body), { ...common, customer: req.query.customer || cfg.defaults.customer, title: req.query.title }); }); res.json({ jobId: job.id });
  }));
  app.get('/api/jobs/:id', wrap((req, res) => { const j = state.jobs.get(req.params.id); if (!j) throw bad('Unknown job.', 404); res.json(j); }));
  app.get('/api/reports', wrap((req, res) => { fs.mkdirSync(cfg.reportsDir, { recursive: true }); const g = new Map(); for (const f of fs.readdirSync(cfg.reportsDir)) { const m = f.match(/^(amelia-custom-metrics_.+?)(_conversations)?\.(html|pptx|csv)$/); if (!m) continue; const e = g.get(m[1]) || { base: m[1], files: {}, mtime: 0 }; e.files[m[2] ? 'csv' : m[3] === 'html' ? 'dashboard' : m[3]] = '/reports/' + f; e.mtime = Math.max(e.mtime, fs.statSync(path.join(cfg.reportsDir, f)).mtimeMs); g.set(m[1], e); } res.json({ reports: [...g.values()].sort((a, b) => b.mtime - a.mtime).slice(0, 30) }); }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message })); return app;
}
function start(cfg, opts) { return new Promise((resolve) => { const app = createApp(cfg, opts); const srv = app.listen(cfg.port, '127.0.0.1', () => resolve(srv)); }); }
module.exports = { createApp, start };
if (require.main === module) { const cfg = loadConfig(__dirname); start(cfg).then((s) => console.log(`\n  SoundHound | Amelia Custom Metrics Report v${pkg.version}\n  Open http://127.0.0.1:${s.address().port}\n`)); }
