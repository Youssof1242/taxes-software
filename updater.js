/* ============================================================
   MapleTax Updater — keeps tax tables current forever.
   How it works:
   1. Bundled tables ship in tax-data.js (+ tables/*.json reference).
   2. On boot, cached update files (downloaded previously) are merged
      OVER the bundled data. Cached copies live in localStorage, so they
      persist in both the browser and the Electron desktop app.
   3. "Check for updates" downloads manifest.json + per-year files from
      YOUR published update URL (e.g. a GitHub repo), validates them,
      and caches them. Next launch uses them automatically.
   The app always works offline using bundled data as fallback.
   ============================================================ */
window.Updater = (function () {
  const LS_TABLE = (y) => "mapletax.table." + y;
  const LS_BASE = "mapletax.update.base";
  const LS_LAST = "mapletax.update.lastCheck";

  function getBase() {
    try { return localStorage.getItem(LS_BASE) || ""; } catch (e) { return ""; }
  }
  function setBase(u) {
    try { localStorage.setItem(LS_BASE, u); } catch (e) {}
  }

  async function readBundled(rel) {
    // Electron: read from app files via preload bridge (fetch fails on file://)
    try {
      if (window.mapleTax && window.mapleTax.readBundled) {
        return await window.mapleTax.readBundled(rel);
      }
    } catch (e) { /* fall through to fetch */ }
    const r = await fetch(rel, { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  }

  function validateYearDoc(d) {
    if (!d || typeof d !== "object") return "not an object";
    if (!d.federal || !Array.isArray(d.federal.brackets) || !Array.isArray(d.federal.rates)) return "bad federal brackets";
    if (d.federal.rates.length !== d.federal.brackets.length + 1) return "federal rates/brackets mismatch";
    if (!d.provinces || typeof d.provinces !== "object" || Object.keys(d.provinces).length < 5) return "bad provinces";
    for (const [c, p] of Object.entries(d.provinces)) {
      if (!p || !Array.isArray(p.brackets) || !Array.isArray(p.rates) || typeof p.bpa !== "number") return "bad province " + c;
    }
    if (!d.payroll || typeof d.payroll.ympe !== "number" || typeof d.payroll.mie !== "number") return "bad payroll";
    if (typeof d.version !== "number") return "missing version";
    return null; // valid
  }

  function mergeDoc(doc) {
    const y = String(doc.year);
    TAX_DATA.federal[y] = doc.federal;
    for (const [code, slice] of Object.entries(doc.provinces)) {
      if (!TAX_DATA.provinces[code]) TAX_DATA.provinces[code] = { name: code, abbr: code };
      TAX_DATA.provinces[code][y] = slice;
      if (slice.name) TAX_DATA.provinces[code].name = slice.name;
    }
    TAX_DATA.payroll[y] = doc.payroll;
    if (doc.other) TAX_DATA.other = doc.other; // newest loaded year wins (boot loads ascending)
  }

  function readCache(year) {
    try {
      const raw = localStorage.getItem(LS_TABLE(year));
      if (!raw) return null;
      const d = JSON.parse(raw);
      return validateYearDoc(d) ? null : d;
    } catch (e) { return null; }
  }
  function writeCache(doc) {
    try { localStorage.setItem(LS_TABLE(doc.year), JSON.stringify(doc)); } catch (e) {}
  }

  async function boot() {
    const sources = {};   // year -> 'bundled' | 'updated (vN)'
    const versions = {};  // year -> version in use
    let years = Object.keys(TAX_DATA.federal).sort();
    // Discover bundled manifest versions (best effort; fallback = v1)
    const bundledVer = {};
    try {
      const m = JSON.parse(await readBundled("tables/manifest.json"));
      if (m && m.years) {
        for (const [y, info] of Object.entries(m.years)) bundledVer[String(y)] = info.version || 1;
        const my = Object.keys(m.years).sort();
        if (my.length) years = my;
      }
    } catch (e) { /* offline/file mode: use TAX_DATA global as-is */ }

    for (const y of years) {
      const cached = readCache(y);
      const bv = bundledVer[y] || 1;
      if (cached && cached.version >= bv) {
        try { mergeDoc(cached); sources[y] = (cached.source || "manual") + " v" + cached.version; versions[y] = cached.version; continue; }
        catch (e) { /* fall back to bundled */ }
      }
      sources[y] = "bundled (v" + bv + ")";
      versions[y] = bv;
    }
    // Merge order: ascending so newest `other` wins
    return { years, sources, versions, base: getBase(), lastCheck: lastCheck() };
  }

  function lastCheck() {
    try { return localStorage.getItem(LS_LAST) || ""; } catch (e) { return ""; }
  }

  async function checkForUpdates(base, onLog) {
    const log = onLog || function () {};
    base = (base || getBase() || "").replace(/\/+$/, "");
    if (!base) throw new Error("No update source set. Paste your tables URL in Settings first (see README).");
    if (!/^https?:\/\//i.test(base)) throw new Error("Update source must be an http(s) URL.");
    log("Fetching manifest…");
    const mRes = await fetch(base + "/manifest.json", { cache: "no-store" });
    if (!mRes.ok) throw new Error("Manifest download failed (HTTP " + mRes.status + ").");
    const manifest = await mRes.json();
    if (!manifest || !manifest.years) throw new Error("Manifest is malformed.");
    const added = [], updated = [], skipped = [];
    const remoteYears = Object.keys(manifest.years).sort();
    for (const y of remoteYears) {
      const info = manifest.years[y] || {};
      const cur = currentVersion(y);
      const rv = info.version || 1;
      if (rv <= cur && TAX_DATA.federal[String(y)]) { skipped.push(y); continue; }
      log("Downloading " + y + " (v" + rv + ")…");
      const r = await fetch(base + "/" + (info.file || (y + ".json")), { cache: "no-store" });
      if (!r.ok) throw new Error("Download failed for " + y + " (HTTP " + r.status + ").");
      const doc = await r.json();
      const err = validateYearDoc(doc);
      if (err) throw new Error("Table " + y + " failed validation: " + err + ". Update aborted, nothing applied for " + y + ".");
      const isNew = !TAX_DATA.federal[String(y)];
      mergeDoc(doc);
      writeCache(doc);
      (isNew ? added : updated).push(y + " v" + rv);
    }
    try { localStorage.setItem(LS_LAST, new Date().toISOString()); } catch (e) {}
    return { added, updated, skipped, upToDate: added.length === 0 && updated.length === 0 };
  }

  function currentVersion(y) {
    const c = readCache(y);
    return c ? c.version : 1;
  }

  function resetToBundled() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.indexOf("mapletax.table.") === 0)
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
  }

  // Validate + merge + cache one year-doc. Returns { isNew }.
  function applyDoc(doc) {
    const err = validateYearDoc(doc);
    if (err) throw new Error("Table " + doc.year + " failed validation: " + err + ".");
    const isNew = !TAX_DATA.federal[String(doc.year)];
    mergeDoc(doc);
    writeCache(doc);
    return { isNew };
  }

  function snapshotPrev() {
    const prev = { federal: {}, provinces: {}, payroll: {}, other: TAX_DATA.other || {} };
    Object.keys(TAX_DATA.federal).forEach((y) => { prev.federal[y] = TAX_DATA.federal[y]; });
    Object.keys(TAX_DATA.provinces).forEach((c) => {
      prev.provinces[c] = {};
      Object.keys(TAX_DATA.provinces[c]).forEach((k) => {
        if (/^\d{4}$/.test(k)) prev.provinces[c][k] = TAX_DATA.provinces[c][k];
      });
    });
    Object.keys(TAX_DATA.payroll).forEach((y) => { prev.payroll[y] = TAX_DATA.payroll[y]; });
    return prev;
  }

  // One-click sync straight from canada.ca (desktop app only — browsers
  // are blocked by CRA's missing CORS headers; the shell fetches for us).
  async function syncFromCRA(onLog) {
    const log = onLog || function () {};
    if (typeof CRA === "undefined") throw new Error("CRA parser (cra.js) not loaded.");
    if (!window.mapleTax || !window.mapleTax.fetchText) {
      throw new Error("Direct CRA sync needs the MapleTax desktop app. In a browser, use the update-source URL instead.");
    }
    const U = CRA.URLS;
    log("Contacting canada.ca (brackets)…");
    const [curH, lastH] = await Promise.all([
      window.mapleTax.fetchText(U.bracketsCurrent),
      window.mapleTax.fetchText(U.bracketsLast)
    ]);
    log("Reading CRA basic personal amount…");
    const bpaH = await window.mapleTax.fetchText(U.bpa);
    log("Reading CRA payroll tables (CPP/EI)…");
    const [cppH, c2H, eiH] = await Promise.all([
      window.mapleTax.fetchText(U.cpp),
      window.mapleTax.fetchText(U.cpp2),
      window.mapleTax.fetchText(U.ei)
    ]);
    let pgCur, pgLast;
    try { pgCur = CRA.parseBracketPage(curH); } catch (e) { throw new Error("CRA bracket page changed format (" + e.message + "). Bundled tables kept."); }
    try { pgLast = CRA.parseBracketPage(lastH); } catch (e) { throw new Error("CRA prior-year page changed format (" + e.message + "). Bundled tables kept."); }
    const bpa = CRA.parseBpaPage(bpaH);
    const cpp = {};
    CRA.parseYearTables(cppH, "pensionable").forEach((r) => {
      if (r.cells.length >= 5) cpp[r.year] = { ympe: CRA.parseMoney(r.cells[1]), exempt: CRA.parseMoney(r.cells[2]), rate: CRA.parseRate(r.cells[4]) };
    });
    const cpp2 = {};
    CRA.parseYearTables(c2H, "additional").forEach((r) => {
      cpp2[r.year] = { yampe: CRA.parseMoney(r.cells[1]), rate: CRA.parseRate(r.cells[2]) };
    });
    const ei = {}, eiQC = {};
    CRA.parseYearTables(eiH, "insurable").forEach((r) => {
      const t = /quebec/i.test(r.label) ? eiQC : ei;
      t[r.year] = { mie: CRA.parseMoney(r.cells[1]), rate: CRA.parseRate(r.cells[2]) };
    });
    if (!Object.keys(cpp).length) throw new Error("CRA payroll page changed format. Bundled tables kept.");
    const docs = CRA.buildYearDocs({ current: pgCur, last: pgLast, bpa, cpp, cpp2, ei, eiQC }, snapshotPrev());
    const added = [], updated = [];
    Object.keys(docs).sort().forEach((y) => {
      const r = applyDoc(docs[y]);
      (r.isNew ? added : updated).push(y + " (canada.ca)");
    });
    try { localStorage.setItem(LS_LAST, new Date().toISOString()); } catch (e) {}
    return { added, updated, upToDate: false, years: Object.keys(docs).sort() };
  }

  return { boot, checkForUpdates, syncFromCRA, resetToBundled, getBase, setBase, lastCheck, validateYearDoc };
})();
