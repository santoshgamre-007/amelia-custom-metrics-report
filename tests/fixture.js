'use strict';
// Synthetic Amelia export with KNOWN answers (no real customer data). 100 conversations = 5 cycles of 20 classes (j = i % 20):
//   j 0-11 contained (recorded "Contained"; 0-7 password reset with a KB article + text link, 8-11 browser cache; 0-3 also answer the survey)
//   j 12 abandoned at the username prompt · 13 abandoned after an unusable answer · 14 abandoned after steps+accepted
//   j 15 recorded ABANDONED but the transcript mentions an agent transfer  → Escalation by Design (5 calls)
//   j 16 abandoned at the phone-number prompt
//   j 17 escalated (caller asked for a person) · 18 escalated (Cerner, out of scope) · 19 escalated (unclear answers)
// Handle time: contained 150 s, abandoned 60 s, escalated 90 s.
const HEAD = ['Conversation Id', 'Domain', 'Created', 'Ended', 'Finished', 'Status', 'Channel', 'Primary Agent Email', 'Primary Agent Handle Time', 'Primary Agent Answer Speed', 'Pickup SLA Violation', 'Escalated', 'Escalation Queue', 'Escalation Reason', 'Abandoned', 'Amelia Handled', 'Amelia Abandoned', 'Agent Handled', 'Agent Abandoned', 'Escalate Abandoned', 'Total Handle Time', 'Executed BPNs', 'User Name', 'User Email', 'User External Uid', 'Disconnect Wait Time', 'After Conversation Time', 'After Conversation Violation', 'Resolution Codes', 'Custom Metrics', 'ConversationClosedBy', 'Escalation Log', 'Transcript', 'Executed Cognitive Agents', 'Executed Cognitive Functions', 'Conversation Topics', 'Total Input Tokens', 'Total Output Tokens', 'Resolution Status'];
const NAME = 'Test Caller'; const UTT = ['I cannot get into my account', 'my browser is slow', 'need a new badge printed', 'the app keeps closing'];
const hms = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const q = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const turn = (who, text, sec) => `${who === 'a' ? 'Amelia' : NAME} [10/20/2026 10:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}]: ${text}`;
const GREET = [['a', 'Thank you for calling the service desk. To start, please give me your first and last name.'], ['c', 'My name is Test Caller'], ['a', 'Please spell out your user name one character at a time.'], ['c', 'T E S T C']];
const ASK = ['a', 'How can I help you today?']; const CLOSE = ['a', 'This conversation has been closed.'];
function script(j, i) {
  const survey = j <= 3 ? [['a', 'Were you able to resolve your issue?'], ['c', 'Yes'], ['a', 'Would you recommend Amelia to a colleague?'], ['c', 'Yes']] : [];
  const sets = {
    pw: [...GREET, ASK, ['c', 'I need to reset my password'], ['a', 'I have sent the link to the self-service password reset page to your phone. Let me know once you receive it.'], ['c', 'ok thanks'], ...survey, CLOSE],
    cache: [...GREET, ASK, ['c', 'my browser is slow and freezing'], ['a', 'I can help clear the Google Chrome cache. I will walk you through the steps now.'], ['c', 'ok'], ...survey, CLOSE],
    12: [GREET[0], GREET[1], GREET[2], CLOSE], 13: [...GREET, ASK, ['c', 'idk'], ['a', "Sorry, I didn't catch that. How can I help you today?"], CLOSE],
    14: [...GREET, ASK, ['c', 'my browser is slow and freezing'], ['a', 'I can help clear the Google Chrome cache. I sent you a link to the steps.'], ['c', 'ok'], CLOSE],
    15: [...GREET, ASK, ['c', 'I need help with my badge'], ['a', "I can certainly connect you with someone who can help. I'm transferring you to an agent now. This is an agent transfer."], CLOSE],
    16: [...GREET.slice(0, 2), ['a', 'What is the best phone number to reach you?'], CLOSE],
    17: [...GREET, ASK, ['c', 'I need to speak to an agent'], ['a', "I can certainly connect you with someone who can help. This request requires a live agent. I'm transferring you now."]],
    18: [...GREET, ASK, ['c', 'my cerner powerchart is not opening'], ['a', "Let me connect you with someone who can help. I'm transferring you now."]],
    19: [...GREET, ASK, ['c', 'I cannot log in'], ['a', "Sorry, I didn't catch that."], ['c', 'no'], ['a', "I'm sorry, I didn't understand that."], ['c', 'no'], ['a', "Let me connect you with someone who can help. I'm transferring you now."]],
  };
  const t = j <= 7 ? sets.pw : j <= 11 ? sets.cache : sets[j]; return t.map(([w, x], k) => turn(w, x, 10 + k * 7)).join('||');
}
function build({ n = 100, domain = 'pennstatehealth', transcripts = true, dropDisposition = [] } = {}) {
  const rows = [HEAD.map(q).join(',')];
  for (let i = 0; i < n; i++) {
    const j = i % 20; const cls = j <= 11 ? 'Contained' : j <= 16 ? 'Abandoned' : 'Escalated'; const esc = j >= 17; const handle = j <= 11 ? 150 : j <= 16 ? 60 : 90;
    const day = 19 + (i % 5); const created = `2026-10-${day}T${String(8 + (i % 10)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:30.000-04:00[America/New_York]`;
    const loc = i === 1 ? '12 Maple Street' : i === 2 ? '99 Oak Lane' : i % 4 === 0 ? 'Hershey Medical Center' : 'Remote';
    const m = { 'Rephrase Count': j === 19 ? '2' : '0', conversationID: `C${i}`, 'caller Location': loc, 'Caller Resolution Feedback': j <= 3 ? 'Yes' : 'No Response', 'Repeat Count': '0', 'Escalation Trigger': j === 17 ? 'Caller Requested Human' : j === 18 ? 'Out-of-Scope Request' : j === 19 ? 'Unclear-Response Limit Reached' : 'NA',
      'Final Disposition': cls, 'Matched Caller Intent': j <= 7 ? 'password_reset' : j <= 11 ? 'clear_browser_cache' : 'NA', 'Text Delivery Status': j <= 7 ? 'Delivered' : 'NA', DNIS: '6638', 'Telephony API Error Flag': 'false', voice_sip_call_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      'Survey Completion Status': j <= 3 ? 'Completed' : 'Dropped/Escalated Before Survey', 'Caller Recommendation Feedback': j <= 3 ? 'Yes' : 'No Response', 'Overall Conversation Sentiment': 'Neutral', 'KB Retrieval Status': j <= 7 ? 'Match found' : 'NA', 'SMS Opt-In': j <= 7 ? 'true' : 'false', ANI: `+1555123${String(1000 + i)}`, 'Matched KB Article': j <= 7 ? 'KB0023618' : 'NA', 'Initial Caller Utterance': UTT[i % 4] };
    for (const k of dropDisposition) if (k === i) delete m['Final Disposition'];
    const cm = Object.entries(m).map(([k, v]) => `${k}=${v}`).join('||');
    const row = [`C${i}`, domain, created, created, created, 'CLOSED', i % 3 === 0 ? 'webchat' : 'voice', '', '00:00:00', '00:00:00', 'false', esc ? 'true' : 'false', esc ? 'queue::x' : '', esc ? 'Escalation' : '', '0', 'false', 'false', 'false', 'false', 'false', hms(handle), '', NAME, 'em@il.anon', 'XXXX', '00:00:02', '', '', '', cm, 'user', esc ? 'log' : '', transcripts ? script(j, i) : '', '', '', 'Topic::RESOLVED::x', '', '', j <= 11 ? 'RESOLVED' : 'UNRESOLVED'];
    rows.push(row.map(q).join(','));
  }
  return rows.join('\n') + '\n';
}
module.exports = { build, NAME, UTT, HEAD, script };
