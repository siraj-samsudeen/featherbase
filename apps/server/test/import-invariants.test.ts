import { describe, expect, it } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { coerceRows, idPatternFor } from 'shared'

// The invariants layer — docs/design/requirements-framework.md, Part II:
// relationships that must hold across a whole import run, asserted as
// arithmetic. These re-execute the external review's *reported* findings.
//
// IMP-I1  rows in file = inserted + failed + dropped-blank, and every
//         failure names the TRUE spreadsheet row.
// IMP-I2  a chunked run reconciles: one log row per part, every part
//         present, and the parts' sums equal the run's totals. (The review
//         framed per-part logs as a defect; the log schema's part/parts
//         columns show they are design intent — the run-level single entry
//         is a presentation concern, not a storage invariant.)
// IMP-I3  rehearsal writes nothing: no rows, no log, no series ids burned.

const DT = 'Invariant Target'
const PATH = `/api/table/${encodeURIComponent(DT)}:import`
const COLUMNS = [
  { column_name: 'title', column_type: 'Data' },
  { column_name: 'qty', column_type: 'Int' },
]

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    id_pattern: idPatternFor(DT),
    columns: [
      { column_name: 'title', column_type: 'Data', reqd: true },
      { column_name: 'qty', column_type: 'Int' },
    ],
  })
}

// The wizard's whole pipeline in miniature: parsed sheet cells (spreadsheet
// rows 2..n; row 1 is the header) → coerceRows → POST :import. The wizard
// reports a failure via its excelRow helper: the row's SOURCE index
// (blanks included) + 2 (ImportWizard.tsx).
const SHEET: unknown[][] = [
  ['fine one', '1'], //      spreadsheet row 2
  ['', ''], //               spreadsheet row 3 — entirely blank
  ['fine two', '2'], //      spreadsheet row 4
  ['fine three', '3'], //    spreadsheet row 5
  ['breaks', 'abc'], //      spreadsheet row 6 — 'abc' cannot land in Int
  ['fine four', '4'], //     spreadsheet row 7
]

describe('IMP-I1: reconciliation across a run', () => {
  test('rows in the file = inserted + failed + dropped-blank', async ({ admin }) => {
    await setup(admin)
    const coerced = coerceRows(COLUMNS, SHEET)
    const dropped = SHEET.length - coerced.length
    expect(dropped).toBe(1) // exactly the blank row

    const res = await admin.post<{ inserted: number; failed: { index: number }[] }>(PATH, {
      rows: coerced.map((r) => r.values),
    })
    expect(res.inserted + res.failed.length + dropped).toBe(SHEET.length)
    expect(res.inserted).toBe(4)
    expect(res.failed).toHaveLength(1)
  })

  // #115 FIXED: coerceRows still drops blank rows, but each surviving row
  // carries its sourceIndex into the sheet's data rows — so the blank row
  // above the bad one can no longer shift the blame onto an innocent
  // neighbour. (This was the it.fails pin; flipped to a plain test in the
  // fixing change, per the pin's own instruction.)
  it('IMP-I1: a failure names the TRUE spreadsheet row (#115 fixed)', async () => {
    const coerced = coerceRows(COLUMNS, SHEET)
    // The bad row ('abc') sits at coerced position 3, but its sourceIndex
    // remembers the vanished blank above it.
    const bad = coerced.find((r) => r.values.qty === 'abc')!
    const displayed = bad.sourceIndex + 2 // the wizard's excelRow mapping
    expect(displayed).toBe(6) // its true spreadsheet row
  })
})

describe('IMP-I2: a chunked run reconciles', () => {
  test('one log row per part, all parts present, sums equal the totals', async ({ admin }) => {
    await setup(admin)
    // Simulate the wizard above IMPORT_CHUNK: 7 rows, chunk size 3 → 3 parts,
    // with the bad row landing in part 2.
    const rows = [
      { title: 'r1', qty: 1 },
      { title: 'r2', qty: 2 },
      { title: 'r3', qty: 3 },
      { title: 'r4', qty: 'abc' }, // fails
      { title: 'r5', qty: 5 },
      { title: 'r6', qty: 6 },
      { title: 'r7', qty: 7 },
    ]
    const CHUNK = 3
    const parts = Math.ceil(rows.length / CHUNK)
    let inserted = 0
    let failed = 0
    for (let at = 0; at < rows.length; at += CHUNK) {
      const res = await admin.post<{ inserted: number; failed: unknown[] }>(PATH, {
        rows: rows.slice(at, at + CHUNK),
        context: {
          file_name: 'big.xlsx',
          sheet_name: 'Sheet1',
          table_created: at === 0,
          part: Math.floor(at / CHUNK) + 1,
          parts,
        },
      })
      inserted += res.inserted
      failed += res.failed.length
    }

    const logs = await admin.get<{ data: { part: unknown; parts: unknown; inserted: unknown; failed: unknown }[] }>(
      `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
        '["part","parts","inserted","failed"]',
      )}&filters=${encodeURIComponent(JSON.stringify([['ref_table', '=', DT]]))}`,
    )
    // Exactly one row per part, every part number present exactly once.
    expect(logs.data).toHaveLength(parts)
    expect(logs.data.map((l) => Number(l.part)).sort()).toEqual([1, 2, 3])
    for (const l of logs.data) expect(Number(l.parts)).toBe(parts)
    // The parts' sums are the run's truth.
    const logInserted = logs.data.reduce((s, l) => s + Number(l.inserted), 0)
    const logFailed = logs.data.reduce((s, l) => s + Number(l.failed), 0)
    expect(logInserted).toBe(inserted)
    expect(logFailed).toBe(failed)
    expect(logInserted + logFailed).toBe(rows.length)
  })
})

describe('IMP-I3: rehearsal writes nothing', () => {
  test('no rows, no log entry, no series ids burned', async ({ admin }) => {
    await setup(admin)
    await admin.post(PATH, {
      dry_run: true,
      rows: [
        { title: 'ghost 1', qty: 1 },
        { title: 'ghost 2', qty: 2 },
        { title: 'ghost 3', qty: 3 },
      ],
    })
    const count = await admin.get<{ count: number }>(`/api/table/${encodeURIComponent(DT)}:count`)
    expect(count.count).toBe(0)
    const logs = await admin.get<{ data: unknown[] }>(
      `/api/table/${encodeURIComponent('Import Log')}?filters=${encodeURIComponent(
        JSON.stringify([['ref_table', '=', DT]]),
      )}`,
    )
    expect(logs.data).toHaveLength(0)

    // The rehearsal must not have advanced the series: the first real row
    // is the FIRST of its series, not the fourth.
    const real = await admin.post<{ inserted: number }>(PATH, {
      rows: [{ title: 'real', qty: 1 }],
    })
    expect(real.inserted).toBe(1)
    const list = await admin.get<{ data: { row_id: string }[] }>(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["row_id"]')}`,
    )
    expect(list.data).toHaveLength(1)
    expect(list.data[0].row_id).toMatch(/(^|\D)0*1$/)
  })
})
