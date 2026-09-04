/* MapleTax Canada — calculation engine + UI */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const fmt = (n) => (isFinite(n) ? n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }) : "$0");
const fmt2 = (n) => (isFinite(n) ? n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 }) : "$0.00");
const num = (id) => Math.max(0, parseFloat(String($(id).value || "0").replace(/[, $]/g, "")) || 0);

function bracketTax(taxable, brackets, rates) {
  let tax = 0, lower = 0;
  const detail = [];
  for (let i = 0; i < rates.length; i++) {
    const upper = i < brackets.length ? brackets[i] : Infinity;
    const inBand = Math.max(0, Math.min(taxable, upper) - lower);
    const t = inBand * rates[i];
    if (inBand > 0) detail.push({ from: lower, to: upper === Infinity ? null : upper, rate: rates[i], base: inBand, tax: t });
    tax += t;
    lower = upper;
    if (taxable <= upper) break;
  }
  return { tax, detail };
}
function marginalRate(taxable, brackets, rates) {
  for (let i = 0; i < rates.length; i++) {
    const upper = i < brackets.length ? brackets[i] : Infinity;
    if (taxable <= upper) return rates[i];
  }
  return rates[rates.length - 1];
}
function federalBPA(year, netIncome) {
  const f = TAX_DATA.federal[year];
  if (netIncome <= f.bpaThreshold) return f.bpaMax;
  if (netIncome >= f.bpaEnd) return f.bpaMin;
  const ratio = (netIncome - f.bpaThreshold) / (f.bpaEnd - f.bpaThreshold);
  return f.bpaMax - (f.bpaMax - f.bpaMin) * ratio;
}
function ontarioSurtax(basicTax) {
  // 2025/2026 rules: 20% over $4,991 + 36% over $6,387
  let s = 0;
  if (basicTax > 4987) { /* thresholds indexed slightly; use 4991/6387 */ }
  if (basicTax > 4991) s += (Math.min(basicTax, 6387) - 4991) * 0.20;
  if (basicTax > 6387) s += (basicTax - 6387) * 0.36;
  return s;
}
function ontarioHealthPremium(taxable) {
  if (taxable <= 20000) return 0;
  const t = [
    [36000, 300], [38500, 360], [41500, 420], [44500, 480],
    [47500, 540], [72500, 600], [200000, 750], [Infinity, 900]
  ];
  // simplified CRA table
  if (taxable <= 36000) return 300 - 0; // actual table is graduated; approximate standard amounts
  for (const [lim, amt] of [[36000, 300], [38500, 360], [41500, 420], [44500, 480], [47500, 540], [72500, 600], [200000, 750]]) {
    if (taxable <= lim) return amt;
  }
  return 900;
}

function calculate() {
  const year = $("#taxYear").value;
  const prov = $("#province").value;
  const F = TAX_DATA.federal[year];
  const P = TAX_DATA.provinces[prov][year];
  const PR = TAX_DATA.payroll[year];
  const O = TAX_DATA.other;

  // ---- incomes ----
  const employment = num("#inEmployment");
  const selfEmp = num("#inSelf");
  const pension = num("#inPension");
  const interest = num("#inInterest");
  const capGains = num("#inCapGains");
  const eligDiv = num("#inEligDiv");
  const nonEligDiv = num("#inNonEligDiv");
  const otherInc = num("#inOther");
  const age65 = $("#inAge65").checked;
  const isQC = prov === "QC";

  // taxable components
  const capTaxable = capGains * O.capitalGainsInclusion;
  const eligGross = eligDiv * (1 + O.eligibleGrossUp);
  const nonEligGross = nonEligDiv * (1 + O.nonEligibleGrossUp);
  const grossForDisplay = employment + selfEmp + pension + interest + capGains + eligDiv + nonEligDiv + otherInc;
  const totalIncomeForTax = employment + selfEmp + pension + interest + capTaxable + eligGross + nonEligGross + otherInc;

  // ---- deductions (from income) ----
  const rrsp = Math.min(num("#dRRSP"), totalIncomeForTax);
  const fhsa = num("#dFHSA");
  const unionDues = num("#dUnion");
  const childcare = num("#dChild");
  const moving = num("#dMoving");
  const otherDed = num("#dOther");
  const totalDeductions = Math.min(totalIncomeForTax, rrsp + fhsa + unionDues + childcare + moving + otherDed);
  const taxableIncome = Math.max(0, totalIncomeForTax - totalDeductions);
  const netIncome = taxableIncome; // simplified (line 23600 ≈ 26000 here)

  // ---- payroll: CPP/QPP + EI ----
  const pensionable = employment + selfEmp; // simplified
  let cpp1 = 0, cpp2 = 0, cppLabel = isQC ? "QPP" : "CPP";
  const cppRate = isQC ? PR.qppRate : PR.cppRate;
  cpp1 = Math.max(0, Math.min(pensionable, PR.ympe) - Math.min(pensionable, PR.exempt)) * 0;
  // correct formula: (min(pensionable,YMPE) - 3500 if positive)
  const cppBase = Math.max(0, Math.min(pensionable, PR.ympe) - PR.exempt);
  cpp1 = cppBase * cppRate;
  // self-employed pays double on employment+self portion attributable to self? simplify: if selfEmp>0, double the self share proportionally
  if (selfEmp > 0 && pensionable > 0) {
    const selfShare = selfEmp / pensionable;
    cpp1 = cpp1 * (1 + selfShare); // employer half extra on self part
  }
  const tier2Base = Math.max(0, Math.min(pensionable, PR.yampe) - PR.ympe);
  cpp2 = tier2Base * PR.cpp2Rate * (selfEmp > 0 && pensionable > 0 ? (1 + selfEmp / pensionable) : 1);

  let ei = 0, qpip = 0;
  const eiRate = isQC ? PR.eiRateQC : PR.eiRate;
  ei = Math.min(employment, PR.mie) * eiRate;
  if (isQC) qpip = Math.min(employment, PR.qpipCeil) * PR.qpipRate;

  // base CPP for credit (only base 4.95% portion approx): use 4.95/5.95 share
  const cppBaseCreditAmt = cpp1 * (4.95 / 5.95) * (isQC ? 1 : 1);

  // ---- federal tax ----
  const fed = bracketTax(taxableIncome, F.brackets, F.rates);
  let fedGross = fed.tax;
  const bpa = federalBPA(year, netIncome);
  const lowestFed = F.rates[0];
  const empAmt = Math.min(employment, O.canadaEmploymentAmount[year]);
  let ageAmt = 0;
  if (age65) {
    const thr = O.ageCredit.threshold[year];
    ageAmt = Math.max(0, O.ageCredit[year] - Math.max(0, netIncome - thr) * 0.15);
  }
  const spouseAmt = num("#cSpouse") > 0 ? Math.max(0, Math.min(O.spouseCreditMax[year], O.spouseCreditMax[year] - Math.min(num("#cSpouse"), O.spouseCreditMax[year]))) : 0;
  const tuition = num("#cTuition"), medical = num("#cMedical"), donations = num("#cDonate");
  const fedCreditsBase = bpa + empAmt + cppBaseCreditAmt + ei + ageAmt + spouseAmt + tuition + Math.max(0, medical - Math.min(0.03 * netIncome, 2759)) ;
  let fedCredits = fedCreditsBase * lowestFed;
  // dividend credits (federal)
  fedCredits += eligGross * 0 + eligDiv * O.eligibleGrossUp * 0; // placeholder replaced below
  const eligFedCredit = eligGross * (O.eligibleFedCredit);
  const nonEligFedCredit = nonEligGross * (O.nonEligibleFedCredit);
  // NOTE: Taxtips gross-up credit rates are % of grossed amount: eligible ~15.0198%, non-eligible ~9.3423% (2025)
  fedCredits += eligFedCredit + nonEligFedCredit;
  // donations: first $200 at lowest, rest at 29%
  if (donations > 0) fedCredits += Math.min(donations, 200) * lowestFed + Math.max(0, donations - 200) * 0.29;

  let fedNet = Math.max(0, fedGross - fedCredits);
  // Quebec abatement
  let abatement = 0;
  if (isQC) { abatement = fedNet * O.quebecAbatement; fedNet -= abatement; }

  // ---- provincial tax ----
  const provBrackets = P.brackets, provRates = P.rates;
  const prv = bracketTax(taxableIncome, provBrackets, provRates);
  let provGross = prv.tax;
  const lowestProv = provRates[0];
  let provCredits = (P.bpa + Math.min(employment, O.canadaEmploymentAmount[year]) * 0 + cppBaseCreditAmt + ei + ageAmt * 0 + spouseAmt * 0) * 0;
  // Simplified provincial credits: BPA + CPP base + EI + age (provincial age ~ same) + spouse
  const provAgeAmt = age65 ? Math.max(0, (P.bpa * 0.55) - Math.max(0, netIncome - 40000) * 0.05) : 0; // approximation
  provCredits = (P.bpa + cppBaseCreditAmt + ei + (age65 ? O.ageCredit[year] * 0.9 : 0) + spouseAmt + tuition + Math.max(0, medical - Math.min(0.03 * netIncome, 2759))) * lowestProv;
  // provincial dividend credits (avg approx): eligible ~10%, non-eligible ~3-4%
  const provDivRates = { ON: [0.10, 0.02986], QC: [0.117, 0.076], BC: [0.12, 0.032], AB: [0.1016, 0.0288], SK: [0.11, 0.03], MB: [0.08, 0.013], NS: [0.085, 0.025], NB: [0.09, 0.03], NL: [0.095, 0.035], PE: [0.105, 0.028], NT: [0.115, 0.03], NU: [0.058, 0.021], YT: [0.12, 0.021] };
  const dr = provDivRates[prov] || [0.10, 0.03];
  provCredits += eligGross * dr[0] + nonEligGross * dr[1];
  if (donations > 0) provCredits += Math.min(donations, 200) * lowestProv + Math.max(0, donations - 200) * (provRates[provRates.length - 1] * 0.9);

  let provNet = Math.max(0, provGross - provCredits);
  let surtax = 0, health = 0;
  if (P.surtax) { surtax = ontarioSurtax(provNet); provNet += surtax; }
  if (P.healthPremium) { health = taxableIncome > 20000 ? ontarioHealthPremium(taxableIncome) : 0; provNet += health; }

  const totalIncomeTax = fedNet + provNet;
  const totalPayroll = cpp1 + cpp2 + ei + qpip;
  const totalOwing = totalIncomeTax + totalPayroll;
  const afterTax = Math.max(0, grossForDisplay - totalDeductions * 0 - totalOwing - 0); // deductions already lowered tax; cash = gross - rrsp? show both
  const cashInHand = grossForDisplay - totalOwing - rrsp - fhsa; // RRSP is savings, show separately
  const avgRate = grossForDisplay > 0 ? totalIncomeTax / grossForDisplay : 0;
  const effRateAll = grossForDisplay > 0 ? totalOwing / grossForDisplay : 0;
  const margFed = marginalRate(taxableIncome + 1, F.brackets, F.rates);
  const margProv = marginalRate(taxableIncome + 1, provBrackets, provRates);
  const margCombined = margFed + margProv * (isQC ? 1 : 1);

  return {
    year, prov, F, P, PR, isQC, employment, selfEmp, grossForDisplay, totalIncomeForTax,
    totalDeductions, taxableIncome, netIncome, bpa, fedGross, fedCredits, fedNet, abatement,
    provGross, provCredits, provNet, surtax, health, totalIncomeTax,
    cpp1, cpp2, cppLabel, ei, qpip, totalPayroll, totalOwing, afterTax, cashInHand,
    avgRate, effRateAll, margFed, margProv, margCombined, fedDetail: fed.detail, provDetail: prv.detail,
    rrsp, fhsa, donations, eligGross, nonEligGross, capTaxable
  };
}

function render() {
  const r = calculate();
  $("#kFed").innerHTML = fmt(r.fedNet) + `<br><small class="muted">gross ${fmt(r.fedGross)} − credits ${fmt(r.fedCredits)}${r.abatement ? ` − abatement ${fmt(r.abatement)}` : ""}</small>`;
  $("#kProv").innerHTML = fmt(r.provNet) + `<br><small class="muted">gross ${fmt(r.provGross)} − credits ${fmt(r.provCredits)}${r.surtax ? ` + surtax ${fmt(r.surtax)}` : ""}${r.health ? ` + health ${fmt(r.health)}` : ""}</small>`;
  $("#kTotal").innerHTML = fmt(r.totalIncomeTax) + `<br><small class="muted">avg ${(r.avgRate * 100).toFixed(1)}% · marginal ${(r.margCombined * 100).toFixed(1)}%</small>`;
  $("#kTake").innerHTML = fmt(r.grossForDisplay - r.totalOwing) + `<br><small class="muted">after income tax + ${r.cppLabel}/EI${r.isQC ? "/QPIP" : ""}</small>`;

  $("#payrollLine").innerHTML =
    `<b>${r.cppLabel}:</b> ${fmt2(r.cpp1)}${r.cpp2 ? ` + <b>${r.cppLabel}2:</b> ${fmt2(r.cpp2)}` : ""} &nbsp;·&nbsp; <b>EI:</b> ${fmt2(r.ei)}${r.isQC ? ` &nbsp;·&nbsp; <b>QPIP:</b> ${fmt2(r.qpip)}` : ""} &nbsp;·&nbsp; <b>Total payroll:</b> ${fmt2(r.totalPayroll)}`;

  const rows = [
    ["Total income (cash received)", r.grossForDisplay, ""],
    ["Deductions from income (RRSP, FHSA, union, childcare…)", -r.totalDeductions, ""],
    ["Taxable income (line 26000)", r.taxableIncome, "chip"],
    ["Federal tax (gross)", r.fedGross, ""],
    ["Federal non-refundable credits", -r.fedCredits, "green"],
    ...(r.abatement ? [["Québec federal abatement (16.5%)", -r.abatement, "green"]] : []),
    ["Federal tax payable", r.fedNet, "bold"],
    ["Provincial tax (gross)", r.provGross, ""],
    ["Provincial credits", -r.provCredits, "green"],
    ...(r.surtax ? [["Ontario surtax", r.surtax, ""]] : []),
    ...(r.health ? [["Ontario Health Premium", r.health, ""]] : []),
    ["Provincial tax payable", r.provNet, "bold"],
    ["Combined income tax", r.totalIncomeTax, "bold"],
    [`${r.cppLabel} / ${r.cppLabel}2 + EI${r.isQC ? " + QPIP" : ""}`, r.totalPayroll, ""],
    ["Total owing (tax + payroll)", r.totalOwing, "total"],
  ];
  $("#breakdown").innerHTML = rows.map(([l, v, c]) =>
    `<tr><td>${(c === 'bold' || c === 'total') ? '<b>' + l + '</b>' : l}</td><td class='num' style='${v < 0 ? 'color:var(--green);' : ''}${c === 'total' ? 'font-size:15px;' : ''}'>${v < 0 ? '−' : ''}${fmt(Math.abs(v))}</td></tr>`).join("");

  // bars
  const max = Math.max(r.grossForDisplay, 1);
  const bars = [
    ["Income tax", r.totalIncomeTax, "#d80621"],
    [`${r.cppLabel} / EI`, r.totalPayroll, "#0b5fff"],
    ["You keep", Math.max(0, r.grossForDisplay - r.totalOwing), "#0e9f6e"],
  ];
  $("#bars").innerHTML = bars.map(([l, v, c]) =>
    `<div class="bar-row"><div><b>${l}</b><br><span class="muted">${fmt(v)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(v / max * 100).toFixed(1)}%;background:${c}"></div></div><div class="num">${(v / max * 100).toFixed(1)}%</div></div>`).join("");

  // paycheque
  const freq = parseFloat($("#payFreq").value || "26");
  $("#payTable").innerHTML = [["Per pay", (r.grossForDisplay - r.totalOwing) / freq, r.grossForDisplay / freq, r.totalOwing / freq],
    ["Monthly", (r.grossForDisplay - r.totalOwing) / 12, r.grossForDisplay / 12, r.totalOwing / 12],
    ["Annual", r.grossForDisplay - r.totalOwing, r.grossForDisplay, r.totalOwing]]
    .map(([l, net, gross, owe]) => `<tr><td><b>${l}</b></td><td class="num">${fmt(gross)}</td><td class="num">${fmt(owe)}</td><td class="num" style="color:var(--green)">${fmt(net)}</td></tr>`).join("");

  drawChart(r);
  renderBrackets(r);
  saveDraft();
}

function drawChart(r) {
  const c = $("#chart"), ctx = c.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  c.width = c.clientWidth * dpr; c.height = 220 * dpr; ctx.scale(dpr, dpr);
  const W = c.clientWidth, H = 220;
  ctx.clearRect(0, 0, W, H);
  const segs = [
    { l: "Federal", v: r.fedNet, c: "#d80621" },
    { l: "Provincial", v: r.provNet, c: "#ff8a5c" },
    { l: r.cppLabel + "+EI", v: r.totalPayroll, c: "#0b5fff" },
    { l: "Take-home", v: Math.max(0, r.grossForDisplay - r.totalOwing), c: "#0e9f6e" },
  ];
  const tot = Math.max(1, segs.reduce((a, s) => a + s.v, 0));
  let x = 10;
  const bw = W - 20;
  ctx.font = "12px Inter, sans-serif";
  segs.forEach(s => {
    const w = bw * s.v / tot;
    if (w < 2) return;
    ctx.fillStyle = s.c;
    ctx.beginPath(); ctx.roundRect(x, 60, w, 60, 10); ctx.fill();
    if (w > 70) { ctx.fillStyle = "#fff"; ctx.font = "bold 12px Inter"; ctx.fillText(s.l, x + 8, 85); ctx.font = "12px Inter"; ctx.fillText(fmt(s.v), x + 8, 103); }
    x += w + 3;
  });
  // legend
  let lx = 10;
  ctx.font = "12px Inter";
  segs.forEach(s => { ctx.fillStyle = s.c; ctx.fillRect(lx, 140, 12, 12); ctx.fillStyle = "#0f1e33"; ctx.fillText(`${s.l} — ${fmt(s.v)}`, lx + 18, 150); lx += ctx.measureText(`${s.l} — ${fmt(s.v)}`).width + 30; if (lx > W - 150) { lx = 10; } });
  ctx.fillStyle = "#5b6b82";
  ctx.fillText(`Marginal rate ${(r.margCombined * 100).toFixed(1)}%  ·  Average ${(r.avgRate * 100).toFixed(1)}%  ·  Taxable ${fmt(r.taxableIncome)}`, 10, 180);
  ctx.fillText(`${r.prov} ${r.year} · Federal BPA ${fmt(r.bpa)} · Prov BPA ${fmt(r.P.bpa)}`, 10, 200);
}

function renderBrackets(r) {
  const frows = r.fedDetail.map(d => `<tr><td>${fmt(d.from)} – ${d.to ? fmt(d.to) : "∞"}</td><td class="num">${(d.rate * 100).toFixed(2)}%</td><td class="num">${fmt(d.base)}</td><td class="num">${fmt(d.tax)}</td></tr>`).join("");
  const prows = r.provDetail.map(d => `<tr><td>${fmt(d.from)} – ${d.to ? fmt(d.to) : "∞"}</td><td class="num">${(d.rate * 100).toFixed(2)}%</td><td class="num">${fmt(d.base)}</td><td class="num">${fmt(d.tax)}</td></tr>`).join("");
  $("#bracketTables").innerHTML = `
    <h3>Federal brackets — ${r.year} <span class="chip">${(r.F.rates[0] * 100).toFixed(1)}% lowest</span><span class="chip">BPA ${fmt(r.bpa)}</span></h3>
    <table class="table bracket-table"><tr><th>Bracket</th><th class="num">Rate</th><th class="num">In bracket</th><th class="num">Tax</th></tr>${frows}</table>
    <h3 style="margin-top:14px">${TAX_DATA.provinces[r.prov].name} brackets — ${r.year} <span class="chip">BPA ${fmt(r.P.bpa)}</span>${r.isQC ? '<span class="chip">16.5% federal abatement</span>' : ""}${r.P.surtax ? '<span class="chip">ON surtax + health premium incl.</span>' : ""}</h3>
    <table class="table bracket-table"><tr><th>Bracket</th><th class="num">Rate</th><th class="num">In bracket</th><th class="num">Tax</th></tr>${prows}</table>`;
}

function saveDraft() {
  const data = {};
  $$("[data-save]").forEach(el => data[el.id] = el.type === "checkbox" ? el.checked : el.value);
  try { localStorage.setItem("mapletax-draft", JSON.stringify(data)); } catch (e) {}
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem("mapletax-draft") || "{}");
    Object.entries(d).forEach(([k, v]) => {
      const el = document.getElementById(k);
      if (!el) return;
      if (el.type === "checkbox") el.checked = !!v; else el.value = v;
    });
  } catch (e) {}
}

function switchTab(name) {
  $$(".nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tabs").forEach(t => t.classList.toggle("show", t.id === "tab-" + name));
  window.scrollTo({ top: document.querySelector("main").offsetTop - 70, behavior: "smooth" });
}

function printSummary() { window.print(); }
function resetAll() {
  $$("[data-save]").forEach(el => { if (el.type === "checkbox") el.checked = false; else if (el.tagName === "SELECT") el.selectedIndex = 0; else el.value = el.id === "payFreq" ? el.value : ""; });
  $("#taxYear").value = "2026"; $("#province").value = "ON"; $("#payFreq").value = "26";
  render();
}

function buildYearOptions(years) {
  const sel = $("#taxYear");
  const cur = sel.value;
  const sorted = years.slice().sort().reverse();
  const latest = sorted[0];
  sel.innerHTML = sorted.map((y) => `<option value="${y}">${y}${y === latest ? ' (latest)' : ''}</option>`).join("");
  if (years.includes(cur)) sel.value = cur; else sel.value = latest;
}

function showTableMeta(info) {
  const el = $("#tablesMeta");
  if (el) el.textContent = "Tables in use: " + info.years.map((y) => y + " " + (info.sources[y] || "")).join(" · ");
  const st = $("#updStatus");
  if (st) st.textContent = info.lastCheck ? "Last checked: " + new Date(info.lastCheck).toLocaleString() : "Never checked for updates.";
}

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Merge any downloaded tax-table updates over bundled data (offline-safe)
  let info = { years: Object.keys(TAX_DATA.federal).sort(), sources: {}, lastCheck: "" };
  try { info = await Updater.boot(); } catch (e) { /* bundled fallback */ }
  buildYearOptions(info.years);
  // build province options
  const ps = $("#province");
  ps.innerHTML = Object.entries(TAX_DATA.provinces).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
  loadDraft();
  if (!info.years.includes($("#taxYear").value)) $("#taxYear").value = info.years.slice().sort().reverse()[0];
  if (!$("#province").value) $("#province").value = "ON";
  showTableMeta(info);
  // settings wiring
  const baseInput = $("#updBase");
  if (baseInput) baseInput.value = Updater.getBase();
  const btnCheck = $("#btnCheckUpd");
  if (btnCheck) btnCheck.addEventListener("click", async () => {
    const base = baseInput.value.trim();
    Updater.setBase(base);
    const st = $("#updStatus");
    st.textContent = "Checking…";
    btnCheck.disabled = true;
    try {
      const res = await Updater.checkForUpdates(base, (m) => { st.textContent = m; });
      info = await Updater.boot();
      buildYearOptions(info.years);
      showTableMeta(info);
      render();
      st.textContent = res.upToDate
        ? "Already up to date."
        : "Installed: " + [...res.added.map((a) => "new " + a), ...res.updated.map((u) => "updated " + u)].join(", ") + ". Calculator now uses the new tables.";
    } catch (e) {
      st.textContent = "Update failed: " + e.message + " (kept current tables)";
    }
    btnCheck.disabled = false;
  });
  const btnReset = $("#btnResetTables");
  if (btnReset) btnReset.addEventListener("click", () => { Updater.resetToBundled(); location.reload(); });
  const btnSync = $("#btnSyncCRA");
  if (btnSync) btnSync.addEventListener("click", async () => {
    const st = $("#updStatus");
    st.textContent = "Contacting canada.ca…";
    btnSync.disabled = true;
    try {
      const res = await Updater.syncFromCRA((m) => { st.textContent = m; });
      info = await Updater.boot();
      buildYearOptions(info.years);
      if (!info.years.includes($("#taxYear").value)) $("#taxYear").value = info.years.slice().sort().reverse()[0];
      showTableMeta(info);
      render();
      st.textContent = "Synced from canada.ca: " + [...res.added.map((a) => "new " + a), ...res.updated.map((u) => "refreshed " + u)].join(", ") + ". (Québec brackets stay bundled — see Revenu Québec.)";
    } catch (e) {
      st.textContent = "CRA sync failed: " + e.message;
    }
    btnSync.disabled = false;
  });
  $$("[data-save]").forEach(el => el.addEventListener("input", render));
  $("#payFreq").addEventListener("change", render);
  $$(".nav button").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("#btnPrint").addEventListener("click", printSummary);
  $("#btnReset").addEventListener("click", resetAll);
  // sample
  if (!localStorage.getItem("mapletax-draft")) { $("#inEmployment").value = 85000; $("#dRRSP").value = 5000; }
  render();
});
