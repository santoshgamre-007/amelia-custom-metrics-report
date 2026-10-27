'use strict';
// Turns the conversations (+ the customer's dictionary + the transcript rules) into everything the dashboard and the PowerPoint say.
//
// OUTCOME of every conversation (counted once):
//   contained  — recorded Final Disposition "Contained" (or, if not recorded: the platform says resolved and not escalated)
//   escalated  — recorded "Escalated" (or the platform escalated it)
//   abandoned  — recorded "Abandoned"/"Technical Drop" (or none of the above)
//   design     — "Escalation by Design": a call whose outcome is Abandoned but whose TRANSCRIPT shows an agent transfer. Counted as contained.
// Every dictionary metric gets its value from the recorded custom metric when there is one, otherwise from the transcript (where that can be worked out).
const T = require('./transcript');
const { norm, NA } = require('./export');

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = (n) => Number(n).toLocaleString('en-US');
const pct1 = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const pctS = (a, b) => `${pct1(a, b)}%`;
const mmss = (s) => (s == null ? '—' : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many || one + 's'}`;
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
const pretty = (s) => String(s).replace(/[_]+/g, ' ').replace(/\b([a-z])([a-z]*)/gi, (m, a, b) => (b.length <= 2 && /^[a-z]+$/.test(m) && m === m.toLowerCase() && m.length <= 3 && /^(mfa|vpn|sso|rap|kb|sms|ani|ivr)$/i.test(m) ? m.toUpperCase() : a.toUpperCase() + b));
const withOthers = (pairs, n, label = 'Others') => { const s = [...pairs].sort((a, b) => b[1] - a[1]); const head = s.slice(0, n).filter(([, v]) => v > 0).map(([label, count]) => ({ label, count })); const rest = s.slice(n).reduce((a, [, v]) => a + v, 0); if (rest) head.push({ label, count: rest }); return head; };

// ------------------------------------------------------------------ matching the recorded metric names to the dictionary
const ALIASES = { call_session_id: ['voicesipcallid', 'sessionid', 'callid'], caller_phone_number_ani: ['ani', 'callernumber', 'callerphonenumber'], dialed_number_dnis: ['dnis', 'dialednumber'], initial_caller_request: ['initialcallerutterance', 'initialutterance', 'firstutterance'], sms_delivery_status: ['textdeliverystatus', 'smsstatus', 'textstatus'], sms_opt_in: ['textoptin'], final_disposition: ['disposition', 'calldisposition'] };
const SYN = { text: 'sms', utterance: 'request', sip: 'session', human: 'agent' };
const tokens = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !['the', 'of', 'a'].includes(t)).map((t) => SYN[t] || t);
function matchRecorded(dict, names) {
  const out = new Map(); const used = new Set(); const byNorm = new Map(names.map((n) => [norm(n), n]));
  for (const m of dict.metrics) { const hit = byNorm.get(norm(m.key)) || byNorm.get(norm(m.name)); if (hit) { out.set(m.key, { recorded: hit, method: 'exact' }); used.add(hit); } }
  for (const m of dict.metrics) { if (out.has(m.key)) continue; for (const a of ALIASES[m.key] || []) { const hit = byNorm.get(a); if (hit && !used.has(hit)) { out.set(m.key, { recorded: hit, method: 'alias' }); used.add(hit); break; } } }
  for (const m of dict.metrics) {
    if (out.has(m.key)) continue; const want = new Set([...tokens(m.name), ...tokens(m.key)]); let best = null;
    for (const n of names) { if (used.has(n)) continue; const t = new Set(tokens(n)); const inter = [...t].filter((x) => want.has(x)).length; const j = inter / (new Set([...t, ...want]).size || 1); if (j >= 0.45 && (!best || j > best.j)) best = { n, j }; }
    if (best) { out.set(m.key, { recorded: best.n, method: 'similar' }); used.add(best.n); }
  }
  return out;
}

const classOf = (label) => (/^escalat(ed|ion)? by design/i.test(label) ? 'design' : /^contained/i.test(label) ? 'contained' : /^escalat|transfer|callback/i.test(label) ? 'escalated' : /^abandon|dropped|technical/i.test(label) ? 'abandoned' : null);
const LABEL = { contained: 'Contained', design: 'Escalation by Design', abandoned: 'Abandoned', escalated: 'Escalated' };

function analyze(ex, dict, tax, opts = {}) {
  const convs = ex.conversations; const N = convs.length; if (!N) throw new Error('There are no conversations to report on.');
  // ---- 1. transcripts → signals (the text is dropped as soon as it has been read)
  const recNames = [...new Set(convs.flatMap((c) => Object.keys(c.metrics)))]; const match = matchRecorded(dict, recNames);
  const intentRec = (match.get('matched_caller_intent') || {}).recorded;
  for (const c of convs) { c.sig = c._transcript ? T.analyzeTranscript(c._transcript, tax, { intentLabel: intentRec ? c.metrics[intentRec] : '' }) : { has: false }; delete c._transcript; }
  const nTx = convs.filter((c) => c.sig.has).length; const S = (c) => (c.sig.has ? c.sig : null);
  const rec = (c, key) => { const m = match.get(key); if (!m) return null; const v = c.metrics[m.recorded]; return v == null || NA.test(String(v).trim()) ? null : String(v).trim(); };

  // ---- 2. outcome of every conversation
  const deriveClass = (c) => (c.escalated ? 'escalated' : /^resolved$/i.test(c.resolution) ? 'contained' : 'abandoned');
  for (const c of convs) {
    const r = rec(c, 'final_disposition'); const rc = r ? classOf(r) : null; const dc = deriveClass(c); const s = S(c);
    c.recordedClass = rc; c.derivedClass = dc; c.outcomeFrom = rc ? 'recorded' : 'transcript';
    let cls = rc || dc; c.design = false;
    if (rc === 'design') { cls = 'contained'; c.design = true; }
    else if (cls === 'abandoned' && s && s.agentTransfer) { cls = 'contained'; c.design = true; }          // Abandoned + "agent transfer" in the transcript → Escalation by Design (contained)
    c.accepted = false; if (cls !== 'contained' && (opts.containedCalls || []).some((x) => String(x).toUpperCase() === String(c.id).toUpperCase())) { cls = 'contained'; c.accepted = true; }   // you marked this call as contained
    c.cls = cls;
  }
  const by = { contained: [], abandoned: [], escalated: [] }; for (const c of convs) by[c.cls].push(c);
  const designN = convs.filter((c) => c.design).length; const cN = by.contained.length; const aN = by.abandoned.length; const eN = by.escalated.length; const baseC = cN - designN;
  const derivedN = convs.filter((c) => c.outcomeFrom === 'transcript').length;
  const handleOf = (c) => (c.handleSec != null ? c.handleSec : (S(c) ? S(c).durationSec : null));
  const median = (list) => { const xs = list.map(handleOf).filter((x) => x != null).sort((a, b) => a - b); if (!xs.length) return null; const h = xs.length >> 1; return xs.length % 2 ? xs[h] : (xs[h - 1] + xs[h]) / 2; };
  const avg = (list) => { const xs = list.map(handleOf).filter((x) => x != null); return xs.length ? mean(xs) : null; };

  // ---- 3. dictionary metric values: recorded first, then worked out from the transcript
  const tdv = {                                                       // transcript-derived values, by dictionary key
    initial_caller_request: (c, s) => (s ? (s.intentStated ? 'Stated' : 'Not stated') : null),
    matched_caller_intent: (c, s) => { const r = s && s.reason && (tax.callingReasons || []).find((x) => x.key === s.reason); return r ? r.label : null; },
    repeat_count: (c, s) => (s ? String(s.repeatCount) : null), rephrase_count: (c, s) => (s ? String(s.rephraseCount) : null),
    final_disposition: (c) => LABEL[c.derivedClass],
    escalation_trigger: (c, s) => { if (c.derivedClass !== 'escalated' && !(s && s.agentTransfer)) return null; if (!s) return null; return s.askedForPerson ? 'Caller Requested Agent' : s.rephraseCount >= 2 ? 'Unclear-Response Limit Reached' : s.stepsGiven ? 'Unresolved After Steps' : s.intentStated ? 'Out-of-Scope Request' : 'Caller Requested Agent'; },
    caller_resolution_feedback: (c, s) => (s && s.resolveAsked ? (s.resolveAnswer || 'No Response') : null),
    caller_recommendation_feedback: (c, s) => (s && s.recommendAsked ? (s.recommendAnswer || 'No Response') : null),
    survey_completion_status: (c, s) => { if (!s) return null; const n = (s.resolveAnswer ? 1 : 0) + (s.recommendAnswer ? 1 : 0); if (!s.resolveAsked && !s.recommendAsked) return c.cls === 'contained' ? 'Not Offered' : 'Dropped/Escalated Before Survey'; return n >= 2 ? 'Completed' : n === 1 ? 'Partially Completed' : 'Declined'; },
  };
  const val = (c, key) => { const r = rec(c, key); if (r != null) return { v: r, src: 'recorded' }; const f = tdv[key]; const d = f ? f(c, S(c)) : null; return d != null ? { v: d, src: 'transcript' } : { v: null, src: null }; };
  const dist = (key) => { const m = new Map(); let recd = 0, tr = 0; for (const c of convs) { const x = val(c, key); if (x.v == null) continue; m.set(x.v, (m.get(x.v) || 0) + 1); if (x.src === 'recorded') recd++; else tr++; } const n = recd + tr; return { key, n, recorded: recd, transcript: tr, items: [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count, pct: pct1(count, n) })) }; };
  const nums = (key) => convs.map((c) => val(c, key).v).filter((x) => x != null && /^-?\d+(\.\d+)?$/.test(x)).map(Number);

  // ---- 4. the headline numbers
  const feedback = dist('caller_resolution_feedback'); const yes = (feedback.items.find((i) => /^yes$/i.test(i.label)) || { count: 0 }).count; const no = (feedback.items.find((i) => /^no$/i.test(i.label)) || { count: 0 }).count;
  const survey = dist('survey_completion_status'); const answered = survey.items.filter((i) => /^(completed|partial)/i.test(i.label)).reduce((a, i) => a + i.count, 0);
  const outcome = { total: N, contained: cN, baseContained: baseC, design: designN, abandoned: aN, escalated: eN, derived: derivedN,
    pct: { contained: pct1(cN, N), baseContained: pct1(baseC, N), design: pct1(designN, N), abandoned: pct1(aN, N), escalated: pct1(eN, N) },
    acceptedHelp: convs.filter((c) => c.accepted).length,
    escalatedSplit: { answered: by.escalated.filter((c) => c.agentHandled === true).length, leftWaiting: by.escalated.filter((c) => c.agentHandled === false && c.escAbandoned === true).length, known: by.escalated.every((c) => c.agentHandled != null) },
    timedOutAbandoned: by.abandoned.filter((c) => /timeout/i.test(c.closedBy || '')).length,
    handleMedian: { abandoned: mmss(median(by.abandoned)), escalated: mmss(median(by.escalated)), all: mmss(median(convs)) },
    handleTypicalAbandoned: mmss(avg(by.abandoned.filter((c) => !/timeout/i.test(c.closedBy || '')))),
    handle: { contained: mmss(avg(by.contained)), abandoned: mmss(avg(by.abandoned)), escalated: mmss(avg(by.escalated)), all: mmss(avg(convs)), design: mmss(avg(convs.filter((c) => c.design))) } };
  const dates = convs.filter((c) => c.date).map((c) => [c.date, c.hour, c.minute, c]).sort((a, b) => (a[0] + String(a[1]).padStart(2, '0') + String(a[2]).padStart(2, '0')).localeCompare(b[0] + String(b[1]).padStart(2, '0') + String(b[2]).padStart(2, '0')));
  const stamp = (c) => { const h = c.hour % 12 || 12; return `${DOW[c.dow]} ${Number(c.date.slice(5, 7))}/${Number(c.date.slice(8, 10))} ${h}:${String(c.minute).padStart(2, '0')} ${c.hour < 12 ? 'AM' : 'PM'}`; };
  const tl = tax.timeLabel || opts.timeLabel || ''; const period = dates.length ? `${stamp(dates[0][3])} to ${stamp(dates[dates.length - 1][3])}${tl ? ' ' + tl : ''}` : '';
  const kpis = { conversations: N, contained: { n: cN, pct: pct1(cN, N) }, escalated: { n: eN, pct: pct1(eN, N) }, abandoned: { n: aN, pct: pct1(aN, N) }, resolved: { yes, of: yes + no, pct: pct1(yes, yes + no) }, survey: { n: answered, pct: pct1(answered, N) } };

  // ---- 5. by day, where callers abandoned, what drove escalations
  const dm = new Map(); for (const c of convs) { if (!c.date) continue; const d = dm.get(c.date) || { label: `${DOW[c.dow]} ${Number(c.date.slice(5, 7))}/${Number(c.date.slice(8, 10))}`, total: 0, contained: 0, design: 0, abandoned: 0, escalated: 0 }; d.total++; if (c.design) d.design++; else d[c.cls]++; dm.set(c.date, d); }
  const days = [...dm.keys()].sort().map((k) => dm.get(k));
  const recordedAbandoned = convs.filter((c) => c.cls === 'abandoned' || c.design);          // everything the platform called abandoned
  const aw = new Map(); for (const c of by.abandoned) { const s = S(c); const k = !s ? 'Others' : s.stepsGiven && s.callerAccepted ? 'After steps or a link were given' : s.lastPrompt; aw.set(k, (aw.get(k) || 0) + 1); }
  const abandonWhere = withOthers(aw, 5);
  const TRIG = [[/caller requested|asked for|human|agent/i, 'Caller asked for a person'], [/out.of.scope|unsupported/i, 'Unsupported request'], [/unclear|limit reached/i, 'Repeated unclear answers'], [/unresolved after steps/i, 'Self-service did not resolve'], [/urgency|system error/i, 'Urgency or system error']];
  const ed = new Map(); for (const c of by.escalated) { const t = val(c, 'escalation_trigger'); const hit = t.v && TRIG.find(([r]) => r.test(t.v)); const k = hit ? hit[1] : 'Others'; ed.set(k, (ed.get(k) || 0) + 1); c.driver = k; }
  const escalationDrivers = withOthers(ed, 5);

  // ---- 6. knowledge base, reasons not contained, what callers needed
  const R = new Map((tax.callingReasons || []).map((r) => [r.key, r])); const kbMap = new Map(); const topicMap = new Map();
  for (const c of by.contained) {
    const a = val(c, 'matched_kb_article').v; const id = a && (a.match(/KB\d{4,}/i) || [])[0]; if (id) { const k = id.toUpperCase(); const e = kbMap.get(k) || { kb: k, title: (tax.kbTitles || {})[k] || (a.split(/\s[—–-]\s/)[1] || '').trim(), calls: 0 }; e.calls++; kbMap.set(k, e); }
    const t = c.design ? 'Escalation by Design' : (() => { const i = val(c, 'matched_caller_intent').v; return i ? pretty(i) : null; })(); if (t) topicMap.set(t, (topicMap.get(t) || 0) + 1);
  }
  const kbRows = top(new Map([...kbMap.values()].map((e) => [e.kb, e.calls])), 6).map(([k]) => kbMap.get(k));
  const kb = { rows: kbRows.map((r) => ({ title: r.title || 'KB article (title not in the export)', kb: r.kb, calls: r.calls, share: Math.round(pct1(r.calls, cN)) + '%' })), topics: withOthers(topicMap, 5, 'Other topics'), withArticle: [...kbMap.values()].reduce((a, e) => a + e.calls, 0) };
  kb.note = kb.rows.length ? `${kbRows[0].title || kbRows[0].kb} made up ${Math.round(pct1(kbRows[0].calls, cN))}% of the contained calls.${kb.withArticle < cN ? ` ${plural(cN - kb.withArticle, 'contained call')} had no knowledge-base article recorded.` : ''}` : `${plural(cN, 'contained call')}; no knowledge-base article is recorded for them.`;
  const classify = (c) => { const s = S(c);
    if (!s) return { key: 'nosignal', label: c.cls === 'escalated' ? 'Escalated: no transcript to explain why' : 'Abandoned: no transcript to explain why' };
    if (!s.intentStated && (s.askedForPerson || s.leftAtIntake || !s.stepsGiven)) return { key: 'intent', label: 'Caller never stated their intent: asked for a person right away, gave no usable answers, or hung up during intake' };
    if (s.stepsGiven) return { key: 'steps', label: 'Self-service steps or link did not work for the caller' };
    if (s.reason && R.has(s.reason)) return { key: 'r:' + s.reason, label: R.get(s.reason).notContained || `${R.get(s.reason).label}: not contained` };
    return { key: 'unsupported', label: 'Topic Amelia does not support, or the request was unclear' }; };
  const notC = [...by.abandoned, ...by.escalated]; const rm = new Map();
  for (const c of notC) { const r = classify(c); const e = rm.get(r.key) || { label: r.label, calls: 0, asked: 0, transferred: 0, hungUp: 0, unclear: 0, steps: 0, topics: new Map() }; const s = S(c) || {}; e.calls++; if (s.askedForPerson) e.asked++; if (c.cls === 'escalated') e.transferred++; else e.hungUp++; if (s.rephraseCount >= 2) e.unclear++; if (s.stepsGiven) e.steps++; const rr = s.reason && R.get(s.reason); if (rr) e.topics.set(rr.label, (e.topics.get(rr.label) || 0) + 1); rm.set(r.key, e); }
  const sorted = [...rm.values()].sort((a, b) => b.calls - a.calls);
  const what = (e) => { const b = []; const t = top(e.topics, 3).map(([k, v]) => `${k} (${v})`); if (t.length) b.push(t.join('; ')); const f = []; if (e.asked) f.push(`asked for a person (${e.asked})`); if (e.transferred) f.push(`transferred to an agent (${e.transferred})`); if (e.hungUp) f.push(`caller hung up or timed out (${e.hungUp})`); if (e.unclear) f.push(`repeated unclear answers (${e.unclear})`); if (e.steps) f.push(`steps or link given (${e.steps})`); if (f.length) b.push(f.join(', ')); return b.join(' — ').replace(/^./, (x) => x.toUpperCase()); };
  const shown = sorted.slice(0, 5); const restN = sorted.slice(5).reduce((a, e) => a + e.calls, 0);
  const reasons = { nonContained: notC.length, rows: shown.map((e, i) => ({ n: i + 1, label: e.label, calls: e.calls, share: Math.round(pct1(e.calls, notC.length)) + '%', what: what(e) })) };
  if (restN) reasons.rows.push({ n: shown.length + 1, label: 'Other reasons', calls: restN, share: Math.round(pct1(restN, notC.length)) + '%', what: `${sorted.length - 5} smaller reasons.` });
  const nm = new Map(); for (const c of convs) { const s = S(c); let k; if (s && s.reason && R.has(s.reason)) k = R.get(s.reason).label; else if (s && !s.intentStated) k = s.askedForPerson ? 'Asked for a person, no issue stated' : 'No usable answers or hung up during intake'; else { const i = val(c, 'matched_caller_intent').v; k = i ? pretty(i) : s ? 'Other or unclear requests' : 'No transcript to classify'; } nm.set(k, (nm.get(k) || 0) + 1); }
  const needs = top(nm, 12).map(([label, calls]) => ({ label, calls, share: pctS(calls, N) }));

  // ---- 7. the dictionary's categories: every metric, where its value came from, how often it has one
  const PRIMARY = { 'Call & Caller Context': ['caller_location', 'dialed_number_dnis'], 'Recognition & Knowledge': ['matched_caller_intent', 'kb_retrieval_status'], 'Interaction Quality': ['overall_conversation_sentiment', 'rephrase_count'], 'Survey & Feedback': ['caller_resolution_feedback', 'survey_completion_status'], 'Telephony & Messaging': ['sms_delivery_status', 'sms_opt_in', 'telephony_api_error_flag'] };
  const categories = dict.groups.map((g) => {
    const rows = g.metrics.map((m) => {
      const d = dist(m.key); const mm = match.get(m.key); const hidden = m.personal; let topv = '—';
      if (hidden) topv = m.kind === 'text' ? 'hidden (free text)' : 'hidden (personal data)';
      else if (m.kind === 'integer') { const xs = nums(m.key); topv = xs.length ? `average ${Math.round(mean(xs) * 100) / 100}` : '—'; } else if (d.items[0]) topv = `${m.key.includes('intent') || m.key === 'final_disposition' ? pretty(d.items[0].label) : d.items[0].label} (${Math.round(d.items[0].pct)}%)`;
      const source = d.n === 0 ? 'Not available' : d.transcript === 0 ? 'Recorded' : d.recorded === 0 ? 'From transcript' : 'Recorded + transcript';
      return { key: m.key, name: m.name, source, fill: d.n ? pctS(d.n, N) : '—', fillN: d.n, top: topv, recordedAs: mm && mm.method !== 'exact' ? mm.recorded : '', method: mm ? mm.method : null, description: m.description };
    });
    let chart = null; const title = (k) => (dict.metrics.find((x) => x.key === k) || {}).name || k;
    if (g.name === 'Outcome & Escalation') { const OC = { Contained: '1E7A46', 'Escalation by Design': '3E9E86', Abandoned: 'C48A12', Escalated: '2458A6' }; const items = [{ label: 'Contained', count: baseC }, { label: 'Escalation by Design', count: designN }, { label: 'Abandoned', count: aN }, { label: 'Escalated', count: eN }].filter((x) => x.count > 0); chart = { title: 'Call outcome', items, colors: items.map((x) => OC[x.label]) }; }
    else for (const k of PRIMARY[g.name] || g.metrics.map((m) => m.key)) { const m = dict.metrics.find((x) => x.key === k); const d = dist(k); if (m && d.n && !m.personal && m.kind !== 'integer') { let its = d.items.map((i) => [i.label, i.count]); if (m.kind === 'string' && N >= 10 && !m.key.includes('intent')) { const keep = its.filter(([, c]) => c >= 2); const lone = its.filter(([, c]) => c < 2).reduce((a, [, c]) => a + c, 0); its = lone ? [...keep, ['Other (single mentions)', lone]] : keep; } chart = { title: title(k), items: withOthers(its.map(([l, c]) => [m.key.includes('intent') ? pretty(l) : l, c]), 5, 'Other') }; break; } }
    const first = rows.find((r) => r.top !== '—' && !/^hidden/.test(r.top));
    return { name: g.name, rows, chart, takeaway: first ? `${first.name}: ${first.top}` : '' };
  });
  const allRows = categories.flatMap((c) => c.rows);
  const readiness = { total: dict.metrics.length, recording: allRows.filter((r) => r.fillN > 0).length, renamed: allRows.filter((r) => r.method === 'alias' || r.method === 'similar').length, fromTranscript: allRows.filter((r) => r.source === 'From transcript').length, missing: allRows.filter((r) => r.fillN === 0).length };

  // ---- 8. does the transcript agree with the recorded outcome?
  const both = convs.filter((c) => c.recordedClass && c.recordedClass !== 'design'); const agree = both.filter((c) => c.recordedClass === c.derivedClass).length;
  const linkLeft = by.abandoned.filter((c) => S(c) && S(c).stepsGiven && S(c).callerAccepted).length;
  const check = { compared: both.length, agree, differ: both.length - agree };

  // ---- 9. notes and recommendations (each with its evidence)
  const notes = [];
  notes.push(designN ? `${plural(designN, 'call')} recorded as abandoned mention an agent transfer in the transcript. They are shown as Escalation by Design and counted as contained.` : 'No abandoned call mentions an agent transfer in its transcript, so Escalation by Design is 0.');
  if (derivedN) notes.push(`${plural(derivedN, 'conversation')} had no recorded Final Disposition; the outcome was read from the platform flags and the transcript.`);
  if (linkLeft) notes.push(`${plural(linkLeft, 'abandoned call')} ended after the caller accepted steps or a link. ${linkLeft === 1 ? 'It stays' : 'They stay'} abandoned because the call outcome says so, but ${linkLeft === 1 ? 'it matches' : 'they match'} the definition “steps or a link given, accepted, no transfer”.`);
  const recs = []; const intake = by.abandoned.filter((c) => S(c) && S(c).leftAtIntake).length; const asked = notC.filter((c) => S(c) && S(c).askedForPerson).length; const stepsFail = notC.filter((c) => S(c) && S(c).stepsGiven).length; const unsup = (rm.get('unsupported') || { calls: 0 }).calls;
  if (aN && (intake >= 3 || pct1(intake, aN) >= 30)) recs.push({ w: intake, title: 'Adjusting the Demographic Info Capturing Pattern', summary: `Shift the call flow so the purpose of the call is asked before caller details are gathered: ${intake} of ${aN} abandoned calls ended during name, username, phone or location capture.` });
  if (notC.length && (asked >= 3 || pct1(asked, notC.length) >= 15)) recs.push({ w: asked, title: 'Live Agent Rebuttal', summary: `When callers first ask for an agent, try once to gather the purpose of the call before escalating: ${asked} of ${notC.length} calls that were not contained included a request for a person.` });
  if (stepsFail) recs.push({ w: stepsFail, title: 'Self-service steps and links', summary: `${plural(stepsFail, 'call')} got steps or a link and still ended abandoned or escalated. Check that the text arrives and the steps are clear.` });
  if (unsup >= 2) recs.push({ w: unsup, title: 'Topic coverage', summary: `${plural(unsup, 'call')} asked for something Amelia does not support or could not understand. Review these requests for a new self-service path or a clearer transfer message.` });
  if (designN) recs.push({ w: designN, title: 'Escalation by Design', summary: `${plural(designN, 'abandoned call')} ended in an agent transfer. Confirm the flows record these as escalations so the platform report matches this one.` });
  if (check.differ) recs.push({ w: check.differ, title: 'Align recorded outcomes with the transcripts', summary: `The transcript suggests a different outcome than the recorded Final Disposition on ${check.differ} of ${check.compared} calls. Review how the flow sets Final Disposition.` });
  if (readiness.renamed) recs.push({ w: 0.5, title: 'Align the flows with the dictionary', summary: `${plural(readiness.renamed, 'metric')} are recorded under a different name than the dictionary. Choose one name for the flows and the dictionary.` });
  recs.sort((a, b) => b.w - a.w); if (!recs.length) recs.push({ w: 0, title: 'No major issues found', summary: 'No pattern in this period needs a flow change. Re-run on a longer period to confirm.' });

  return { meta: { N, period, domain: [...new Set(convs.map((c) => c.domain).filter(Boolean))].join(', '), from: dates[0] && dates[0][0], to: dates.length && dates[dates.length - 1][0], transcripts: nTx, hasTranscripts: nTx > 0, header: tax.header || (opts.customer ? `${opts.customer} + SoundHound` : 'SoundHound'), customer: opts.customer || tax.customer || '', title: opts.title || 'Amelia Custom Metrics Report', dictionary: { title: dict.title, source: dict.source, metrics: dict.metrics.length, groups: dict.groups.length } },
    detail: [...by.abandoned, ...by.escalated, ...convs.filter((c) => c.accepted)].map((c) => { const sg = S(c); return { id: c.id, when: c.date && c.hour != null ? stamp(c) : '', channel: c.channel, outcome: c.accepted ? 'Contained (set by you)' : LABEL[c.cls], recorded: c.recordedClass ? LABEL[c.recordedClass] : 'Not recorded', outcomeFrom: c.outcomeFrom, handle: mmss(handleOf(c)), closedBy: c.closedBy || '', agentAnswered: c.agentHandled, leftWhileWaiting: c.cls === 'escalated' ? c.escAbandoned : null, agentTransfer: !!(sg && sg.agentTransfer), lastPrompt: sg ? (sg.stepsGiven && sg.callerAccepted ? 'After steps or a link were given' : sg.lastPrompt) : '', reason: sg && sg.reason ? (R.get(sg.reason) || {}).label || '' : '', timedOut: /timeout/i.test(c.closedBy || '') }; }),
    kpis, outcome, definition: 'Contained = Amelia gave steps or a link, the caller accepted it, and the call was not transferred. Escalation by Design (an abandoned call whose transcript shows an agent transfer) is counted as contained, and so is any call you mark as contained in config.yaml (contained_calls).',
    days, abandonWhere, recordedAbandoned: recordedAbandoned.length, escalationDrivers, kb, reasons, needs, categories, readiness, check, notes, recommendations: recs.slice(0, 5).map(({ title, summary }) => ({ title, summary })), match: [...match.entries()].map(([k, v]) => ({ key: k, ...v })),
    perConversation: convs.map((c) => ({ id: c.id, date: c.date, channel: c.channel, outcome: LABEL[c.design ? 'design' : c.cls], contained: c.cls === 'contained', handleSec: handleOf(c), outcomeFrom: c.outcomeFrom, recorded: c.recordedClass ? LABEL[c.recordedClass] : '', transcriptOutcome: LABEL[c.derivedClass], agentTransferMentioned: !!(c.sig.has && c.sig.agentTransfer), lastPrompt: c.sig.has ? c.sig.lastPrompt : '', reason: c.sig.has && c.sig.reason ? (R.get(c.sig.reason) || {}).label || '' : '' })) };
}
module.exports = { analyze, fmt, pct1, pctS, mmss, matchRecorded, classOf };
