#!/usr/bin/env node
'use strict';
// Hands-free run:  node cli.js --domain <code or name> [--days 7 | --from YYYY-MM-DD --to YYYY-MM-DD] [--customer "…"]   or   node cli.js --file export.csv
const fs = require('fs');
const path = require('path');
const { Session } = require('./lib/amelia');
const { buildReports, decodeExport } = require('./lib/pipeline');
const { loadConfig } = require('./lib/config');
const arg = (argv) => { const a = {}; for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { const k = argv[i].slice(2); a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } } return a; };
const ymd = (d) => d.toISOString().slice(0, 10);
async function run(argv, { cfg = loadConfig(__dirname), log = console.log } = {}) {
  const a = arg(argv); const say = (t) => log(`[${new Date().toTimeString().slice(0, 8)}] ${t}`); const common = { containedCalls: cfg.containedCalls, defaultDictionary: cfg.defaultDictionary, reportsDir: path.resolve(a.out || cfg.reportsDir), dictionaryDir: cfg.dictionariesDir, taxonomyDir: cfg.dictionariesDir, templatePath: cfg.templatePath, powerpoint: cfg.powerpoint && !a['no-pptx'], customer: a.customer || cfg.defaults.customer, title: a.title || '', timeLabel: cfg.defaults.timeLabel };
  let text;
  if (a.file) { say(`Reading ${a.file}…`); text = decodeExport(fs.readFileSync(a.file)); }
  else {
    if (!cfg.hasConnection) throw new Error('No connection settings: fill the connection section of config.yaml (or AMELIA_URL / AMELIA_USER / AMELIA_PASSWORD), or use --file.');
    const c = cfg.connection; const s = new Session({ baseUrl: c.base_url, mode: c.auth_mode === 'session_cookie' ? 'cookie' : 'password', username: c.username, password: c.password, cookie: c.session_cookie }); const info = await s.connect(); say(`Signed in as ${info.user} (${info.domains.length} domain(s)).`);
    const want = String(a.domain || cfg.defaults.domain || '').toLowerCase(); const dom = info.domains.find((d) => [d.id, d.code, d.name].some((v) => String(v).toLowerCase() === want)) || (info.domains.length === 1 && !want ? info.domains[0] : null); if (!dom) throw new Error(`Say which domain: --domain <code>. Available: ${info.domains.map((d) => d.code || d.name).join(', ') || 'none'}.`);
    const to = a.to || ymd(new Date(Date.now() - 864e5)); const from = a.from || ymd(new Date(Date.parse(to) - ((Number(a.days) || cfg.defaults.days) - 1) * 864e5)); say(`Domain ${dom.name}, ${from} to ${to}.`);
    text = await s.pullExport({ domainId: dom.id, from, to, timeZone: cfg.defaults.timezone, transcripts: true, timeoutMinutes: Number(a.timeout) || 10 }, say);
  }
  const r = buildReports(text, common); say(`${r.summary.rows} conversations, ${r.summary.transcripts} transcripts analysed.`); log(`Dashboard:  ${r.paths.dashboard}`); if (r.paths.pptx) log(`PowerPoint: ${r.paths.pptx}`); log(`Data:       ${r.paths.csv}`); return r;
}
module.exports = { run };
if (require.main === module) run(process.argv.slice(2)).then(() => process.exit(0)).catch((e) => { console.error('\nStopped: ' + e.message); process.exit(1); });
