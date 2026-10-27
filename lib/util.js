'use strict';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Too many days for one chart → weeks. */
function bucketDays(days) {
  if (days.length <= 12) return { rows: days, unit: 'day' };
  const weeks = []; let cur = null;
  days.forEach((d, i) => { if (i % 7 === 0) { cur = { label: `Wk of ${d.label.split(' ')[1]}`, total: 0, contained: 0, design: 0, abandoned: 0, escalated: 0 }; weeks.push(cur); } for (const k of ['total', 'contained', 'design', 'abandoned', 'escalated']) cur[k] += d[k]; });
  return { rows: weeks.slice(0, 14), unit: 'week' };
}
module.exports = { esc, bucketDays };
