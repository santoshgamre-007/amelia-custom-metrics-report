'use strict';
// One run: conversations in → analysis → dashboard (HTML) + PowerPoint + per-conversation CSV out.
const fs = require('fs');
const path = require('path');
const { decodeExport, readExport } = require('./export');
const { loadDictionary } = require('./dictionary');
const { loadTaxonomy } = require('./transcript');
const { analyze } = require('./analysis');
const { renderDashboard } = require('./dashboard');
const { buildDeck } = require('./deck');

const slug = (s) => String(s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report';
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Per-conversation analysis as CSV: ids, outcome, handle time and signals only — no names, numbers or caller words. */
function conversationsCsv(m) {
  const cols = ['id', 'date', 'channel', 'outcome', 'recorded outcome', 'transcript outcome', 'outcome from', 'agent transfer mentioned', 'handle seconds', 'last prompt', 'calling reason'];
  return [cols.join(','), ...m.perConversation.map((c) => [c.id, c.date, c.channel, c.outcome, c.recorded, c.transcriptOutcome, c.outcomeFrom, c.agentTransferMentioned ? 'yes' : 'no', c.handleSec == null ? '' : Math.round(c.handleSec), c.lastPrompt, c.reason].map(q).join(','))].join('\n') + '\n';
}

/** csvText → report files. Needs the customer's dictionary (dictionaries/<domain code>.xlsx). */
function buildReports(csvText, { reportsDir, dictionaryDir, dictionaryFile, taxonomyDir, templatePath, customer = '', title = '', powerpoint = true, timeLabel = '', containedCalls = [], defaultDictionary = '' } = {}) {
  const ex = readExport(csvText); const code = (ex.conversations.find((c) => c.domain) || {}).domain || '';
  const keep = ex.conversations.map((c) => ({ ...c }));       // analysis drops the transcripts; the local viewer keeps them in memory only
  const dict = loadDictionary({ file: dictionaryFile, domainCode: code, dir: dictionaryDir, defaultName: defaultDictionary });
  if (!dict) throw new Error(`There is no custom-metrics dictionary for the domain “${code || 'unknown'}”. Put the customer’s workbook in ${dictionaryDir || 'the dictionaries folder'} as ${code || '<domain code>'}.xlsx, or name a default workbook with default_dictionary in config.yaml.`);
  const tax = loadTaxonomy({ domainCode: code, dir: taxonomyDir || dictionaryDir });
  const ctitle = String(title || '').trim() || 'SoundHound | Amelia Custom Metrics Report';
  const m = analyze(ex, dict, tax, { customer: String(customer).slice(0, 80), title: ctitle.slice(0, 120), timeLabel, containedCalls }); m.problems = ex.problems; if (dict.fallbackFile) m.notes.unshift(`There is no custom-metrics workbook for the domain “${dict.fallbackFor}”, so the metrics in ${dict.fallbackFile} were used. Metrics this domain does not record are worked out from the transcript or shown as not recorded. Add ${dict.fallbackFor}.xlsx to the dictionaries folder to use its own list.`);
  fs.mkdirSync(reportsDir, { recursive: true }); const base = `amelia-custom-metrics_${slug(customer || code)}_${m.meta.from || 'na'}_${m.meta.to || 'na'}_${stamp()}`; const files = {}; const paths = {};
  const put = (k, ext, data) => { files[k] = base + ext; paths[k] = path.join(reportsDir, base + ext); fs.writeFileSync(paths[k], data); };
  put('dashboard', '.html', renderDashboard(m, { customer })); let deck = null; if (powerpoint) { deck = buildDeck(m, { templatePath }); put('pptx', '.pptx', deck.buffer); } put('csv', '_conversations.csv', conversationsCsv(m));
  return { base, files, paths, model: m, conversations: keep, summary: { rows: m.meta.N, transcripts: m.meta.transcripts, metrics: m.meta.dictionary.metrics, slides: deck ? deck.slides : 0, slideTitles: deck ? deck.titles : [], outcome: m.outcome, kpis: m.kpis, notes: m.notes, recommendations: m.recommendations.slice(0, 3), problems: m.problems, domain: m.meta.domain, period: m.meta.period } };
}
module.exports = { buildReports, conversationsCsv, decodeExport };
