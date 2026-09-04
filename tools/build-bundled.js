/* Rebuilds tax-data.js (offline fallback) from tables/*.json.
   Usage: node tools/build-bundled.js  (also called by refresh-from-cra.js) */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TABLES = path.join(ROOT, 'tables');

const manifest = JSON.parse(fs.readFileSync(path.join(TABLES, 'manifest.json'), 'utf8'));
const years = Object.keys(manifest.years).sort();
const federal = {}, provinces = {}, payroll = {};
let other = null;
years.forEach(y => {
  const d = JSON.parse(fs.readFileSync(path.join(TABLES, y + '.json'), 'utf8'));
  federal[y] = d.federal; payroll[y] = d.payroll;
  Object.keys(d.provinces).forEach(c => { provinces[c] = provinces[c] || { name: c, abbr: c }; provinces[c][y] = d.provinces[c]; });
  other = d.other; // newest year wins (years ascending)
});
// restore display names
const NAMES = { ON: 'Ontario', QC: 'Québec', BC: 'British Columbia', AB: 'Alberta', SK: 'Saskatchewan', MB: 'Manitoba', NS: 'Nova Scotia', NB: 'New Brunswick', NL: 'Newfoundland & Labrador', PE: 'Prince Edward Island', NT: 'Northwest Territories', NU: 'Nunavut', YT: 'Yukon' };
Object.keys(NAMES).forEach(c => { if (provinces[c]) provinces[c].name = NAMES[c]; });

const out = '/* ============================================================\n' +
  '   MapleTax bundled fallback tables (auto-generated — DO NOT EDIT).\n' +
  '   Generated from tables/*.json by tools/build-bundled.js\n' +
  '   (' + new Date().toISOString().slice(0, 10) + '). Live data comes from\n' +
  '   canada.ca sync; this file is the offline fallback.\n' +
  '   ============================================================ */\n\n' +
  'const TAX_DATA = ' + JSON.stringify({ federal, provinces, payroll, other }, null, 2) + ';\n';
fs.writeFileSync(path.join(ROOT, 'tax-data.js'), out);
console.log('rebuilt tax-data.js from', years.join(', '));
