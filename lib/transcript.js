'use strict';
// Reads one conversation transcript ("Speaker [MM/DD/YYYY HH:MM:SS]: text||Speaker [..]: text") and turns it into SIGNALS:
// who asked for what, whether Amelia handed the caller to an agent, steps/links given, survey answers, where the caller left.
// Only signals are returned — never the caller's words or name.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  agentRequest: ['\\b(agent|representative|human|real person|live person|operator|supervisor|someone|somebody)\\b', '\\b(speak|talk|connect|transfer)\\b.{0,20}\\b(to|with|me)\\b', 'service ?desk|help ?desk'],
  // Amelia (or the platform) saying the caller is being handed to an agent — "agent transfer" in any of its wordings
  agentTransfer: ['agent transfer', 'transferring you', 'transfer you', 'transferred you', 'transfer(red)? (the|your) call', 'connect(ing)? you (with|to)', 'connecting you', 'live agent', 'hand(ing)? you (over|off)', 'escalat(e|ing) (this|your|the)'],
  unclear: ['didn.?t (catch|understand|get)', 'not sure i (understood|follow)', '(could|can) you (please )?(rephrase|repeat|say (that )?again)', 'sorry,? i (didn|did not|couldn)', 'i.?m sorry, i'],
  repeatAsk: ['\\b(repeat|say that again|say it again|pardon|come again|what did you say|one more time)\\b'],
  steps: ['sent (you )?(the |a )?(link|text)', 'text(ed)? (you|the link)', 'send (you )?a (text|link)', 'walk you through', 'follow these steps', 'here are the steps', 'step[- ]by[- ]step', 'KB\\d{5,}'],
  linkSent: ['sent (you )?(the |a )?(link|text)', 'text(ed)? you'],
  accept: ['^(yes|yeah|yep|ok|okay|sure|thanks|thank you|got it|received|i (got|received) it)\\b'],
  yes: ['^(yes|yeah|yep|yup|sure|i was|it did|correct|definitely)\\b'], no: ['^(no|nope|nah|not really|it did not|it didn.?t|i was not|i wasn.?t)\\b'],
  resolveQuestion: ['resolve (your|the) issue', 'able to resolve', 'did (that|this) (resolve|solve|fix)', 'was your issue resolved'], recommendQuestion: ['recommend'],
  unusableAnswer: '^(i )?(don.?t know|idk|no|yes|uh+|um+|hello|hi|hey|nothing|n/?a|okay|ok)\\W*$',
  closingMessage: 'conversation has been closed|thank you for calling|goodbye|have a (great|good|nice) day',
  intentPrompt: 'how can i help',
  prompts: [{ label: 'Username prompt', re: 'user ?name' }, { label: 'Name prompt', re: 'first and last name|your (full )?name' }, { label: 'Phone number prompt', re: 'phone number|call ?back number|number where' }, { label: 'Location prompt', re: 'location|where are you|which (building|site|hospital)' }, { label: '"How can I help you today?"', re: 'how can i help' }],
  intakePrompts: ['Username prompt', 'Name prompt', 'Phone number prompt', 'Location prompt'],
  callingReasons: [], kbTitles: {}, header: '', timeLabel: '', customer: '',
};
const rx = (s) => new RegExp(s, 'i'); const rxs = (a) => a.map(rx);

/** Defaults, then the domain's rules (dictionaries/<domain>.taxonomy.json) on top. */
function loadTaxonomy({ domainCode, dir, file, data } = {}) {
  let user = data || {}; const cands = [file, domainCode && dir ? path.join(dir, `${domainCode}.taxonomy.json`) : null].filter(Boolean);
  if (!data) for (const f of cands) if (fs.existsSync(f)) { try { user = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`The rules file ${path.basename(f)} could not be read: ${e.message}`); } break; }
  const t = { ...DEFAULTS, ...user };
  t._c = { agentRequest: rxs(t.agentRequest), agentTransfer: rxs(t.agentTransfer), unclear: rxs(t.unclear), repeatAsk: rxs(t.repeatAsk), steps: rxs(t.steps), linkSent: rxs(t.linkSent), accept: rxs(t.accept), yes: rxs(t.yes), no: rxs(t.no), resolveQ: rxs(t.resolveQuestion), recommendQ: rxs(t.recommendQuestion),
    unusable: rx(t.unusableAnswer), closing: rx(t.closingMessage), intentPrompt: rx(t.intentPrompt), prompts: t.prompts.map((p) => ({ label: p.label, re: rx(p.re) })), reasons: (t.callingReasons || []).map((r) => ({ ...r, re: r.re ? rx(r.re) : null, intentRe: r.intents ? rx(r.intents) : null })) };
  return t;
}

const TURN = /^(.+?) \[(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d):(\d\d)\]: ([\s\S]*)$/;
/** → [{ who: 'amelia' | 'caller' | 'agent', t: epoch seconds, text }]. Anyone who is not Amelia or an agent is the caller (labelled by name). */
function parseTurns(text) {
  const out = [];
  for (const seg of String(text || '').split('||')) {
    const m = seg.match(TURN); if (!m) { if (out.length && seg.trim()) out[out.length - 1].text += ' ' + seg.trim(); continue; }
    const who = /^amelia$/i.test(m[1].trim()) ? 'amelia' : /^(live[ -]?)?agent\b|^service ?desk\b|^analyst\b/i.test(m[1].trim()) ? 'agent' : 'caller';
    out.push({ who, t: Date.UTC(+m[4], +m[2] - 1, +m[3], +m[5], +m[6], +m[7]) / 1000, text: m[8].trim() });
  }
  return out;
}

const any = (list, s) => list.some((r) => r.test(s));
/** The signals of one conversation. `ctx.intentLabel` = the recorded matched intent (second source for the calling reason). */
function analyzeTranscript(transcript, tax, ctx = {}) {
  const T = tax._c; const turns = parseTurns(transcript); if (!turns.length) return { has: false };
  const real = turns.filter((x) => !(x.who === 'amelia' && T.closing.test(x.text)));
  const amelia = real.filter((x) => x.who === 'amelia'); const caller = real.filter((x) => x.who === 'caller'); const nonCaller = turns.filter((x) => x.who !== 'caller');
  const ts = turns.map((x) => x.t).filter((x) => x != null); const durationSec = ts.length ? Math.max(0, Math.max(...ts) - Math.min(...ts)) : null;
  // what the caller said when asked "How can I help you today?" is the stated request; if that question was never asked, nothing was stated
  const ip = real.findIndex((x) => x.who === 'amelia' && T.intentPrompt.test(x.text)); const lastAm = amelia[amelia.length - 1];
  const leftAtIntake = !!lastAm && T.prompts.some((p) => tax.intakePrompts.includes(p.label) && p.re.test(lastAm.text));
  const reasonHit = (s) => T.reasons.some((r) => r.re && r.re.test(s)); const agentOnly = (s) => any(T.agentRequest, s) && !reasonHit(s) && s.split(/\s+/).length <= 8;
  const usable = (s) => s.split(/\s+/).length >= 2 && !T.unusable.test(s.trim()) && !agentOnly(s);
  let intentText = ''; let intentStated = false;
  if (ip >= 0) { const next = real.slice(ip + 1).find((x) => x.who === 'caller'); if (next) { intentText = next.text; intentStated = usable(next.text); } }
  else if (!leftAtIntake && caller.length) { intentText = caller.map((x) => x.text).join(' '); intentStated = caller.some((x) => x.text.split(/\s+/).length >= 3 && usable(x.text)); }
  const answerTo = (re) => { const i = real.findIndex((x) => x.who === 'amelia' && any(re, x.text)); if (i < 0) return { asked: false, answer: null }; const a = real.slice(i + 1).find((x) => x.who === 'caller'); const s = a ? a.text.trim() : ''; return { asked: true, answer: !a ? null : any(T.yes, s) ? 'Yes' : any(T.no, s) ? 'No' : null }; };
  const steps = amelia.find((x) => any(T.steps, x.text)); const after = steps ? real.slice(real.indexOf(steps) + 1).filter((x) => x.who === 'caller') : [];
  let reason = null; const hay = `${intentText} ${caller.slice(0, 6).map((x) => x.text).join(' ')}`;
  for (const r of T.reasons) if ((r.re && r.re.test(hay)) || (intentStated && r.intentRe && ctx.intentLabel && r.intentRe.test(ctx.intentLabel))) { reason = r.key; break; }
  const hit = lastAm && T.prompts.find((p) => p.re.test(lastAm.text)); const resolve = answerTo(T.resolveQ); const recommend = answerTo(T.recommendQ);
  return { has: true, turns: { caller: caller.length, amelia: amelia.length, agent: real.filter((x) => x.who === 'agent').length }, durationSec,
    intentStated, askedForPerson: caller.some((x) => any(T.agentRequest, x.text)),
    rephraseCount: amelia.filter((x) => any(T.unclear, x.text)).length, repeatCount: caller.filter((x) => any(T.repeatAsk, x.text)).length,
    agentTransfer: nonCaller.some((x) => any(T.agentTransfer, x.text)),                       // "agent transfer" mentioned by Amelia / the agent / the platform
    stepsGiven: !!steps, linkSent: amelia.some((x) => any(T.linkSent, x.text)), callerAccepted: !!steps && after.some((x) => any(T.accept, x.text.trim())),
    resolveAsked: resolve.asked, resolveAnswer: resolve.answer, recommendAsked: recommend.asked, recommendAnswer: recommend.answer,
    lastPrompt: lastAm ? (hit ? hit.label : 'Mid-flow, after a prompt from Amelia') : 'Others', leftAtIntake: !!hit && tax.intakePrompts.includes(hit.label), reason };
}
module.exports = { loadTaxonomy, parseTurns, analyzeTranscript };
