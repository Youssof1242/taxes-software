/* ============================================================
   MapleTax new-year scaffolder — run every fall when CRA publishes
   the next year's indexation factor.

   Usage:
     node tools/scaffold-year.js 2027 --indexation 2.0
     node tools/scaffold-year.js 2027 --indexation 2.0 --rrsp 35340 --tfsa 7000

   It copies the latest final year, scales brackets/BPAs/ceilings by the
   indexation factor (CRA rounding: dollars to $1, YMPE/YAMPE/MIE down to
   the nearest $100), and marks the result status:"draft".
   ALWAYS verify against CRA T4127 + provincial budgets, then set
   status:"final", bump version, and publish tables/ to your update URL.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const TABLES = path.join(__dirname, '..', 'tables');
const args = process.argv.slice(2);
const YEAR = parseInt(args[0], 10);
const getOpt = (n) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? parseFloat(args[i + 1]) : null;
};

if (!YEAR || YEAR < 2025 || YEAR > 2100) {
  console.error('Usage: node tools/scaffold-year.js <YEAR> --indexation <pct> [--rrsp <limit>] [--tfsa <limit>]');
  process.exit(1);
}
const idx = getOpt('indexation');
if (!(idx > 0 && idx < 20)) { console.error('Missing/invalid --indexation (e.g. --indexation 2.0 for 2%)'); process.exit(1); }
const rrspLimit = getOpt('rrsp') || null;
const tfsaLimit = getOpt('tfsa') || null;

const manifest = JSON.parse(fs.readFileSync(path.join(TABLES, 'manifest.json'), 'utf8'));
const prevYear = Math.max(...Object.keys(manifest.years).map(Number));
if (YEAR <= prevYear) { console.error(`Year ${YEAR} already exists (latest is ${prevYear}).`); process.exit(1); }

const f = 1 + idx / 100;
const r1 = (n) => Math.round(n);                 // CRA: thresholds to nearest $1
const down100 = (n) => Math.floor(n / 100) * 100; // YMPE/YAMPE/MIE to $100
const prev = JSON.parse(fs.readFileSync(path.join(TABLES, prevYear + '.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

const fed = {
  brackets: prev.federal.brackets.map((x) => Math.round(x * f)),
  rates: [...prev.federal.rates],
  bpaMin: Math.round(prev.federal.bpaMin * f),
  bpaMax: Math.round(prev.federal.bpaMax * f),
  bpaThreshold: Math.round(prev.federal.bpaThreshold * f),
  bpaEnd: Math.round(prev.federal.bpaEnd * f),
  indexation: idx.toFixed(1) + '%',
  note: 'DRAFT scaffold — verify vs CRA before publishing'
};
const provinces = {};
for (const [code, p] of Object.entries(prev.provinces)) {
  provinces[code] = {
    brackets: p.brackets.map((x) => Math.round(x * f)),
    rates: [...p.rates],
    bpa: Math.round(p.bpa * f)
  };
  if (p.abbrev) provinces[code].abbrev = p.abbrev;
  if (p.name) provinces[code].name = p.name;
  if (p.surtax) provinces[code].surtax = true;
  if (p.healthPremium) provinces[code].healthPremium = true;
  if (p.abatement) provinces[code].abatement = true;
  if (p.note) provinces[code].note = 'verify: ' + p.note;
}
const pr = prev.payroll;
const payroll = {
  ...pr,
  ympe: down100(pr.ympe * f),
  yampe: down100(pr.yampe * f),
  mie: down100(pr.mie * f)
};
if (rrspLimit) payroll.rrspLimit = rrspLimit;
const other = JSON.parse(JSON.stringify(prev.other));
if (other.canadaEmploymentAmount) other.canadaEmploymentAmount[String(YEAR)] = Math.round(other.canadaEmploymentAmount[String(prevYear)] * f);
if (other.ageCredit) {
  other.ageCredit[String(YEAR)] = Math.round(other.ageCredit[String(prevYear)] * f);
  if (other.ageCredit.threshold) other.ageCredit.threshold[String(YEAR)] = Math.round(other.ageCredit.threshold[String(prevYear)] * f);
}
if (other.spouseCreditMax) other.spouseCreditMax[String(YEAR)] = fed.bpaMax;
if (tfsaLimit && other.tfsaLimit) other.tfsaLimit[String(YEAR)] = tfsaLimit;

const doc = {
  year: YEAR, version: 1, updated: today, status: 'draft',
  notes: `AUTO-SCAFFOLD from ${prevYear} at +${idx}% — MUST verify vs CRA T4127 + provincial budgets, then set status:"final".`,
  federal: fed, provinces, payroll, other
};
fs.writeFileSync(path.join(TABLES, YEAR + '.json'), JSON.stringify(doc, null, 2));
manifest.years[String(YEAR)] = { version: 1, file: YEAR + '.json', updated: today, status: 'draft' };
manifest.manifestVersion += 1;
manifest.updated = today;
fs.writeFileSync(path.join(TABLES, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Scaffolded tables/${YEAR}.json (status: draft) from ${prevYear} at +${idx}%.`);
console.log('VERIFY CHECKLIST before publishing:');
console.log('  1. CRA T4127 + indexation notice (mid-Nov) — brackets, BPA, rates');
console.log('  2. CPP YMPE/YAMPE + EI MIE/rates (CEIC, Sept) — scaffold rounds down to $100');
console.log('  3. Each provincial budget — brackets, BPAs, new/dropped credits');
console.log('  4. RRSP limit, TFSA room, QPP/QPIP, ON surtax thresholds');
console.log('  5. Set status:"final", bump version, run a $100k smoke calc, publish tables/');
