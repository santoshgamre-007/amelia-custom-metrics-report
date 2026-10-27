'use strict';
// Talks to an Amelia 7.x admin console: sign in (username + password, or a pasted browser session cookie), list the domains,
// then request a conversation export, wait for it and download it. Mirrors what the console itself does:
//   GET /admin/api/init → session-auth header + csrf; POST /admin/api/login; GETs carry NO csrf / X-Requested-With header (they cause HTTP 400).
const http = require('http');
const https = require('https');
const { decodeExport } = require('./export');

const origin = (u) => { try { return new URL(u).origin; } catch (_) { return ''; } };
/** Accepts the bare host, the /Amelia root, or any admin URL pasted from the browser → "https://host/Amelia". */
function normalizeBase(input) {
  let s = String(input || '').trim(); if (!s) throw new Error('Enter the Amelia address, e.g. https://your-host/Amelia.'); if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s); const m = u.pathname.match(/^(.*?\/Amelia)(\/|$)/i); return u.origin + (m ? m[1] : '/Amelia');
}
const amDate = (ymd, addDays = 0) => { const [y, mo, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, mo - 1, d + addDays)); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}/${t.getUTCFullYear()} 0:0`; };
const snippet = (t) => String(t).replace(/\s+/g, ' ').slice(0, 220);

class Session {
  constructor(o = {}) { this.base = normalizeBase(o.baseUrl); this.mode = o.mode === 'cookie' ? 'cookie' : 'password'; this.username = o.username || ''; this.password = o.password || ''; this.cookie = o.cookie || ''; this.cookies = new Map(); this.auth = null; this.csrf = null; this.user = null; this.domains = []; this.version = ''; this.timeoutMs = o.timeoutMs || 60000; }
  _store(res) { const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const c of list) { const [pair] = c.split(';'); const i = pair.indexOf('='); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); } }
  _cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  /** One request. nav = how a browser navigates to a download link: cookies only. */
  async request(path, { method = 'GET', headers = {}, body, nav = false, timeoutMs } = {}) {
    const url = path.startsWith('http') ? path : this.base + path; const write = method !== 'GET' && method !== 'HEAD';
    const h = { Accept: nav ? 'text/html,application/xhtml+xml,*/*' : 'application/json, text/plain, */*', Referer: this.base + '/admin/ng/admin/home', ...(write ? { 'X-Requested-With': 'XMLHttpRequest' } : {}) };
    if (!nav && this.auth) h['X-Amelia-Session-Auth'] = this.auth; if (!nav && write && this.csrf) h['X-CSRF-TOKEN'] = this.csrf;
    if (nav) Object.assign(h, { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin' });
    Object.assign(h, headers); const ck = this._cookieHeader(); if (ck) h.Cookie = ck;
    let res; try { res = nav ? await rawRequest(url, method, h, timeoutMs || this.timeoutMs) : await fetch(url, { method, headers: h, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs || this.timeoutMs) }); } catch (e) { throw new Error(`Cannot reach ${origin(url) || url}: ${e.cause && e.cause.code ? e.cause.code : e.message}`); }
    this._store(res); return res;
  }
  async json(path, opts) { const res = await this.request(path, opts); const text = await res.text(); if (res.status >= 300) throw new Error(`HTTP ${res.status} from ${path.split('?')[0]}${res.status < 400 ? ' (redirect to the login page — the session is not signed in)' : ''}: ${snippet(text)}`); if (/^\s*</.test(text)) throw new Error(`${path.split('?')[0]} returned a web page instead of data — the session is not signed in.`); try { return { data: JSON.parse(text), res }; } catch (_) { return { data: text, res }; } }

  async _init() { const { data, res } = await this.json('/admin/api/init', { timeoutMs: 30000 }); const tok = res.headers.get('x-amelia-session-auth'); if (tok) this.auth = tok; if (data && data.csrfToken) this.csrf = data.csrfToken; return data; }
  async connect() {
    if (this.mode === 'cookie') {
      let raw = this.cookie.trim().replace(/^Cookie:\s*/i, '').replace(/^["']|["']$/g, ''); if (!raw) throw new Error('Paste the browser session cookie (amelia_s=…).');
      if (!/[=;]/.test(raw.replace(/=+$/, ''))) this.cookies.set('amelia_s', raw); else for (const pair of raw.split(/;\s*/)) { const i = pair.indexOf('='); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
      const s = this.cookies.get('amelia_s'); if (s) this.auth = Buffer.from(/%[0-9A-Fa-f]{2}/.test(s) ? decodeURIComponent(s) : s).toString('base64');
      const init = await this._init(); if (!init || init.loggedIn !== true || (init.user && init.user.anonymous === true)) throw new Error('The pasted cookie is not a signed-in session on this host. Sign in to the console in your browser, then copy a fresh amelia_s from that same host.');
      return this._ready(init);
    }
    if (!this.username || !this.password) throw new Error('Enter the user name and password.');
    await this._init(); const prime = this.auth;
    const res = await this.request('/admin/api/login', { method: 'POST', timeoutMs: 30000, headers: { 'Content-Type': 'application/json;charset=UTF-8', ...(prime ? { 'X-Amelia-Session-Auth': prime } : {}), ...(this.csrf ? { 'X-CSRF-TOKEN': this.csrf } : {}) }, body: JSON.stringify({ username: this.username, password: this.password }) });
    const text = await res.text(); if (res.status >= 400 || /^\s*</.test(text)) throw new Error(res.status === 401 || res.status === 403 ? 'Amelia refused the user name or password.' : `Sign-in failed (HTTP ${res.status}): ${snippet(text)}`);
    let data = {}; try { data = JSON.parse(text); } catch (_) { /* below */ } if (!data.user || data.user.anonymous !== false) throw new Error('Amelia accepted the request but the session is still anonymous — check the user name and password.');
    const tok = res.headers.get('x-amelia-session-auth'); if (tok) this.auth = tok; if (data.csrfToken) this.csrf = data.csrfToken;
    return this._ready(await this._init());
  }
  _ready(init) {
    this.user = (init.user && (init.user.email || init.user.name || init.user.userId)) || 'signed in'; const cfg = init.appConfig || {}; this.version = String(cfg.ameliaVersion || cfg.version || init.ameliaVersion || '');
    this.domains = findDomains(init); return { user: this.user, version: this.version, domains: this.domains };
  }

  // ---------------------------------------------------------------- the conversation export
  _q(o) { return new URLSearchParams(o).toString(); }
  async requestExport({ domainId, from, to, timeZone = 'UTC', transcripts = true }, log = () => {}) {
    const B = '/admin/api/metrics/conversations/export'; const base = { from_date: amDate(from), to_date: amDate(to, 1), tz: timeZone, use_summary_created_dates: 'false', domain_id: domainId };
    const chk = await this.json(`${B}/check?${this._q(base)}`); if (chk.data && chk.data.isValid === false) throw new Error('Amelia says this date range is not valid for an export.'); const n = chk.data && chk.data.exportCount;
    if (n === 0) throw new Error('Amelia has no conversations for this domain in that period.'); if (n != null) log(`Amelia reports ${n} conversation(s) in this period.`);
    const q = { format: 'CSV', from_date: base.from_date, to_date: base.to_date, incl_transcript: transcripts ? 'true' : 'false', use_user_language: 'false', incl_esc_log: 'false', incl_cdr: 'false', use_summary_created_dates: 'false', incl_agentic_exec: 'false', domain_id: domainId, tz: timeZone };
    const r = await this.json(`${B}/request?${this._q(q)}`); const id = String(typeof r.data === 'object' && r.data ? (r.data.id || r.data.reportId || r.data.uuid || '') : r.data).replace(/^"|"$/g, '').trim();
    if (!id) throw new Error('Amelia did not return an export id.'); return { id, count: n };
  }
  async waitForExport(id, { timeoutMs = 600000, pollMs = 2500, log = () => {} } = {}) {
    const B = '/admin/api/metrics/conversations/export'; const t0 = Date.now(); let last = '';
    while (Date.now() - t0 < timeoutMs) {
      let job = null; try { const { data } = await this.json(`${B}/list?page=0&size=25`); const arr = Array.isArray(data) ? data : data.content || data.items || data.results || data.data || []; job = arr.find((x) => [x.id, x.reportId, x.uuid, x.name].some((v) => v != null && String(v).includes(id))); } catch (_) { /* try status */ }
      if (!job) { try { const { data } = await this.json(`${B}/status/${encodeURIComponent(id)}`); job = typeof data === 'object' ? data : { status: String(data) }; } catch (_) { /* keep waiting */ } }
      const st = job ? String(job.status || job.state || '') : ''; if (st && st !== last) { log(`Export status: ${st}`); last = st; }
      if (/complete|done|finish|ready|success/i.test(st)) return job; if (/fail|error|cancel/i.test(st)) throw new Error(`Amelia could not build the export (${st}).`);
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`The export was not ready after ${Math.round(timeoutMs / 60000)} minutes. Ask for a shorter period.`);
  }
  async downloadExport(id, { domainId } = {}, log = () => {}) {
    const B = `/admin/api/metrics/conversations/export/download/${encodeURIComponent(id)}`; const attempts = [{ nav: true, q: '' }, { nav: false, q: '' }, { nav: true, q: `?domain_id=${encodeURIComponent(domainId || '')}` }, { nav: false, q: `?domain_id=${encodeURIComponent(domainId || '')}` }]; const why = [];
    for (const a of attempts) {
      const res = await this.request(B + a.q, { nav: a.nav, timeoutMs: 300000 }); const buf = Buffer.from(await res.arrayBuffer());
      if (res.status === 200 && buf.length && !/^\s*</.test(buf.slice(0, 20).toString('utf8'))) { log(`Downloaded ${buf.length} bytes.`); return buf; }
      why.push(`${a.nav ? 'browser-style' : 'API-style'}${a.q ? ' + domain' : ''}: HTTP ${res.status}${buf.length ? ' — ' + snippet(buf.slice(0, 300).toString('utf8')) : ''}`);
    }
    throw new Error(`Amelia built the export but refused the download. Tried: ${why.join(' | ')}. As a workaround, download the export from the console (Conversations → Export) and use “Use an exported file” instead.`);
  }
  /** request → wait → download → CSV text */
  async pullExport(p, log = () => {}) { const { id } = await this.requestExport(p, log); log(`Export ${id.slice(0, 8)} requested; waiting for Amelia to build it…`); await this.waitForExport(id, { log, timeoutMs: (p.timeoutMinutes || 10) * 60000, pollMs: p.pollMs }); log('Export ready. Downloading…'); return decodeExport(await this.downloadExport(id, { domainId: p.domainId }, log)); }
}

/** A plain HTTP(S) GET with full control of the headers. A browser opening a download link sends Sec-Fetch-* headers; fetch() would overwrite them. */
function rawRequest(url, method, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers: { ...headers, 'Accept-Encoding': 'identity' }, timeout: timeoutMs }, (r) => { const parts = []; r.on('data', (d) => parts.push(d)); r.on('end', () => { const buf = Buffer.concat(parts); resolve({ status: r.statusCode, headers: { get: (k) => { const v = r.headers[String(k).toLowerCase()]; return Array.isArray(v) ? v.join(', ') : v == null ? null : v; }, getSetCookie: () => [].concat(r.headers['set-cookie'] || []) }, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), text: async () => buf.toString('utf8') }); }); });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))); req.on('error', reject); req.end();
  });
}

/** Every {id, code, name} object found in the init payload (its "domains" map, or anywhere inside it). */
function findDomains(init) {
  const out = new Map(); const take = (o, key) => { const id = o.id ?? o.domainId ?? o.uuid ?? key; const code = o.code ?? o.domainCode ?? ''; const name = o.name ?? o.displayName ?? code; if (id != null && (code || name)) out.set(String(id), { id: String(id), code: String(code || ''), name: String(name || code) }); };
  const walk = (o, depth, key) => { if (!o || typeof o !== 'object' || depth > 5) return; if (Array.isArray(o)) { o.forEach((v) => walk(v, depth + 1)); return; } if (depth > 0 && (o.code || o.domainCode) && (o.id ?? o.domainId ?? o.uuid ?? key) != null) take(o, key); for (const [k, v] of Object.entries(o)) walk(v, depth + 1, k); };
  if (init && init.domains && typeof init.domains === 'object') for (const [k, v] of Object.entries(init.domains)) if (v && typeof v === 'object') take(v, k);
  if (!out.size) walk(init, 0); return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
module.exports = { Session, normalizeBase, findDomains, amDate };
