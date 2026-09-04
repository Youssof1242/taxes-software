/* ============================================================
   Refresh bundled tables/* from official canada.ca pages.
   Usage: node tools/refresh-from-cra.js
   - Parses CRA bracket/BPA/CPP/EI pages live
   - Merges over current tables (QC preserved: Revenu Quebec
     blocks automated fetch; 2026 BPAs estimated +2% until CRA
     publishes the 2026 BPA page in the fall)
   - Bumps versions, rebuilds tax-data.js fallback
   ============================================================ */
const fs = require('fs');
const path = require('path');
const CRA = require('../cra.js');

const ROOT = path.join(__dirname, '..');
const TABLES = path.join(ROOT, 'tables');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 MapleTax/1.0';
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
  return await r.text();
}
const today = new Date().toISOString().slice(0, 10);
const dateInt = parseInt(today.replace(/-/g, ''), 10);

(async () => {
  const pgCur = CRA.parseBracketPage(await get(CRA.URLS.bracketsCurrent));
  const pgLast = CRA.parseBracketPage(await get(CRA.URLS.bracketsLast));
  const bpa = CRA.parseBpaPage(await get(CRA.URLS.bpa));
  console.log('CRA years:', pgCur.year, pgLast.year, '| BPA year:', bpa.taxYear);

  const cppRows = CRA.parseYearTables(await get(CRA.URLS.cpp), 'pensionable');
  const cpp = {};
  cppRows.forEach(r => { if (r.cells.length >= 5) cpp[r.year] = { ympe: CRA.parseMoney(r.cells[1]), exempt: CRA.parseMoney(r.cells[2]), rate: CRA.parseRate(r.cells[4]) }; });
  const cpp2 = {};
  CRA.parseYearTables(await get(CRA.URLS.cpp2), 'additional')
    .forEach(r => { cpp2[r.year] = { yampe: CRA.parseMoney(r.cells[1]), rate: CRA.parseRate(r.cells[2]) }; });
  const ei = {}, eiQC = {};
  CRA.parseYearTables(await get(CRA.URLS.ei), 'insurable').forEach(r => {
    const t = /quebec/i.test(r.label) ? eiQC : ei;
    t[r.year] = { mie: CRA.parseMoney(r.cells[1]), rate: CRA.parseRate(r.cells[2]) };
  });

  // load current tables as merge base
  const manifest = JSON.parse(fs.readFileSync(path.join(TABLES, 'manifest.json'), 'utf8'));
  const prev = { federal: {}, provinces: {}, payroll: {}, other: null };
  Object.keys(manifest.years).forEach(y => {
    const d = JSON.parse(fs.readFileSync(path.join(TABLES, y + '.json'), 'utf8'));
    prev.federal[y] = d.federal; prev.payroll[y] = d.payroll;
    Object.keys(d.provinces).forEach(c => { prev.provinces[c] = prev.provinces[c] || {}; prev.provinces[c][y] = d.provinces[c]; });
    if (!prev.other || Number(y) >= Math.max(...Object.keys(manifest.years).map(Number))) prev.other = d.other;
  });

  const docs = CRA.buildYearDocs({ current: pgCur, last: pgLast, bpa, cpp, cpp2, ei, eiQC }, prev);

  // 2026 BPA estimate: CRA publishes the 2026 BPA page in the fall.
  // Until then, scale official 2025 BPAs by the 2026 federal indexation (2%).
  const Y26 = String(pgCur.year);
  if (bpa.taxYear !== pgCur.year && docs[Y26]) {
    const d26 = docs[Y26], d25 = docs[String(pgLast.year)] || docs[Y26];
    const f25 = bpa.federal || (prev.federal[String(pgLast.year)] || {});
    d26.federal.bpaMax = Math.round((f25.max || d26.federal.bpaMax) * 1.02);
    d26.federal.bpaMin = Math.round((f25.min || d26.federal.bpaMin) * 1.02);
    Object.keys(bpa.provincial).forEach(code => {
      if (d26.provinces[code]) d26.provinces[code].bpa = Math.round(bpa.provincial[code] * 1.02);
    });
    if (d26.provinces.YT) d26.provinces.YT.bpa = d26.federal.bpaMax;
    d26.notes += ' 2026 BPAs estimated (+2% over official 2025); auto-corrected when CRA publishes.';
  }

  Object.values(docs).forEach(doc => {
    const y = String(doc.year);
    doc.version = dateInt;
    const fp = path.join(TABLES, y + '.json');
    fs.writeFileSync(fp, JSON.stringify(doc, null, 2));
    manifest.years[y] = { version: dateInt, file: y + '.json', updated: today, status: 'official' };
    console.log('updated tables/' + y + '.json from canada.ca');
  });
  manifest.manifestVersion += 1;
  manifest.updated = today;
  fs.writeFileSync(path.join(TABLES, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // rebuild tax-data.js fallback from tables/
  require('./build-bundled.js');
  console.log('done.');
})().catch(e => { console.error('REFRESH FAILED:', e.message); process.exit(1); });
