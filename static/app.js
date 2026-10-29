'use strict';
const $ = (id) => document.getElementById(id); const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { state: null };
async function api(path, opts = {}) { const r = await fetch(path, { ...opts, headers: { ...(opts.json ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) }, body: opts.json ? JSON.stringify(opts.json) : opts.body }); const j = await r.json().catch(() => ({})); if (r.status === 401 && j.locked) { location.href = '/login'; throw new Error(j.error); } if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; }
const show = (n) => { $('step-1').hidden = n !== 1; $('step-2').hidden = n !== 2; document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', +a.dataset.go === n)); };
const err = (id, m) => { $(id).hidden = !m; $(id).textContent = m || ''; };
const ymd = (d) => d.toISOString().slice(0, 10);

function applyConnected(info) {
  $('conn').textContent = `connected · ${info.user}`; $('conn').className = 'pill ok'; $('after').hidden = false;
  $('p-domain').innerHTML = info.domains.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}${d.code && d.code !== d.name ? ` (${esc(d.code)})` : ''}</option>`).join('');
  const want = (S.state.defaults.domain || '').toLowerCase(); const hit = info.domains.find((d) => [d.id, d.code, d.name].some((v) => String(v).toLowerCase() === want)); if (hit) $('p-domain').value = hit.id;
  $('c-msg').className = 'msg ok'; $('c-msg').textContent = `Signed in as ${info.user}${info.version ? ` · Amelia ${info.version}` : ''} · ${info.domains.length} domain(s)`;
}
async function init() {
  S.state = await api('/api/state'); $('ver').textContent = 'v' + S.state.version;
  if (S.state.hosted) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Sign out and delete my data'; b.style.marginLeft = '8px'; b.onclick = async () => { await api('/api/logout', { method: 'POST' }); location.href = '/login'; }; document.querySelector('.chips').appendChild(b); } const d = S.state.defaults;
  const mem = (k) => { try { return localStorage.getItem('amc.' + k) || ''; } catch (_) { return ''; } }; $('c-url').value = S.state.baseUrl || mem('url'); $('c-user').value = mem('user'); $('c-mode').value = S.state.authMode === 'session_cookie' ? 'cookie' : 'password'; $('p-customer').value = $('f-customer').value = d.customer || '';
  const to = new Date(Date.now() - 864e5); $('p-to').value = ymd(to); $('p-from').value = ymd(new Date(to.getTime() - ((d.days || 7) - 1) * 864e5)); modeSwitch();
  if (S.state.connected) applyConnected({ user: S.state.user, domains: S.state.domains, version: '' });
  else if (S.state.configured) { try { $('c-msg').textContent = 'Signing in with the saved settings…'; applyConnected(await api('/api/connect', { method: 'POST', json: {} })); } catch (e) { $('c-msg').className = 'msg'; $('c-msg').textContent = ''; err('err1', 'The saved sign-in did not work: ' + e.message); } }
  loadReports();
}
function modeSwitch() { const c = $('c-mode').value === 'cookie'; $('pw-fields').hidden = c; $('ck-fields').hidden = !c; }
$('c-mode').addEventListener('change', modeSwitch);
document.querySelectorAll('nav a').forEach((a) => a.addEventListener('click', () => show(+a.dataset.go)));
$('b-back').addEventListener('click', () => show(1));
$('b-connect').addEventListener('click', async () => {
  err('err1'); $('b-connect').disabled = true; $('c-msg').className = 'msg'; $('c-msg').textContent = 'Connecting…';
  try { applyConnected(await api('/api/connect', { method: 'POST', json: { baseUrl: $('c-url').value, mode: $('c-mode').value, username: $('c-user').value, password: $('c-pass').value, cookie: $('c-cookie').value } })); try { localStorage.setItem('amc.url', $('c-url').value); localStorage.setItem('amc.user', $('c-user').value); } catch (_) { /* address and user name only, never the password */ } } catch (e) { $('c-msg').textContent = ''; err('err1', e.message); }
  $('b-connect').disabled = false;
});
async function follow(jobId) {
  show(2); $('result').hidden = true; err('err2'); $('log').textContent = 'Starting…';
  for (;;) {
    const j = await api('/api/jobs/' + jobId); $('log').textContent = j.log.join('\n'); $('log').scrollTop = 1e9;
    if (j.status === 'error') { err('err2', j.error); return; }
    if (j.status === 'done') { showReport(j.report); loadReports(); return; }
    await new Promise((r) => setTimeout(r, 800));
  }
}
function showReport(r) {
  $('result').hidden = false; $('d-dash').href = r.files.dashboard; $('frame').src = r.files.dashboard; const p = $('d-pptx'); p.hidden = !r.files.pptx; if (r.files.pptx) { p.href = r.files.pptx; p.setAttribute('download', r.files.pptx.split('/').pop()); } $('d-csv').href = r.files.csv;
  const o = r.summary.outcome; const k = (cls, v, l) => `<div class="k ${cls}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
  $('kpis').innerHTML = k('', o.total, 'Conversations') + k('g', o.pct.contained + '%', `Contained${o.design ? ' (incl. ' + o.design + ' Escalation by Design)' : ''}`) + k('a', o.pct.escalated + '%', 'Escalated') + k('r', o.pct.abandoned + '%', 'Abandoned') + k('', `${r.summary.transcripts}`, 'Transcripts analysed');
}
$('b-generate').addEventListener('click', async () => {
  err('err1'); try { const j = await api('/api/generate', { method: 'POST', json: { domainId: $('p-domain').value, from: $('p-from').value, to: $('p-to').value, customer: $('p-customer').value, title: $('p-title').value } }); follow(j.jobId); } catch (e) { err('err1', e.message); }
});
$('b-upload').addEventListener('click', async () => {
  err('err1'); const f = $('f-file').files[0]; if (!f) return err('err1', 'Choose the export file first.');
  try { const j = await api(`/api/upload?customer=${encodeURIComponent($('f-customer').value)}`, { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream' } }); follow(j.jobId); } catch (e) { err('err1', e.message); }
});
async function loadReports() { try { const { reports } = await api('/api/reports'); $('reports').innerHTML = reports.length ? reports.map((r) => `<tr><td>${esc(r.base.replace(/^amelia-custom-metrics_/, ''))}</td><td>${r.files.dashboard ? `<a href="${r.files.dashboard}" target="_blank">Dashboard</a>` : ''}${r.files.pptx ? `<a href="${r.files.pptx}" download>PowerPoint</a>` : ''}${r.files.csv ? `<a href="${r.files.csv}" download>CSV</a>` : ''}</td></tr>`).join('') : '<tr><td class="hint">No reports yet.</td></tr>'; } catch (_) { /* optional */ } }
init().catch((e) => err('err1', e.message));
