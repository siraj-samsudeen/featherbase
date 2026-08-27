// Generates the manual-testing fixture files described in
// docs/manual/spreadsheet-import.md. Run from the repo root:
//   node <this file> <repo-root>
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) throw new Error('pass the repo root')
const require = createRequire(join(root, 'apps/web/package.json'))
const XLSX = require('xlsx')

const out = join(root, 'docs/manual/fixtures')
mkdirSync(out, { recursive: true })

// ---- zones.csv — the clean happy path (8 rows, every inferable type) ----
const zones = [
  'Zone Name,Region,Population,Area Sq Km,Opened On,Is Active',
  'Alpha,North,12000,45.5,2026-01-15,yes',
  'Bravo,South,8400,12.25,2026-01-16,no',
  'Charlie,North,23100,88.0,2026-01-17,yes',
  'Delta,South,5600,7.75,2026-01-18,no',
  'Echo,North,15800,52.1,2026-02-02,yes',
  'Foxtrot,South,9900,31.4,2026-02-10,yes',
  'Golf,North,4300,6.8,2026-03-01,no',
  'Hotel,South,18700,64.9,2026-03-15,yes',
].join('\n')
writeFileSync(join(out, 'zones.csv'), zones + '\n')

// ---- zones-updates.csv — upsert against Zones (key: Zone Name) ----
// 3 updates (Alpha, Delta, Hotel), 2 inserts (India, Juliet),
// one blank cell (Delta's Population) for the keep/clear choice,
// and one row that duplicates a key inside the file (Alpha twice).
const zonesUpdates = [
  'Zone Name,Region,Population,Area Sq Km,Opened On,Is Active',
  'Alpha,North,12500,45.5,2026-01-15,yes',
  'Delta,South,,7.75,2026-01-18,yes',
  'Hotel,South,19200,64.9,2026-03-15,no',
  'India,North,7700,21.0,2026-04-01,yes',
  'Juliet,South,3100,4.2,2026-04-09,no',
  'Alpha,North,99999,45.5,2026-01-15,yes',
].join('\n')
writeFileSync(join(out, 'zones-updates.csv'), zonesUpdates + '\n')

// ---- zones-messy.csv — the things-going-wrong file ----
// bad int, bad date, a fully blank row, and rows that are fine.
const zonesMessy = [
  'Zone Name,Region,Population,Area Sq Km,Opened On,Is Active',
  'Kilo,North,11200,33.3,2026-05-01,yes',
  'Lima,South,twelve thousand,9.9,2026-05-02,no',
  'Mike,North,8100,14.6,not a date,yes',
  ',,,,,',
  'November,South,6600,11.1,2026-05-04,no',
  'Oscar,North,-50,2.2,2026-05-05,maybe',
  'Papa,South,7200,18.8,2026-05-06,yes',
].join('\n')
writeFileSync(join(out, 'zones-messy.csv'), zonesMessy + '\n')

// ---- zones-large.csv — 1,200 rows to watch chunked sending (500/chunk) ----
const largeRows = ['Zone Name,Region,Population,Area Sq Km,Opened On,Is Active']
for (let i = 1; i <= 1200; i++) {
  const region = i % 2 ? 'North' : 'South'
  const day = String((i % 28) + 1).padStart(2, '0')
  largeRows.push(
    `Bulk Zone ${String(i).padStart(4, '0')},${region},${1000 + i},${(i % 90) + 0.5},2026-06-${day},${i % 3 ? 'yes' : 'no'}`,
  )
}
writeFileSync(join(out, 'zones-large.csv'), largeRows.join('\n') + '\n')

// ---- store-sections.xlsx — the multi-sheet workbook for PR #210 ----
// Three same-shaped section sheets (one per supermarket) whose headers
// differ only in folding or in one genuinely different name; a sheet
// carrying BOTH names of an overlapping pair; a differently-shaped
// Summary sheet; and a hidden Scratch sheet.
const wb = XLSX.utils.book_new()
const aoa = (rows) => XLSX.utils.aoa_to_sheet(rows)

// Folds with "Monthly Sales" (case/space/underscore folding only).
XLSX.utils.book_append_sheet(
  wb,
  aoa([
    ['Section', 'Items', 'Monthly Sales'],
    ['Produce', 42, 125000],
    ['Dairy', 18, 86000],
    ['Bakery', 12, 41000],
    ['Frozen', 25, 67000],
  ]),
  'Anna Nagar',
)
XLSX.utils.book_append_sheet(
  wb,
  aoa([
    ['section', 'items', 'monthly_sales'],
    ['Produce', 38, 110500],
    ['Dairy', 21, 92000],
    ['Household', 30, 54000],
  ]),
  'T Nagar',
)
// "Sales" does NOT fold into "Monthly Sales" — the manual combine case.
XLSX.utils.book_append_sheet(
  wb,
  aoa([
    ['Section', 'Items', 'Sales'],
    ['Produce', 29, 78000],
    ['Bakery', 15, 36500],
    ['Frozen', 19, 49000],
  ]),
  'Velachery',
)
// Carries BOTH members of the combined pair — forces the first/join rule.
XLSX.utils.book_append_sheet(
  wb,
  aoa([
    ['Section', 'Items', 'Sales', 'Monthly Sales'],
    ['Produce', 33, 91000, ''],
    ['Dairy', 17, '', 58000],
    ['Bakery', 11, 30000, 31000],
  ]),
  'Adyar',
)
// A different shape entirely — should stay its own target (or unticked).
XLSX.utils.book_append_sheet(
  wb,
  aoa([
    ['Store', 'Total Sales'],
    ['Anna Nagar', 319000],
    ['T Nagar', 256500],
    ['Velachery', 163500],
    ['Adyar', 210000],
  ]),
  'Summary',
)
// Hidden sheet (plain hidden, not "very hidden").
XLSX.utils.book_append_sheet(
  wb,
  aoa([
    ['scratch', 'notes'],
    ['do not', 'import me'],
  ]),
  'Scratch',
)
wb.Workbook = { Sheets: wb.SheetNames.map((name) => ({ name, Hidden: name === 'Scratch' ? 1 : 0 })) }

XLSX.writeFile(wb, join(out, 'store-sections.xlsx'))
console.log('fixtures written to', out)
