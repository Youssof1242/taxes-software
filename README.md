# taxes-software
# 🍁 MapleTax Canada — 2024–2026 Personal Tax Software

Free, offline, CRA-aligned Canadian income-tax estimator with a modern UI.

## Get it from GitHub
- **Users:** download `MapleTax-Canada-Portable.exe` from the
  [**Releases**](https://github.com/YOU/mapletax-canada/releases) page —
  no install needed, just double-click.
- **Developers:**
  ```bash
  git clone https://github.com/YOU/mapletax-canada.git
  cd mapletax-canada
  npm install      # or: npm ci
  npm start        # run the desktop app from source
  ```
  Rebuild the exe locally: `npm run dist-portable` (output in `release/`).
  Publish a new exe: `git tag v1.0.1; git push origin v1.0.1` — the
  GitHub Action builds it and attaches it to the Release automatically.

## Run it — just the exe (recommended)
Download **`MapleTax.exe`** (~3 MB, single file) from
[**Releases**](https://github.com/YOU/mapletax-canada/releases) and
double-click it. No install, nothing else needed — it uses the WebView2
engine already built into Windows 10/11. Your numbers stay on your
computer (auto-saved draft; internet only used for the Canada.ca sync).

Built locally at `release\MapleTax.exe` via `npm run dist-native`.

<details>
<summary>Alternative: full Electron build</summary>

`release\MapleTax-Canada-Portable.exe` (~74 MB, via `npm run dist-portable`)
bundles its own Chrome — useful if WebView2 is missing. Developer mode:
`npm start`. Web fallback: open `index.html` in any browser.
</details>

## What's inside
- **Calculator tab** — employment, self-employment, pension, interest, capital gains (50% inclusion),
  eligible (+38%) / non-eligible (+15%) dividends with federal + provincial dividend credits,
  RRSP / FHSA / union / childcare / moving deductions, tuition / medical / donations / spouse / age 65+ credits.
- **Federal (2024/2025/2026)** — 2026: 14% to $58,523 → 20.5% → 26% → 29% → 33% over $258,482;
  BPA max $16,452 (2026), $16,129 (2025), phased out at the top. 2025 blended 14.5% rate modelled.
- **All 13 provinces/territories** — full brackets + BPAs, Québec 16.5% federal abatement (TP-1),
  Ontario surtax + Health Premium, Alberta 8% first bracket (2025+), BC 5.60% (2026), PEI top-bracket note.
- **Payroll** — CPP/QPP + CPP2/QPP2 second tier, EI / reduced QC-EI, QPIP; self-employed double-CPP handled.
- **Insights** — marginal vs average rate, T1-style breakdown, stacked chart, paycheque translator
  (weekly / bi-weekly / monthly / annual), bracket-by-bracket tables, print-to-PDF summary.
- **Guides** — T-slips & box numbers (T4/T4A/T4E/T5/T3/T5008/T2202/RL-1/RRSP), CRA line numbers,
  credits & deductions playbook, FAQ (marginal myth, Dec-31 residence rule, deadlines).

## Files
| File | Purpose |
|---|---|
| `index.html` | UI + all tabs/guides |
| `styles.css` | Theme (Maple red, responsive, print-friendly) |
| `updater.js` | Self-update engine: validates + installs new tables, offline-safe |
| `tables/` | Versioned per-year tables (`2026.json`…) + `manifest.json` — the update payload |
| `tools/scaffold-year.js` | Generates next year's draft tables from CRA indexation in seconds |
| `app.js` | Calculation engine + charts + draft saving |

## Accuracy
Aligned to CRA T4127 payroll formulas, CRA indexation factors (2026: 2.0% federal),
Revenu Québec and provincial budgets. Brackets are indexation-rounded estimates —
always confirm at **canada.ca → Tax rates and income brackets** before filing.
This tool is an **estimator, not NETFILE software** and not tax advice.

## Staying current forever (no reinstall ever needed)
**Easiest — one click, straight from the government (desktop app):**
1. Open MapleTax → **⚙ Settings & Updates**.
2. Click **🇨🇦 Sync directly from Canada.ca**.
3. The app pulls fresh brackets, basic personal amounts, CPP/QPP and EI
   figures from official CRA pages, validates them, and applies them —
   new tax years appear automatically. Works offline from then on.

Covers federal + 12 provinces/territories. Québec brackets come from
Revenu Québec (which blocks automated fetching) and stay bundled —
verify them at **revenuquebec.ca** when they change.

**Maintainer alternative (refresh the built-ins, e.g. each fall):**
1. Run `node tools/refresh-from-cra.js` — re-pulls everything above and
   rebuilds the bundled fallback (`tax-data.js`).
2. Or scaffold a draft early with
   `node tools/scaffold-year.js 2027 --indexation 2.1 --rrsp 35340`,
   verify vs CRA T4127 + provincial budgets, set `status:"final"`.

**Browser users (10 seconds):**
1. Open MapleTax → **⚙ Settings & Updates**.
2. Paste the raw URL once: `https://raw.githubusercontent.com/YOU/mapletax-tables/main/tables`
3. Click **Check publisher URL for updates** — new years install, are validated
   before applying (corrupt files are rejected), and work offline from then on.
4. "Revert to built-in tables" wipes downloaded updates if ever needed.
