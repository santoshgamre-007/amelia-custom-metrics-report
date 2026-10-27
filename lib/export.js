'use strict';
// Reads an Amelia conversation export (CSV) into plain conversation records.
const zlib = require('zlib');
const AdmZip = require('adm-zip');
const { parseCsv } = require('./csv');

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const COL = { id: ['conversationid'], domain: ['domain'], created: ['created'], channel: ['channel'], escalated: ['escalated'], queue: ['escalationqueue'], handle: ['totalhandletime'], closedBy: ['conversationclosedby'],
  topics: ['conversationtopics'], resolution: ['resolutionstatus'], custom: ['custommetrics'], transcript: ['transcript'], escLog: ['escalationlog'], status: ['status'], agentHandled: ['agenthandled'], escAbandoned: ['escalateabandoned'], ameliaAbandoned: ['ameliaabandoned'] };
const NA = /^(na|n\/a|null|none|undefined|unknown|-)?$/i;

/** The export may arrive as a zip, gzip or plain CSV (and in a few text encodings). */
function decodeExport(buf) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] === 0x50 && b[1] === 0x4b) { const z = new AdmZip(b); const e = z.getEntries().find((x) => /\.csv$/i.test(x.entryName)) || z.getEntries()[0]; if (!e) throw new Error('The downloaded zip is empty.'); b = e.getData(); }
  else if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b);
  if (b[0] === 0xff && b[1] === 0xfe) return b.toString('utf16le').replace(/^\ufeff/, '');
  return b.toString('utf8').replace(/^\ufeff/, '');
}
const hms = (s) => { const m = String(s || '').match(/^(\d+):(\d\d):(\d\d)$/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };
/** "Key=value||Key=value" — Amelia's one-column form of the custom metrics. Values 'NA' mean "not applicable". */
function parseMetrics(s) {
  const out = {}; for (const part of String(s || '').split('||')) { const i = part.indexOf('='); if (i <= 0) continue; out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); } return out;
}

/** → { conversations, columns, problems }. Each conversation keeps its raw transcript only until it has been analysed. */
function readExport(text) {
  const rows = parseCsv(text); if (rows.length < 2) throw new Error('The export has no conversations.');
  const head = rows[0].map(norm); const idx = {}; for (const [k, names] of Object.entries(COL)) { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) idx[k] = i; }
  const problems = []; if (idx.custom == null) problems.push('The export has no “Custom Metrics” column, so no custom metric can be read.'); if (idx.transcript == null) problems.push('The export has no “Transcript” column (request it with transcripts), so call reasons and Escalation by Design cannot be worked out.');
  const get = (r, k) => (idx[k] == null ? '' : (r[idx[k]] || '').trim()); const conversations = [];
  for (const r of rows.slice(1)) {
    const created = get(r, 'created'); const m = created.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/); const date = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    conversations.push({ id: get(r, 'id'), domain: get(r, 'domain'), date, hour: m ? +m[4] : null, minute: m ? +m[5] : null, dow: m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : null, zone: (created.match(/\[([^\]]+)\]/) || [])[1] || '',
      channel: get(r, 'channel'), escalated: /^true$/i.test(get(r, 'escalated')), queue: get(r, 'queue'), handleSec: hms(get(r, 'handle')), closedBy: get(r, 'closedBy'), topics: get(r, 'topics'), resolution: get(r, 'resolution'), status: get(r, 'status'), agentHandled: idx.agentHandled == null ? null : /^true$/i.test(get(r, 'agentHandled')), escAbandoned: idx.escAbandoned == null ? null : /^true$/i.test(get(r, 'escAbandoned')), ameliaAbandoned: idx.ameliaAbandoned == null ? null : /^true$/i.test(get(r, 'ameliaAbandoned')),
      metrics: parseMetrics(get(r, 'custom')), escalationLogged: !!get(r, 'escLog'), _transcript: get(r, 'transcript') });
  }
  return { conversations, columns: rows[0], problems };
}
module.exports = { decodeExport, readExport, parseMetrics, norm, NA };
