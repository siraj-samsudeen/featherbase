import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { expectApiError, makeTable, tableRef } from './fixtures'
import { sql } from '../src/db'

// Spec 0007, BUD-J4 + BUD-R12 (M3): import-as-proposal — a whole overwrite
// file diffed against a governed table into draft Budget Changes. Titles
// quote spec IDs; the `> evidence:` verdicts in
// docs/specs/0007-budget-books.md join to them (tools/check-evidence.mjs).
// The browser tier of J4 is apps/web/e2e/budget-import-ui.spec.ts.

const LINE = 'Bp Line'
const BOOK = 'Bp 2026'
const lineRef = tableRef(LINE)
const bookRef = tableRef('Budget Book')
const changeRef = tableRef('Budget Change')
const IMPORT = `${lineRef.url}:import`
const PROPOSAL = `${lineRef.url}:import_proposal`

type Row = Record<string, unknown>

interface ProposalResult {
  dry_run?: boolean
  book: string
  matched_rows: number
  changed_cells: number
  new_rows: number
  unchanged_rows: number
  discontinued_rows: number
  ignored_columns: string[]
  changes: { row_id?: string; change_type: string; lines: number | Row[] }[]
}

async function setup(admin: TestClient) {
  await makeTable(admin, {
    name: LINE,
    columns: [
      'store',
      'subcategory',
      'owner',
      'notes',
      'q1:Currency',
      'q2:Currency',
      'q3:Currency',
      'q4:Currency',
    ],
  })
  const rows: Record<string, Row> = {}
  for (const [key, doc] of Object.entries({
    aBev: { store: 'Adyar', subcategory: 'Beverages', owner: 'priya', q1: 100, q2: 100, q3: 100, q4: 100 },
    aSnk: { store: 'Adyar', subcategory: 'Snacks', owner: 'priya', q1: 10, q2: 20, q3: 30, q4: 40 },
    bBev: { store: 'Besant Nagar', subcategory: 'Beverages', owner: 'arun', q1: 200, q2: 200, q3: 200, q4: 200 },
  }))
    rows[key] = await admin.post<Row>(lineRef.url, doc)
  await admin.post('/api/save_row', {
    table: 'Budget Book',
    row: {
      row_id: BOOK,
      ref_table: LINE,
      fiscal_year: '2026',
      owner_column: 'owner',
      key_columns: [{ column_name: 'store' }, { column_name: 'subcategory' }],
      measure_columns: [
        { column_name: 'q1', period_label: 'Q1' },
        { column_name: 'q2', period_label: 'Q2' },
        { column_name: 'q3', period_label: 'Q3' },
        { column_name: 'q4', period_label: 'Q4' },
      ],
    },
  })
  await sql`update workflow set is_active = false where ref_table = 'Budget Change'`
  await admin.post(`${bookRef.rowUrl(BOOK)}:baseline`, {})
  return rows
}

async function propose(admin: TestClient, body: Row): Promise<ProposalResult> {
  return admin.post<ProposalResult>(PROPOSAL, { reason: 'August reforecast', ...body })
}

async function submitAll(admin: TestClient, res: ProposalResult) {
  for (const c of res.changes)
    await admin.post(`${changeRef.rowUrl(String(c.row_id))}:submit`, {})
}

async function getRow(admin: TestClient, name: string): Promise<Row> {
  return admin.get<Row>(lineRef.rowUrl(name))
}

describe('BUD-J4: the August reforecast — a file becomes proposals', () => {
  test('BUD-J4: plain :import on a governed table fails its rows pointing at :import_proposal (step J4.1)', async ({
    admin,
  }) => {
    const rows = await setup(admin)
    const res = await admin.post<{ updated: number; inserted: number; failed: { message: string }[] }>(
      IMPORT,
      {
        key_column: 'row_id',
        rows: [{ row_id: String(rows.aBev.row_id), q2: 80 }],
      },
    )
    expect(res.updated).toBe(0)
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0].message).toContain(BOOK)
    expect(res.failed[0].message).toContain('import_proposal')
  })

  test('BUD-J4: a partial file becomes a revise draft, and approval makes the table match the file where it spoke (steps J4.3, J4.5)', async ({
    admin,
  }) => {
    const rows = await setup(admin)
    // The file speaks about aBev (q2 changes, q1 equal) and aSnk (all equal);
    // bBev is absent. Silence everywhere else.
    const res = await propose(admin, {
      rows: [
        { store: 'Adyar', subcategory: 'Beverages', q1: 100, q2: 80 },
        { store: 'Adyar', subcategory: 'Snacks', q1: 10, q2: 20, q3: 30, q4: 40 },
      ],
    })
    expect(res.book).toBe(BOOK)
    expect(res.matched_rows).toBe(2)
    expect(res.changed_cells).toBe(1)
    expect(res.unchanged_rows).toBe(1)
    expect(res.new_rows).toBe(0)
    expect(res.discontinued_rows).toBe(0)
    expect(res.changes).toHaveLength(1)
    expect(res.changes[0].change_type).toBe('revise')

    // Nothing applied at import time (J4.3): the draft is a draft.
    expect(Number((await getRow(admin, String(rows.aBev.row_id))).q2)).toBe(100)
    const draft = await admin.get<Row>(
      changeRef.rowUrl(String(res.changes[0].row_id)),
    )
    expect(draft.status).toBe('draft')
    expect(Number(draft.total_delta)).toBe(-20)

    await submitAll(admin, res)
    const after = await getRow(admin, String(rows.aBev.row_id))
    expect(Number(after.q2)).toBe(80)
    expect(Number(after.q1)).toBe(100) // equal cell untouched
    expect(Number((await getRow(admin, String(rows.bBev.row_id))).q2)).toBe(200) // silent row untouched
  })

  test('BUD-R12: an absent measure cell is silence, not zero', async ({ admin }) => {
    const rows = await setup(admin)
    const res = await propose(admin, {
      rows: [{ store: 'Adyar', subcategory: 'Snacks', q4: 45 }],
    })
    expect(res.changed_cells).toBe(1)
    await submitAll(admin, res)
    const after = await getRow(admin, String(rows.aSnk.row_id))
    expect(Number(after.q1)).toBe(10)
    expect(Number(after.q2)).toBe(20)
    expect(Number(after.q3)).toBe(30)
    expect(Number(after.q4)).toBe(45)
  })

  test('BUD-R12: unmatched file rows become a new_line draft; a mixed file splits by change_type', async ({
    admin,
  }) => {
    await setup(admin)
    const res = await propose(admin, {
      rows: [
        { store: 'Adyar', subcategory: 'Beverages', q2: 80 },
        { store: 'Velachery', subcategory: 'Beverages', owner: 'meena', q1: 50, q2: 60 },
      ],
    })
    expect(res.new_rows).toBe(1)
    expect(res.changes.map((c) => c.change_type).sort()).toEqual(['new_line', 'revise'])
    await submitAll(admin, res)
    const [born] = await sql`
      select * from ${sql('bp_line')} where store = 'Velachery' and subcategory = 'Beverages'`
    expect(Number(born.q1)).toBe(50)
    expect(Number(born.q2)).toBe(60)
    expect(Number(born.q3 ?? 0)).toBe(0) // absent measures born at 0 (R7)
  })

  test('BUD-R12: rows absent from the file are untouched by default (missing_rows: keep)', async ({
    admin,
  }) => {
    const rows = await setup(admin)
    const res = await propose(admin, {
      rows: [{ store: 'Adyar', subcategory: 'Beverages', q2: 80 }],
    })
    expect(res.discontinued_rows).toBe(0)
    await submitAll(admin, res)
    const untouched = await getRow(admin, String(rows.bBev.row_id))
    expect(Number(untouched.q3)).toBe(200)
    expect(untouched.budget_discontinued).not.toBe(true)
  })

  test("BUD-R12: missing_rows: 'discontinue' drafts a discontinue for absent rows; already-discontinued rows are skipped", async ({
    admin,
  }) => {
    const rows = await setup(admin)
    const res = await propose(admin, {
      rows: [
        { store: 'Adyar', subcategory: 'Beverages', q2: 80 },
        { store: 'Adyar', subcategory: 'Snacks', q1: 10 },
      ],
      missing_rows: 'discontinue',
      effective_from: 'q3',
    })
    expect(res.discontinued_rows).toBe(1)
    await submitAll(admin, res)
    const bBev = await getRow(admin, String(rows.bBev.row_id))
    expect(Number(bBev.q2)).toBe(200) // before effective_from stands (R8)
    expect(Number(bBev.q3)).toBe(0)
    expect(Number(bBev.q4)).toBe(0)
    expect(bBev.budget_discontinued).toBe(true)

    // The same file again: the wound-down row is skipped, not re-zeroed.
    const again = await propose(admin, {
      rows: [
        { store: 'Adyar', subcategory: 'Beverages', q2: 80 },
        { store: 'Adyar', subcategory: 'Snacks', q1: 10 },
      ],
      missing_rows: 'discontinue',
      effective_from: 'q3',
    })
    expect(again.discontinued_rows).toBe(0)
    expect(again.changes.map((c) => c.change_type)).not.toContain('discontinue')
  })

  test('BUD-J4: dry_run reports the identical diff and writes nothing (step J4.2)', async ({
    admin,
  }) => {
    await setup(admin)
    const file = {
      rows: [
        { store: 'Adyar', subcategory: 'Beverages', q2: 80 },
        { store: 'Velachery', subcategory: 'Juices', q1: 50 },
      ],
    }
    const rehearsal = await propose(admin, { ...file, dry_run: true })
    expect(rehearsal.dry_run).toBe(true)
    expect(rehearsal.changed_cells).toBe(1)
    expect(rehearsal.new_rows).toBe(1)
    const [{ count }] = await sql`
      select count(*)::int as count from budget_change where book = ${BOOK}`
    expect(count).toBe(0)
    const real = await propose(admin, file)
    expect(real.changed_cells).toBe(rehearsal.changed_cells)
    expect(real.new_rows).toBe(rehearsal.new_rows)
  })

  test('BUD-R12: undeclared file columns are ignored and named, never written', async ({
    admin,
  }) => {
    const rows = await setup(admin)
    const res = await propose(admin, {
      rows: [{ store: 'Adyar', subcategory: 'Beverages', q2: 80, notes: 'from finance', owner: 'meena' }],
    })
    expect(res.ignored_columns).toEqual(['notes', 'owner'])
    await submitAll(admin, res)
    const after = await getRow(admin, String(rows.aBev.row_id))
    expect(after.notes ?? null).toBeNull()
    expect(after.owner).toBe('priya')
  })

  test('BUD-R12: the run refuses whole — missing key cell, duplicate key, non-numeric measure, empty reason', async ({
    admin,
  }) => {
    await setup(admin)
    const cases: [Row, RegExp][] = [
      [{ rows: [{ store: 'Adyar', q2: 80 }] }, /missing key column/],
      [
        {
          rows: [
            { store: 'Adyar', subcategory: 'Beverages', q2: 80 },
            { store: 'Adyar', subcategory: 'Beverages', q3: 90 },
          ],
        },
        /one voice per row/,
      ],
      [{ rows: [{ store: 'Adyar', subcategory: 'Beverages', q2: 'eighty' }] }, /not a number/],
      [{ rows: [{ store: 'Adyar', subcategory: 'Beverages', q2: 80 }], reason: '  ' }, /reason is required/],
      [
        { rows: [{ store: 'Adyar', subcategory: 'Beverages', q2: 80 }], effective_from: 'q3' },
        /applies only with missing_rows/,
      ],
    ]
    for (const [body, msg] of cases) {
      await expectApiError(propose(admin, body), { status: 417, message: expect.stringMatching(msg) })
    }
    const [{ count }] = await sql`
      select count(*)::int as count from budget_change where book = ${BOOK}`
    expect(count).toBe(0)
  })

  test('BUD-R12: without an active book the call is refused pointing at plain :import', async ({
    admin,
  }) => {
    await admin.post('/api/table_def', {
      name: LINE,
      columns: [
        { column_name: 'store', column_type: 'Data' },
        { column_name: 'q1', column_type: 'Currency' },
      ],
    })
    await expectApiError(propose(admin, { rows: [{ store: 'Adyar', q1: 10 }] }), { status: 417, message: expect.stringMatching(/not governed by an active Budget Book/) })
  })

  test('BUD-R12: a diff wider than MAX_CHANGE_LINES chunks into several drafts, one row never split', async ({
    admin,
  }) => {
    await setup(admin)
    // 51 brand-new rows × 4 measures = 204 new_line lines → 200 + 4.
    const file = Array.from({ length: 51 }, (_, i) => ({
      store: `Store ${String(i).padStart(2, '0')}`,
      subcategory: 'Bulk',
      q1: 1,
      q2: 2,
      q3: 3,
      q4: 4,
    }))
    const res = await propose(admin, { rows: file })
    expect(res.new_rows).toBe(51)
    const newLineDrafts = res.changes.filter((c) => c.change_type === 'new_line')
    expect(newLineDrafts).toHaveLength(2)
    expect(newLineDrafts.map((c) => c.lines)).toEqual([200, 4])
  })
})
