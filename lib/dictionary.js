'use strict';
// Reads the customer's Custom Metrics Dictionary (.xlsx): category rows, then metric rows with
// Recommended Name · Technical Key · Data Type · Possible / Example Values · (Description).
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** First sheet of an .xlsx as an array of rows (arrays of strings). */
function readSheet(buf) {
  const zip = new AdmZip(buf); const get = (n) => { const e = zip.getEntry(n); return e ? e.getData().toString('utf8') : null; };
  const wb = get('xl/workbook.xml'); if (!wb) throw new Error('This is not an Excel (.xlsx) workbook.');
  const rels = get('xl/_rels/workbook.xml.rels') || ''; const rid = (wb.match(/<sheet\b[^>]*r:id="([^"]+)"/) || [])[1];
  let target = 'worksheets/sheet1.xml'; if (rid) { const m = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`)); if (m) target = m[1].replace(/^\/?(xl\/)?/, ''); }
  const sheet = get('xl/' + target); if (!sheet) throw new Error('The workbook has no readable sheet.');
  const sst = get('xl/sharedStrings.xml'); const strings = [];
  if (sst) for (const si of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) strings.push(unesc([...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rows = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (c[1].match(/\br="([A-Z]+\d+)"/) || [])[1]; if (!ref) continue; const type = (c[1].match(/\bt="(\w+)"/) || [])[1]; const body = c[2] || '';
      let v = ''; if (type === 's') v = strings[+((body.match(/<v>(\d+)<\/v>/) || [])[1])] || ''; else if (type === 'inlineStr') v = unesc([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')); else v = unesc((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
      cells[colIndex(ref)] = v.trim();
    }
    rows.push(Array.from(cells, (x) => x || ''));
  }
  return rows;
}

const cleanName = (s) => String(s).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const kindOf = (type, key) => { const t = `${type} ${key}`.toLowerCase(); if (/phone|e\.?164|ani\b/.test(t)) return 'phone'; if (/unique id|session_id|_id\b/.test(t)) return 'id'; if (/verbatim|free text/.test(t)) return 'text'; if (/integer|count/.test(t)) return 'integer'; if (/bool/.test(t)) return 'boolean'; if (/enum/.test(t)) return 'enum'; return 'string'; };

/** → { title, subtitle, source, groups: [{ name, metrics: [...] }], metrics: [...] } */
function parseDictionary(buf, source = '', fallbackDescriptions = {}) {
  const rows = readSheet(buf); let h = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) { const j = rows[i].map((x) => x.toLowerCase()); if (j.some((x) => /^(technical )?key$/.test(x)) && j.some((x) => /^(recommended |metric )?name$/.test(x))) { h = i; break; } }
  if (h < 0) throw new Error('No header row found (expected “Recommended Name” and “Technical Key” columns).');
  const head = rows[h].map((x) => x.toLowerCase()); const col = (re) => head.findIndex((x) => re.test(x));
  const c = { name: col(/^(recommended |metric )?name$/), key: col(/^(technical )?key$/), type: col(/^(data )?type$/), values: col(/possible|example|values/), desc: col(/^(description|definition)$/) };
  const groups = []; let cur = null; const metrics = [];
  for (const r of rows.slice(h + 1)) {
    const key = (r[c.key] || '').trim(); const name = (r[c.name] || '').trim(); if (!name && !key) continue;
    if (!key) { cur = { name, metrics: [] }; groups.push(cur); continue; }             // a row with only a name is a category title
    if (!cur) { cur = { name: 'Custom Metrics', metrics: [] }; groups.push(cur); }
    const type = r[c.type] || ''; const values = r[c.values] || ''; const m = { name: cleanName(name), key: key.toLowerCase(), group: cur.name, type, valuesText: values, kind: kindOf(type, key), description: (c.desc >= 0 && r[c.desc]) || fallbackDescriptions[key.toLowerCase()] || '' };
    m.allowed = m.kind === 'enum' ? values.split(/;/).map((s) => s.replace(/\(.*?\)/g, '').trim()).filter((s) => s && !/^e\.g\.|^\d|^true|^false|…|\.\.\./i.test(s)) : [];
    m.personal = m.kind === 'phone' || m.kind === 'id' || m.kind === 'text'; cur.metrics.push(m); metrics.push(m);
  }
  if (!metrics.length) throw new Error('The workbook has no metric rows.');
  return { title: rows[0] && rows[0][0] || '', subtitle: rows[1] && rows[1][0] || '', source, groups: groups.filter((g) => g.metrics.length), metrics };
}

/** The dictionary for a domain: dictionaries/<domain code>.xlsx (or an explicit file). */
function loadDictionary({ file, domainCode, dir, defaultName } = {}) {
  const cands = []; if (file) cands.push(file); if (dir && domainCode) cands.push(path.join(dir, `${domainCode}.xlsx`));
  let fallback = {}; try { const f = path.join(dir || '.', '_descriptions.json'); if (fs.existsSync(f)) fallback = JSON.parse(fs.readFileSync(f, 'utf8')).descriptions || {}; } catch (_) { /* optional */ }
  for (const f of cands) if (fs.existsSync(f)) return parseDictionary(fs.readFileSync(f), path.basename(f), fallback);
  // No workbook for this domain: use the configured default, or the only workbook in the folder, and say so.
  if (dir && fs.existsSync(dir)) {
    const all = fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('_') && !f.startsWith('~'));
    const pick = (defaultName && all.find((f) => f.toLowerCase() === String(defaultName).toLowerCase().replace(/(\.xlsx)?$/, '.xlsx'))) || (all.length === 1 ? all[0] : null);
    if (pick) { const d = parseDictionary(fs.readFileSync(path.join(dir, pick)), pick, fallback); d.fallbackFor = domainCode || ''; d.fallbackFile = pick; return d; }
  }
  return null;
}
module.exports = { readSheet, parseDictionary, loadDictionary, cleanName };
