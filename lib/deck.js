'use strict';
// Builds the PowerPoint report from the customer's own template deck (the "Since Go Live" conversation-analysis deck).
// Slides: headline numbers · calls by day · why abandoned and escalated · contained by KB topic · one slide per dictionary category ·
// recommendations · top reasons not contained · what callers needed.
const fs = require('fs');
const path = require('path');
const { Deck } = require('./pptx');
const { bucketDays } = require('./util');
const { fmt } = require('./analysis');

const IN = 914400; const C = { green: '1E7A46', teal: '3E9E86', gold: 'C48A12', blue: '2458A6', purple: '5B1F8F' };
// shape ids in the template's slides (original deck: slide1,2,3,4,8,9,10 carry data; 5,6,7 are static flow screenshots)
const ID = { s1: { header: 14, title: 15, sub: 16, foot: 17 }, s2: { header: 56, title: 57, sub: 58, foot: 59 }, s3: { header: 76, title: 77, sub: 78, foot: 79 }, s4: { header: 95, title: 96, sub: 97, foot: 98 }, s8: { header: 172, title: 173, sub: 174, foot: 175 }, s9: { header: 187, title: 188, sub: 189, foot: 190 }, s10: { header: 202, title: 203, sub: 204, foot: 205 } };
const pc = (n) => `${n}%`;

function buildDeck(m, { templatePath, templateBuffer } = {}) {
  const deck = new Deck(templateBuffer || fs.readFileSync(templatePath || path.join(__dirname, '..', 'templates', 'report_template.pptx')));
  const part = (n) => `ppt/slides/slide${n}.xml`; const O = m.outcome; const N = O.total; const M = m.meta; const data = M.period ? `Data: ${M.period}` : '';
  for (const n of [5, 6, 7]) deck.removeSlide(part(n)); deck.stripNotes();               // the three flow-screenshot slides are static pictures, not data
  const catParts = m.categories.map((_, i) => deck.cloneSlide(part(4), 4 + i));
  const reasonsPart = part(9), needsPart = part(10);
  if (!M.hasTranscripts) { deck.removeSlide(reasonsPart); deck.removeSlide(needsPart); }
  const order = deck.slideList().map((s) => s.part); const K = order.length; const titles = [];
  const common = (p, id, title) => { const k = order.indexOf(p) + 1; titles[k - 1] = title; deck.setText(p, id.header, M.header); deck.setText(p, id.title, title); deck.setText(p, id.sub, `${fmt(N)} conversations${M.period ? `, ${M.period}` : ''} • ${k} of ${K}`); deck.setText(p, id.foot, `©${new Date().getFullYear()} SoundHound AI, Inc. Confidential and Proprietary.`); };
  const dl = (p, ids) => ids.forEach((i) => deck.setText(p, i, data));

  // 1 · headline: Total conversations · Contained · Abandoned · Escalated, and average handle time for Contained, Abandoned, Escalated, All calls
  { const p = part(1); common(p, ID.s1, `${M.deckTitle || 'Conversation Analysis'} — ${fmt(N)} Calls`); dl(p, [21, 31, 36, 39]);
    deck.setText(p, 19, fmt(N)); deck.setText(p, 23, fmt(O.contained)); deck.setText(p, 24, pc(O.pct.contained)); deck.setText(p, 28, fmt(O.abandoned)); deck.setText(p, 29, pc(O.pct.abandoned)); deck.setText(p, 33, fmt(O.escalated)); deck.setText(p, 34, pc(O.pct.escalated));
    deck.setText(p, 26, `Incl. ${fmt(O.design)} Escalation by Design`);
    deck.setText(p, 40, O.handle.contained); deck.setText(p, 41, `Contained (${fmt(O.contained)} calls)`); deck.setText(p, 42, O.handle.abandoned); deck.setText(p, 43, `Abandoned (${fmt(O.abandoned)} calls${O.timedOutAbandoned ? `; typical ${O.handleTypicalAbandoned} without timeouts` : ''})`); deck.setText(p, 44, O.handle.escalated); deck.setText(p, 45, `Escalated (${fmt(O.escalated)} calls${O.escalatedSplit.known ? `; ${fmt(O.escalatedSplit.answered)} answered by an agent` : ''})`); deck.setText(p, 46, O.handle.all); deck.setText(p, 47, `All calls (${fmt(N)})`);
    const txt = [m.definition, ...m.notes.slice(0, 2)].join(' '); deck.setBox(p, 48, { y: 6.62 * IN, h: 0.62 * IN }); deck.setText(p, 48, txt, { size: txt.length > 330 ? 800 : txt.length > 230 ? 900 : undefined }); }

  // 2 · calls by day (C contained · D Escalation by Design · A abandoned · E escalated)
  { const p = part(2); const b = bucketDays(m.days); common(p, ID.s2, `Calls by ${b.unit === 'week' ? 'Week' : 'Day'}`); dl(p, [62, 66]); deck.setText(p, 61, `Calls by ${b.unit} and outcome`); deck.setText(p, 65, `Numbers by ${b.unit}`);
    deck.setChart(deck.chartPartOf(p, 63), { categories: b.rows.map((d) => d.label), series: [{ name: 'Contained', values: b.rows.map((d) => d.contained), color: C.green }, { name: 'Escalation by Design', values: b.rows.map((d) => d.design), color: C.teal }, { name: 'Abandoned', values: b.rows.map((d) => d.abandoned), color: C.gold }, { name: 'Escalated', values: b.rows.map((d) => d.escalated), color: C.blue }] });
    deck.addColumn(p, 67, 2); deck.setHeader(p, 67, [b.unit === 'week' ? 'Week' : 'Day', 'Calls', 'C', 'D', 'A', 'E'], [1.3 * IN, 0.55 * IN, 0.5 * IN, 0.5 * IN, 0.5 * IN, 0.55 * IN]); const rowH = Math.min(0.4, 3.3 / (b.rows.length + 1)) * IN;
    deck.fillTable(p, 67, { rows: b.rows.map((d) => [d.label, d.total, d.contained, d.design, d.abandoned, d.escalated]), total: ['All', N, O.baseContained, O.design, O.abandoned, O.escalated], rowH, size: rowH < 0.3 * IN ? 800 : undefined });
    deck.setText(p, 68, `C = contained, D = Escalation by Design (an abandoned call whose transcript shows an agent transfer; counted as contained), A = abandoned, E = escalated.${b.unit === 'week' ? ' Days are grouped into weeks.' : ''}`); }

  // 3 · why calls abandoned and escalated
  { const p = part(3); common(p, ID.s3, 'Why Calls Abandoned and Escalated'); dl(p, [82, 86]); deck.setText(p, 81, `Where callers abandoned (all ${fmt(m.recordedAbandoned)} recorded as abandoned)`); deck.setText(p, 85, `What drove escalations (all ${fmt(O.escalated)})`);
    const a = [{ label: 'Escalation by Design (agent transfer)', count: O.design }, ...m.abandonWhere]; const e = m.escalationDrivers.length ? m.escalationDrivers : [{ label: 'No escalated calls', count: 0 }];
    deck.setChart(deck.chartPartOf(p, 83), { categories: a.map((x) => x.label), series: [{ name: 'Calls', values: a.map((x) => x.count) }], pointColors: a.map((x, i) => (i === 0 ? C.teal : C.gold)) });
    deck.setChart(deck.chartPartOf(p, 87), { categories: e.map((x) => x.label), series: [{ name: 'Calls', values: e.map((x) => x.count) }] }); }

  // 4 · contained calls by KB article and topic
  { const p = part(4); common(p, ID.s4, 'Contained Calls by KB Topic'); dl(p, [101, 106]); deck.setText(p, 100, `Contained calls by KB article (all ${fmt(O.contained)})`); deck.setText(p, 105, 'Contained calls by topic');
    const rows = m.kb.rows.length ? m.kb.rows.map((r) => [r.title, r.kb, r.calls, r.share]) : [['No knowledge-base article recorded', '', 0, '—']]; deck.setHeader(p, 102, ['KB article', 'KB number', 'Calls', 'Share']);
    deck.fillTable(p, 102, { rows, total: ['Total contained', '', O.contained, O.contained ? '100%' : '—'], rowH: Math.min(0.62, 3.1 / (rows.length + 1)) * IN }); deck.setText(p, 103, m.kb.note);
    const t = m.kb.topics.length ? m.kb.topics : [{ label: 'No contained calls', count: 0 }]; deck.setChart(deck.chartPartOf(p, 107), { categories: t.map((x) => x.label), series: [{ name: 'Calls', values: t.map((x) => x.count) }], pointColors: t.map((x) => (x.label === 'Escalation by Design' ? C.teal : C.green)) }); }

  // 5 · one slide per dictionary category
  const cc = [C.blue, C.green, C.gold, C.purple, C.blue, C.green];
  m.categories.forEach((c, i) => { const p = catParts[i]; common(p, ID.s4, `Custom Metrics — ${c.name}`); dl(p, [101, 106]); deck.setText(p, 100, `${c.name} metrics (${c.rows.length})`); deck.setText(p, 105, c.chart ? c.chart.title : 'No data');
    deck.setHeader(p, 102, ['Metric', 'Source', 'Has a value', 'Most common value (share of those with a value)'], [2.0 * IN, 1.2 * IN, 0.9 * IN, 2.5 * IN]);
    deck.fillTable(p, 102, { rows: c.rows.map((r) => [r.recordedAs ? `${r.name} (written as “${r.recordedAs}”)` : r.name, r.source, r.fill, r.top]), rowH: Math.min(0.62, 3.4 / (c.rows.length + 1)) * IN, size: 1000 });
    const extra = c.name === 'Outcome & Escalation' ? ` ${O.design ? `${fmt(O.design)} abandoned call(s) mention an agent transfer and are counted as contained (Escalation by Design).` : 'No abandoned call mentions an agent transfer (Escalation by Design = 0).'} The transcript agrees with the recorded outcome on ${fmt(m.check.agree)} of ${fmt(m.check.compared)} calls.` : '';
    deck.setText(p, 103, `${c.takeaway ? c.takeaway + '.' : ''}${extra}`.trim() || 'See the table for how each agreed metric is recorded.'); const its = c.chart && c.chart.items.length ? c.chart.items : [{ label: 'No data', count: 0 }];
    deck.setChart(deck.chartPartOf(p, 107), { categories: its.map((x) => x.label), series: [{ name: 'Calls', values: its.map((x) => x.count), color: cc[i] }], pointColors: c.chart && c.chart.colors ? c.chart.colors.slice(0, its.length) : null }); });

  // 6 · recommendations · reasons not contained · what callers needed
  { const p = part(8); common(p, ID.s8, 'Recommendations & Feedback'); dl(p, [178]); deck.fillTable(p, 179, { rows: m.recommendations.map((r, i) => [i + 1, r.title, r.summary]), rowH: Math.min(0.75, 3.9 / (m.recommendations.length + 1)) * IN }); }
  if (M.hasTranscripts) {
    { const p = reasonsPart; const R = m.reasons; common(p, ID.s9, `Top ${Math.min(5, R.rows.length)} Reasons Amelia Could Not Contain Calls`); dl(p, [193]); deck.setText(p, 192, `Why ${fmt(R.nonContained)} of the ${fmt(N)} calls were not contained (each call counted once, under its main reason)`);
      const rows = R.rows.length ? R.rows.map((r) => [r.n, r.label, r.calls, r.share, r.what]) : [['', 'Every call was contained', 0, '—', '']]; const rowH = Math.min(0.64, 3.5 / (rows.length + 1)) * IN; deck.fillTable(p, 194, { rows, total: ['', 'Total (calls not contained)', R.nonContained, R.nonContained ? '100%' : '—', ''], rowH, size: rowH < 0.5 * IN ? 900 : undefined }); }
    { const p = needsPart; common(p, ID.s10, 'What Callers Needed'); dl(p, [208]); deck.setText(p, 207, `Calling reasons (all ${fmt(N)})`); const rows = m.needs.map((r) => [r.label, r.calls, r.share]); deck.fillTable(p, 209, { rows, total: ['Total', N, '100%'], rowH: Math.min(0.4, 3.6 / (rows.length + 1)) * IN }); }
  }
  deck.dropUnusedMedia();
  const core = 'docProps/core.xml'; if (deck.has(core)) { const e = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); let x = deck.text(core).replace(/<dc:title>[\s\S]*?<\/dc:title>|<dc:title\/>/, '').replace('</cp:coreProperties>', `<dc:title>${e(M.title)}</dc:title></cp:coreProperties>`); deck.put(core, x); }
  return { buffer: deck.toBuffer(), slides: K, titles };
}
module.exports = { buildDeck };
