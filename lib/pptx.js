'use strict';
// Fills a PowerPoint template IN PLACE: master, theme, fonts and every shape stay the template's; only text, table rows and chart data change.
const AdmZip = require('adm-zip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const NS = { a: 'http://schemas.openxmlformats.org/drawingml/2006/main', p: 'http://schemas.openxmlformats.org/presentationml/2006/main', c: 'http://schemas.openxmlformats.org/drawingml/2006/chart', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', rel: 'http://schemas.openxmlformats.org/package/2006/relationships' };
const parse = (s) => new DOMParser().parseFromString(s, 'text/xml'); const ser = (d) => new XMLSerializer().serializeToString(d);
const kids = (el, tag) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && (!tag || n.nodeName === tag)); const all = (el, tag) => Array.from(el.getElementsByTagName(tag));
const colLetter = (i) => String.fromCharCode(65 + i); const escX = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const fromRel = (t) => 'ppt/' + t.replace(/^\.\.\//, '').replace(/^\.?\//, '');

class Deck {
  constructor(buf) {
    const zip = new AdmZip(buf); this.files = new Map(); this.docs = new Map();
    for (const e of zip.getEntries()) if (!e.isDirectory) this.files.set(e.entryName, e.getData());
    this.n = { slide: 0, chart: 0, emb: 0 };
    for (const k of this.files.keys()) { let m; if ((m = k.match(/^ppt\/slides\/slide(\d+)\.xml$/))) this.n.slide = Math.max(this.n.slide, +m[1]); if ((m = k.match(/^ppt\/charts\/chart(\d+)\.xml$/))) this.n.chart = Math.max(this.n.chart, +m[1]); if ((m = k.match(/Microsoft_Excel_Sheet(\d+)\.xlsx$/))) this.n.emb = Math.max(this.n.emb, +m[1]); }
  }
  has(n) { return this.files.has(n); } text(n) { return this.files.get(n).toString('utf8'); }
  put(n, d) { this.files.set(n, Buffer.isBuffer(d) ? d : Buffer.from(d, 'utf8')); this.docs.delete(n); }
  doc(n) { if (!this.docs.has(n)) this.docs.set(n, parse(this.text(n))); return this.docs.get(n); }
  drop(n) { this.files.delete(n); this.docs.delete(n); }
  flush() { for (const [n, d] of this.docs) this.files.set(n, Buffer.from(ser(d), 'utf8')); this.docs.clear(); }

  // ---------------------------------------------------------------- slides
  slideList() {
    const pres = this.doc('ppt/presentation.xml'); const t = {}; for (const r of all(this.doc('ppt/_rels/presentation.xml.rels'), 'Relationship')) t[r.getAttribute('Id')] = r.getAttribute('Target');
    return all(pres, 'p:sldId').map((s) => ({ id: s.getAttribute('id'), rid: s.getAttribute('r:id'), part: fromRel(t[s.getAttribute('r:id')]) }));
  }
  relsPath(part) { return part.replace(/([^/]+)$/, '_rels/$1.rels'); } relsOf(part) { const p = this.relsPath(part); return this.has(p) ? this.doc(p) : null; }
  addType(part, type) { const ct = this.doc('[Content_Types].xml'); const o = ct.createElementNS(ct.documentElement.namespaceURI, 'Override'); o.setAttribute('PartName', '/' + part); o.setAttribute('ContentType', type); ct.documentElement.appendChild(o); }
  rmType(part) { for (const o of all(this.doc('[Content_Types].xml'), 'Override')) if (o.getAttribute('PartName') === '/' + part) o.parentNode.removeChild(o); }
  cloneSlide(src, position) {
    const k = ++this.n.slide; const part = `ppt/slides/slide${k}.xml`; this.put(part, this.text(src));
    const rels = parse(ser(this.relsOf(src))); const root = rels.documentElement;
    for (const r of all(rels, 'Relationship')) {
      const type = r.getAttribute('Type'); if (/\/notesSlide$/.test(type)) { root.removeChild(r); continue; }
      if (/\/chart$/.test(type)) {
        const c = ++this.n.chart; const cs = fromRel(r.getAttribute('Target')); const cd = `ppt/charts/chart${c}.xml`; this.put(cd, this.text(cs)); const cr = this.relsOf(cs);
        if (cr) { const crc = parse(ser(cr)); for (const x of all(crc, 'Relationship')) if (/\/package$/.test(x.getAttribute('Type'))) { const e = ++this.n.emb; this.put(`ppt/embeddings/Microsoft_Excel_Sheet${e}.xlsx`, this.files.get(fromRel(x.getAttribute('Target')))); x.setAttribute('Target', `../embeddings/Microsoft_Excel_Sheet${e}.xlsx`); } this.put(this.relsPath(cd), ser(crc)); }
        this.addType(cd, 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'); r.setAttribute('Target', `../charts/chart${c}.xml`);
      }
    }
    this.put(this.relsPath(part), ser(rels)); this.addType(part, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
    const pr = this.doc('ppt/_rels/presentation.xml.rels'); let max = 0; for (const r of all(pr, 'Relationship')) max = Math.max(max, +(r.getAttribute('Id').match(/\d+/) || [0])[0]);
    const rid = `rId${max + 1}`; const rel = pr.createElementNS(NS.rel, 'Relationship'); rel.setAttribute('Id', rid); rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'); rel.setAttribute('Target', `slides/slide${k}.xml`); pr.documentElement.appendChild(rel);
    const pres = this.doc('ppt/presentation.xml'); const lst = all(pres, 'p:sldIdLst')[0]; const ids = all(lst, 'p:sldId'); const el = pres.createElementNS(NS.p, 'p:sldId'); el.setAttribute('id', String(Math.max(255, ...ids.map((s) => +s.getAttribute('id'))) + 1)); el.setAttributeNS(NS.r, 'r:id', rid);
    const ref = position != null && position < ids.length ? ids[position] : null; ref ? lst.insertBefore(el, ref) : lst.appendChild(el); return part;
  }
  removeSlide(part) {
    const hit = this.slideList().find((s) => s.part === part); for (const s of all(this.doc('ppt/presentation.xml'), 'p:sldId')) if (s.getAttribute('id') === hit.id) s.parentNode.removeChild(s);
    for (const r of all(this.doc('ppt/_rels/presentation.xml.rels'), 'Relationship')) if (r.getAttribute('Id') === hit.rid) r.parentNode.removeChild(r);
    const rels = this.relsOf(part);
    if (rels) for (const r of all(rels, 'Relationship')) { const t = fromRel(r.getAttribute('Target')); const ty = r.getAttribute('Type');
      if (/\/chart$/.test(ty)) { const cr = this.relsOf(t); if (cr) for (const x of all(cr, 'Relationship')) this.drop(fromRel(x.getAttribute('Target'))); this.drop(this.relsPath(t)); this.drop(t); this.rmType(t); }
      if (/\/notesSlide$/.test(ty)) { this.drop(this.relsPath(t)); this.drop(t); this.rmType(t); } }
    this.drop(this.relsPath(part)); this.drop(part); this.rmType(part);
  }
  stripNotes() { for (const { part } of this.slideList()) { const rels = this.relsOf(part); if (!rels) continue; for (const r of all(rels, 'Relationship')) if (/\/notesSlide$/.test(r.getAttribute('Type'))) { const t = fromRel(r.getAttribute('Target')); this.drop(this.relsPath(t)); this.drop(t); this.rmType(t); r.parentNode.removeChild(r); } } }
  dropUnusedMedia() { this.flush(); const used = new Set(); for (const [n, b] of this.files) if (/\.rels$/.test(n)) for (const m of b.toString('utf8').matchAll(/Target="([^"]*media\/[^"]*)"/g)) used.add('ppt/media/' + m[1].split('/').pop()); for (const n of [...this.files.keys()]) if (/^ppt\/media\//.test(n) && !used.has(n)) this.drop(n); }

  // ---------------------------------------------------------------- shapes
  shape(part, id) { const d = this.doc(part); for (const tag of ['p:sp', 'p:graphicFrame']) for (const sp of all(d, tag)) { const c = all(sp, 'p:cNvPr')[0]; if (c && c.getAttribute('id') === String(id)) return sp; } throw new Error(`The template slide has no shape ${id}; the template was changed.`); }
  newRun(p) { const d = p.ownerDocument; const r = d.createElementNS(NS.a, 'a:r'); const end = kids(p, 'a:endParaRPr')[0]; const rp = d.createElementNS(NS.a, 'a:rPr'); if (end) { for (const at of Array.from(end.attributes)) rp.setAttribute(at.name, at.value); for (const ch of kids(end)) rp.appendChild(ch.cloneNode(true)); } rp.setAttribute('lang', 'en-US'); r.appendChild(rp); r.appendChild(d.createElementNS(NS.a, 'a:t')); return r; }
  fillPara(p, t, size) { let runs = kids(p, 'a:r'); if (!runs.length) { const r = this.newRun(p); p.insertBefore(r, kids(p, 'a:endParaRPr')[0] || null); runs = [r]; } all(runs[0], 'a:t')[0].textContent = t == null ? '' : String(t); for (const x of runs.slice(1)) p.removeChild(x); if (size) for (const rp of all(runs[0], 'a:rPr')) rp.setAttribute('sz', String(size)); }
  setText(part, id, text, { size } = {}) {
    const body = all(this.shape(part, id), 'p:txBody')[0]; const ps = kids(body, 'a:p'); const lines = Array.isArray(text) ? text : [text]; for (const x of ps.slice(1)) body.removeChild(x);
    this.fillPara(ps[0], lines[0], size); let prev = ps[0]; for (const t of lines.slice(1)) { const np = ps[0].cloneNode(true); this.fillPara(np, t, size); body.insertBefore(np, prev.nextSibling); prev = np; }
  }
  setBox(part, id, { x, y, w, h }) { const sp = this.shape(part, id); const off = all(sp, 'a:off')[0], ext = all(sp, 'a:ext')[0]; if (x != null) off.setAttribute('x', String(Math.round(x))); if (y != null) off.setAttribute('y', String(Math.round(y))); if (w != null) ext.setAttribute('cx', String(Math.round(w))); if (h != null) ext.setAttribute('cy', String(Math.round(h))); }

  // ---------------------------------------------------------------- tables
  tbl(part, id) { return all(this.shape(part, id), 'a:tbl')[0]; }
  cell(tc, text, size) { const body = kids(tc, 'a:txBody')[0]; const ps = kids(body, 'a:p'); for (const x of ps.slice(1)) body.removeChild(x); this.fillPara(ps[0], text, size); }
  /** Header texts (and widths in EMU). */
  setHeader(part, id, texts, widths) { const t = this.tbl(part, id); kids(kids(t, 'a:tr')[0], 'a:tc').forEach((tc, i) => { if (texts[i] != null) this.cell(tc, texts[i]); }); if (widths) kids(kids(t, 'a:tblGrid')[0], 'a:gridCol').forEach((g, i) => { if (widths[i]) g.setAttribute('w', String(Math.round(widths[i]))); }); }
  addColumn(part, id, after) { const t = this.tbl(part, id); const grid = kids(t, 'a:tblGrid')[0]; const gc = kids(grid, 'a:gridCol'); grid.insertBefore(gc[after].cloneNode(true), gc[after].nextSibling); for (const tr of kids(t, 'a:tr')) { const tcs = kids(tr, 'a:tc'); tr.insertBefore(tcs[after].cloneNode(true), tcs[after].nextSibling); } }
  /** Keep the header; rebuild the body from the template's own alternating rows; optional total row from the template's last row. */
  fillTable(part, id, { rows, total, rowH, size }) {
    const t = this.tbl(part, id); const trs = kids(t, 'a:tr'); const A = trs[1], B = trs[2] || trs[1], TOT = trs[trs.length - 1]; for (const tr of trs.slice(1)) t.removeChild(tr);
    const mk = (tpl, cells, h) => { const tr = tpl.cloneNode(true); kids(tr, 'a:tc').forEach((tc, c) => { if (c < cells.length) this.cell(tc, cells[c], size); }); if (h) tr.setAttribute('h', String(Math.round(h))); return tr; };
    rows.forEach((r, i) => t.appendChild(mk(i % 2 ? B : A, r, rowH))); if (total) t.appendChild(mk(TOT, total, rowH ? Math.min(rowH, 365750) : null));
  }

  // ---------------------------------------------------------------- charts
  chartPartOf(slide, frame) { const rid = all(this.shape(slide, frame), 'c:chart')[0].getAttribute('r:id'); for (const r of all(this.relsOf(slide), 'Relationship')) if (r.getAttribute('Id') === rid) return fromRel(r.getAttribute('Target')); throw new Error('chart relationship not found'); }
  /** categories: [labels]; series: [{ name, values, color }]; pointColors: colour each bar of a one-series chart. Also rewrites the chart's embedded workbook ("Edit Data"). */
  setChart(chart, { categories, series, pointColors }) {
    const d = this.doc(chart); const parent = all(d, 'c:ser')[0].parentNode;
    while (all(d, 'c:ser').length > series.length) { const l = all(d, 'c:ser'); parent.removeChild(l[l.length - 1]); }
    while (all(d, 'c:ser').length < series.length) { const l = all(d, 'c:ser'); parent.insertBefore(l[l.length - 1].cloneNode(true), l[l.length - 1].nextSibling); }
    const n = categories.length; const pt = (i, v) => { const p = d.createElementNS(NS.c, 'c:pt'); p.setAttribute('idx', String(i)); const e = d.createElementNS(NS.c, 'c:v'); e.textContent = String(v); p.appendChild(e); return p; };
    all(d, 'c:ser').forEach((s, si) => {
      const sd = series[si]; kids(s, 'c:idx')[0].setAttribute('val', String(si)); kids(s, 'c:order')[0].setAttribute('val', String(si));
      const tx = kids(s, 'c:tx')[0]; all(tx, 'c:f')[0].textContent = `Sheet1!$${colLetter(si + 1)}$1`; all(tx, 'c:v')[0].textContent = sd.name;
      const fill = (box, ref, cache, vals) => { all(box, 'c:f')[0].textContent = ref; const cc = all(box, cache)[0]; for (const x of kids(cc, 'c:pt')) cc.removeChild(x); all(cc, 'c:ptCount')[0].setAttribute('val', String(vals.length)); vals.forEach((v, i) => { if (v != null) cc.appendChild(pt(i, v)); }); };
      fill(kids(s, 'c:cat')[0], `Sheet1!$A$2:$A$${n + 1}`, 'c:strCache', categories); fill(kids(s, 'c:val')[0], `Sheet1!$${colLetter(si + 1)}$2:$${colLetter(si + 1)}$${n + 1}`, 'c:numCache', sd.values);
      if (sd.color) { const sp = kids(s, 'c:spPr')[0]; if (sp) for (const c of all(sp, 'a:srgbClr')) { c.setAttribute('val', sd.color); break; } }
      for (const old of kids(s, 'c:dPt')) s.removeChild(old);
      if (pointColors && series.length === 1) { const anchor = kids(s, 'c:dLbls')[0] || kids(s, 'c:cat')[0]; pointColors.forEach((col, i) => { const dp = d.createElementNS(NS.c, 'c:dPt'); const mkc = (tag, val) => { const e = d.createElementNS(NS.c, tag); e.setAttribute('val', val); return e; }; dp.appendChild(mkc('c:idx', String(i))); dp.appendChild(mkc('c:invertIfNegative', '0')); dp.appendChild(mkc('c:bubble3D', '0')); const sp = d.createElementNS(NS.c, 'c:spPr'); const sf = d.createElementNS(NS.a, 'a:solidFill'); const cl = d.createElementNS(NS.a, 'a:srgbClr'); cl.setAttribute('val', col); sf.appendChild(cl); sp.appendChild(sf); dp.appendChild(sp); s.insertBefore(dp, anchor); }); }
      if (series.length > 1) for (const dl of kids(s, 'c:dLbls')) { let nf = kids(dl, 'c:numFmt')[0]; if (!nf) { nf = d.createElementNS(NS.c, 'c:numFmt'); dl.insertBefore(nf, dl.firstChild); } nf.setAttribute('formatCode', '0;-0;;'); nf.setAttribute('sourceLinked', '0'); }   // no "0" labels
    });
    for (const ax of all(d, 'c:valAx')) { const sc = kids(ax, 'c:scaling')[0]; if (sc) for (const t of ['c:max', 'c:min']) for (const x of kids(sc, t)) sc.removeChild(x); }
    const rels = this.relsOf(chart); if (rels) for (const r of all(rels, 'Relationship')) if (/\/package$/.test(r.getAttribute('Type'))) this.put(fromRel(r.getAttribute('Target')), makeWorkbook(categories, series));
  }
  allText() { this.flush(); const out = []; for (const [n, b] of this.files) if (/^ppt\/(slides|charts)\/[^/]+\.xml$/.test(n)) for (const m of b.toString('utf8').matchAll(/<(?:a:t|c:v)>([^<]*)<\/(?:a:t|c:v)>/g)) out.push(m[1]); return out; }
  toBuffer() { this.flush(); const zip = new AdmZip(); for (const n of [...this.files.keys()].sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : a.localeCompare(b)))) zip.addFile(n, this.files.get(n)); return zip.toBuffer(); }
}

/** A minimal, valid .xlsx with the chart's data (sheet "Sheet1": categories in A, series from B). */
function makeWorkbook(categories, series) {
  const rows = [['', ...series.map((s) => s.name)], ...categories.map((c, i) => [c, ...series.map((s) => s.values[i])])];
  const cell = (v, r, c) => { const ref = `${colLetter(c)}${r + 1}`; return v == null || v === '' ? '' : typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${escX(v)}</t></is></c>`; };
  const z = new AdmZip(); const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  z.addFile('[Content_Types].xml', Buffer.from(`${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`));
  z.addFile('_rels/.rels', Buffer.from(`${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`));
  z.addFile('xl/workbook.xml', Buffer.from(`${H}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`));
  z.addFile('xl/_rels/workbook.xml.rels', Buffer.from(`${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`));
  z.addFile('xl/styles.xml', Buffer.from(`${H}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`));
  z.addFile('xl/worksheets/sheet1.xml', Buffer.from(`${H}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${colLetter(series.length)}${rows.length}"/><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, i, c)).join('')}</row>`).join('')}</sheetData></worksheet>`));
  return z.toBuffer();
}
module.exports = { Deck, makeWorkbook };
