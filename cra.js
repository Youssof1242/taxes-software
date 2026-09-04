/* ============================================================
   MapleTax CRA sync — parses official canada.ca pages directly.
   Sources (all Government of Canada, no key needed):
     - tax-rates-brackets/current-year.html + last-year.html
       (federal + 12 provincial/territorial bracket tables)
     - line-30000-basic-personal-amount.html (federal + prov BPAs)
     - CPP rates CSV (YMPE, exemption, rate by year)
     - second-additional-cpp (CPP2 YAMPE by year)
     - EI premium rates (federal + Quebec MIE/rates by year)
   Quebec brackets come from Revenu Quebec (bot-protected) and are
   preserved from existing tables, flagged for manual verify.
   Pure functions (no network/DOM) — testable in Node or browser.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CRA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var URLS = {
    bracketsCurrent: 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html',
    bracketsLast: 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/last-year.html',
    bpa: 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-30000-basic-personal-amount.html',
    cpp: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html',
    cpp2: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/calculating-deductions/making-deductions/second-additional-cpp-contribution-rates-maximums.html',
    ei: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html'
  };

  var PROV_BY_NAME = {
    'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB',
    'new brunswick': 'NB', 'newfoundland and labrador': 'NL',
    'northwest territories': 'NT', 'nova scotia': 'NS', 'nunavut': 'NU',
    'ontario': 'ON', 'prince edward island': 'PE', 'quebec': 'QC',
    'saskatchewan': 'SK', 'yukon': 'YT'
  };

  function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ')
      .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  function money(v) {
    v = stripTags(v).toLowerCase();
    if (!v || v.indexOf('unlimited') >= 0) return null;
    var n = parseFloat(v.replace(/[$,\s]/g, ''));
    return isNaN(n) ? null : n;
  }
  function rate(v) {
    var n = parseFloat(stripTags(v).replace(/%/g, '').trim());
    return isNaN(n) ? null : Math.round(n * 100) / 10000;
  }

  // ---- bracket pages (current-year / last-year) ----
  function parseBracketPage(html) {
    var h1 = html.match(/tax rates and income brackets \((\d{4})\)/i);
    var year = h1 ? parseInt(h1[1], 10) : null;
    var out = { year: year, federal: null, provinces: {} };
    var capRe = /<caption[^>]*>([^<]+)<\/caption>[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;
    var m;
    while ((m = capRe.exec(html)) !== null) {
      var cap = stripTags(m[1]);
      var cm = cap.match(/^(.*?) rate:\s*(\d{4})$/i);
      if (!cm) continue;
      var who = cm[1].trim().toLowerCase();
      var y = parseInt(cm[2], 10);
      if (year && y !== year) continue;
      var rows = [];
      var rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
      var r, ok = true;
      while ((r = rowRe.exec(m[2])) !== null) {
        var from = money(r[1]), up = money(r[2]), rt = rate(r[3]);
        if (from === null || rt === null || (up === null && false)) { ok = false; break; }
        rows.push({ from: from, up: up, rate: rt });
      }
      if (!ok || !rows.length) continue;
      if (rows[0].from !== 0) continue;
      if (rows[rows.length - 1].up !== null) continue; // last band must be unlimited
      var brackets = [], rates = [];
      for (var i = 0; i < rows.length; i++) {
        rates.push(rows[i].rate);
        if (rows[i].up !== null) brackets.push(Math.round(rows[i].up));
      }
      if (rates.length !== brackets.length + 1) continue;
      if (who === 'federal') out.federal = { brackets: brackets, rates: rates };
      else if (PROV_BY_NAME[who] && PROV_BY_NAME[who] !== 'QC') {
        out.provinces[PROV_BY_NAME[who]] = { brackets: brackets, rates: rates };
      }
    }
    if (!out.federal) throw new Error('Federal table not found/parseable');
    return out;
  }

  // ---- BPA page ----
  function parseBpaPage(html) {
    var text = stripTags(html);
    var ym = text.match(/Tax year:\s*(\d{4})/);
    var taxYear = ym ? parseInt(ym[1], 10) : null;
    var out = { taxYear: taxYear, federal: null, provincial: {} };
    var fm = text.match(/Federal amount for \d{4}[\s\S]{0,600}?\$([\d,]+) or less[\s\S]{0,200}?claim[\s\S]{0,60}?\$([\d,]+)[\s\S]{0,600}?more than \$([\d,]+)[\s\S]{0,200}?claim[\s\S]{0,60}?\$([\d,]+)/i);
    if (fm) {
      out.federal = {
        threshold: parseInt(fm[1].replace(/,/g, ''), 10),
        max: parseInt(fm[2].replace(/,/g, ''), 10),
        end: parseInt(fm[3].replace(/,/g, ''), 10),
        min: parseInt(fm[4].replace(/,/g, ''), 10)
      };
    }
    var names = Object.keys(PROV_BY_NAME);
    for (var i = 0; i < names.length; i++) {
      var code = PROV_BY_NAME[names[i]];
      if (code === 'QC' || code === 'MB' || code === 'YT') continue; // RQ link / phaseout / =line 30000
      var re = new RegExp(names[i] + '[\\s\\S]{0,300}?Claim \\$([\\d,]+)', 'i');
      var pm = text.match(re);
      if (pm) out.provincial[code] = parseInt(pm[1].replace(/,/g, ''), 10);
    }
    return out;
  }

  // ---- CPP official CSV ----
  function parseCppCsv(csv) {
    var out = {};
    var lines = String(csv || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^"?(\d{4})"?\s*,\s*"?\$?([\d,]+)"?\s*,\s*"?\$?([\d,]+)"?\s*,\s*"?\$?([\d,]+)"?\s*,\s*"?([\d.]+)"?/);
      if (m) out[m[1]] = {
        ympe: parseInt(m[2].replace(/,/g, ''), 10),
        exempt: parseInt(m[3].replace(/,/g, ''), 10),
        rate: parseFloat(m[5]) / 100
      };
    }
    return out;
  }

  // ---- generic year-row tables (CPP, CPP2, EI federal/quebec) ----
  // Returns rows: { label, year, cells[] } with cells as plain text.
  // Callers interpret columns via parseMoney / parseRate.
  function parseYearTables(html, needPhrase) {
    var tables = [];
    var tRe = /<table[\s\S]*?<\/table>/gi, tm;
    while ((tm = tRe.exec(html)) !== null) {
      var t = tm[0];
      var before = html.slice(Math.max(0, tm.index - 2000), tm.index);
      var heads = before.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi) || [];
      var label = heads.length ? stripTags(heads[heads.length - 1]) : '';
      var hay = (stripTags(t) + ' ' + label).toLowerCase();
      if (needPhrase && hay.indexOf(needPhrase) < 0) continue;
      tables.push({ label: label, html: t });
    }
    var rows = [];
    tables.forEach(function (tb) {
      var rRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi, r;
      while ((r = rRe.exec(tb.html)) !== null) {
        var cells = [];
        var cRe = /<td[^>]*>([\s\S]*?)<\/td>/gi, c;
        while ((c = cRe.exec(r[1])) !== null) cells.push(stripTags(c[1]));
        if (!cells.length) continue;
        var ym = cells[0].match(/(\d{4})/);
        if (!ym) continue;
        rows.push({ label: tb.label, year: ym[1], cells: cells });
      }
    });
    return rows;
  }

  // ---- assemble year docs in MapleTax table shape ----
  function buildYearDocs(parts, prev) {
    var docs = {};
    var pages = [parts.current, parts.last].filter(Boolean);
    var bpa = parts.bpa || null;
    var today = new Date().toISOString().slice(0, 10);
    var dateInt = parseInt(today.replace(/-/g, ''), 10);
    pages.forEach(function (pg) {
      var y = String(pg.year);
      var base = prev.federal[y] ? null : null;
      var pPrev = prev;
      var fedPrev = (pPrev.federal && pPrev.federal[y]) || {};
      // federal: brackets from CRA; BPA from BPA page when its tax year matches
      var fed = {
        brackets: pg.federal.brackets, rates: pg.federal.rates,
        bpaMin: fedPrev.bpaMin, bpaMax: fedPrev.bpaMax,
        bpaThreshold: fedPrev.bpaThreshold, bpaEnd: fedPrev.bpaEnd,
        indexation: fedPrev.indexation, note: fedPrev.note
      };
      var bpaNote = [];
      if (bpa && bpa.taxYear === pg.year && bpa.federal) {
        fed.bpaMin = bpa.federal.min; fed.bpaMax = bpa.federal.max;
        fed.bpaThreshold = bpa.federal.threshold; fed.bpaEnd = bpa.federal.end;
        bpaNote.push('BPA: canada.ca line-30000');
      } else if (fedPrev.bpaMax) {
        bpaNote.push('BPA carried from prior tables (CRA publishes each fall)');
      }
      var provinces = {};
      Object.keys(pPrev.provinces || {}).forEach(function (code) {
        var keep = (pPrev.provinces[code] && pPrev.provinces[code][y]) || {};
        if (pg.provinces[code]) {
          provinces[code] = {
            brackets: pg.provinces[code].brackets, rates: pg.provinces[code].rates,
            bpa: keep.bpa
          };
        } else {
          provinces[code] = Object.assign({}, keep); // e.g. QC from RQ
        }
        ['surtax', 'healthPremium', 'abatement', 'note', 'name'].forEach(function (k) {
          if (keep[k] !== undefined && provinces[code][k] === undefined) provinces[code][k] = keep[k];
        });
      });
      if (bpa && bpa.taxYear === pg.year) {
        Object.keys(bpa.provincial).forEach(function (code) {
          if (provinces[code]) provinces[code].bpa = bpa.provincial[code];
        });
      }
      var prPrev = (pPrev.payroll && pPrev.payroll[y]) || {};
      var payroll = Object.assign({}, prPrev);
      var cpp = (parts.cpp && parts.cpp[y]) || null;
      if (cpp) { payroll.ympe = cpp.ympe; payroll.exempt = cpp.exempt; payroll.cppRate = cpp.rate; }
      var c2 = (parts.cpp2 && parts.cpp2[y]) || null;
      if (c2) { payroll.yampe = c2.yampe; payroll.cpp2Rate = c2.rate; }
      var ei = (parts.ei && parts.ei[y]) || null;
      if (ei) { payroll.mie = ei.mie; payroll.eiRate = ei.rate; payroll.eiMax = Math.round(ei.mie * ei.rate * 100) / 100; }
      var eiQ = (parts.eiQC && parts.eiQC[y]) || null;
      if (eiQ) payroll.eiRateQC = eiQ.rate;
      docs[y] = {
        year: pg.year, version: dateInt, updated: today, status: 'official',
        source: 'canada.ca', retrieved: new Date().toISOString(),
        notes: 'Brackets: CRA tax-rates-brackets page; ' + bpaNote.join('; ') +
          '; payroll: CRA CPP/EI pages' + (pg.provinces.QC ? '' : '; QC brackets: prior tables (Revenu Quebec)') + '.',
        federal: fed, provinces: provinces, payroll: payroll, other: pPrev.other || {}
      };
    });
    return docs;
  }

  return {
    URLS: URLS,
    parseMoney: money,
    parseRate: rate,
    parseBracketPage: parseBracketPage,
    parseBpaPage: parseBpaPage,
    parseCppCsv: parseCppCsv,
    parseYearTables: parseYearTables,
    buildYearDocs: buildYearDocs
  };
});
