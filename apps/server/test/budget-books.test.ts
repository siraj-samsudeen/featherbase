import { describe, expect } from 'vitest'
import { test, patchDoc } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { expectApiError, makeTable, tableRef } from './fixtures'
import { sql } from '../src/db'

// Spec 0007 (Budget Books) — the grain-agnostic budget engine: binding,
// lifecycle, the write-lock, and every change_type through approval.
// Titles quote spec IDs; the `> evidence:` verdicts in
// docs/specs/0007-budget-books.md join to them, checked by
// tools/check-evidence.mjs. The import-as-proposal tier (BUD-J4/R12) lives
// in ./budget-import.test.ts; the sample-app lanes in ./budget-demo.test.ts.

const LINE = 'Bb Line'
const BOOK = 'Bb 2026'
const lineRef = tableRef(LINE)
const bookRef = tableRef('Budget Book')
const changeRef = tableRef('Budget Change')

async function makeLineTable(admin: TestClient) {
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
}

type Row = Record<string, unknown>

async function makeRows(admin: TestClient): Promise<Record<string, Row>> {
  const rows: Record<string, Row> = {}
  for (const [key, doc] of Object.entries({
    aBev: { store: 'Adyar', subcategory: 'Beverages', owner: 'priya', q1: 100, q2: 100, q3: 100, q4: 100 },
    aSnk: { store: 'Adyar', subcategory: 'Snacks', owner: 'priya', q1: 10, q2: 20, q3: 30, q4: 40 },
    bBev: { store: 'Besant Nagar', subcategory: 'Beverages', owner: 'arun', q1: 200, q2: 200, q3: 200, q4: 200 },
  }))
    rows[key] = await admin.post<Row>(lineRef.url, doc)
  return rows
}

const BOOK_DOC = {
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
}

async function makeBook(admin: TestClient, doc: Row = {}): Promise<Row> {
  return admin.post<Row>('/api/save_row', { table: 'Budget Book', row: { ...BOOK_DOC, ...doc } })
}

async function baseline(admin: TestClient, name = BOOK): Promise<Row> {
  return admin.post<Row>(`${bookRef.rowUrl(name)}:baseline`, {})
}

async function setup(admin: TestClient) {
  await makeLineTable(admin)
  const rows = await makeRows(admin)
  await makeBook(admin)
  // The dev database may carry an installed demo app whose ACTIVE workflow
  // governs Budget Change — which (BUD-R11) would refuse this suite's
  // direct :submit calls. Neutralize inside the sandbox transaction.
  await sql`update workflow set is_active = false where ref_table = 'Budget Change'`
  return rows
}

async function activeSetup(admin: TestClient) {
  const rows = await setup(admin)
  await baseline(admin)
  return rows
}

async function makeChange(admin: TestClient, doc: Row): Promise<Row> {
  return admin.post<Row>(changeRef.url, { reason: 'test reason', ...doc })
}

async function submit(admin: TestClient, name: string): Promise<Row> {
  return admin.post<Row>(`${changeRef.rowUrl(name)}:submit`, {})
}

async function getRow(admin: TestClient, table: string, name: string): Promise<Row> {
  return admin.get<Row>(tableRef(table).rowUrl(name))
}

describe('BUD-R1: a book declares its binding', () => {
  test('BUD-R1: a conforming declaration saves as working', async ({ admin }) => {
    await makeLineTable(admin)
    const book = await makeBook(admin)
    expect(book.lifecycle).toBe('working')
  })

  test('BUD-R1: violations are refused naming the broken clause', async ({ admin }) => {
    await makeLineTable(admin)
    // measure must be numeric
    await expectApiError(makeBook(admin, { row_id: 'Bad 1', measure_columns: [{ column_name: 'store' }] }), { status: 417, type: 'ValidationError' })
    // key column must exist
    await expectApiError(makeBook(admin, { row_id: 'Bad 2', key_columns: [{ column_name: 'ghost' }] }), { status: 417, type: 'ValidationError' })
    // ref_table must exist
    await expectApiError(makeBook(admin, { row_id: 'Bad 3', ref_table: 'No Such Table' }), { status: 417, type: 'ValidationError' })
    // the engine cannot govern itself
    await expectApiError(makeBook(admin, { row_id: 'Bad 4', ref_table: 'Budget Change' }), { status: 417, type: 'ValidationError' })
    // at least one of each declaration
    await expectApiError(makeBook(admin, { row_id: 'Bad 5', key_columns: [] }), { status: 417, type: 'ValidationError' })
  })

  test('BUD-R1: at most one non-closed book per bound table', async ({ admin }) => {
    await makeLineTable(admin)
    await makeBook(admin)
    await expectApiError(makeBook(admin, { row_id: 'Second Book' }), { status: 417, type: 'ValidationError' })
  })
})

describe('BUD-R2: lifecycle working → active → closed', () => {
  test('BUD-R2/BUD-R10: baseline writes the whole book as v0 and activates', async ({ admin }) => {
    const rows = await setup(admin)
    const res = await baseline(admin)
    expect(res.lifecycle).toBe('active')
    expect(res.line_count).toBe(3)
    const [version] = await sql`
      select * from budget_version where book = ${BOOK}`
    expect(version.kind).toBe('baseline')
    expect(version.label).toBe('v0')
    const lines = await sql`
      select * from budget_version_line where version = ${String(version.row_id)} order by ref_name`
    expect(lines).toHaveLength(3)
    const aBev = lines.find((l) => l.ref_name === rows.aBev.row_id)!
    const data = aBev.data as Row
    // BUD-R10: every declared key, measure, and owner value — nothing else.
    expect(data).toEqual({
      store: 'Adyar',
      subcategory: 'Beverages',
      owner: 'priya',
      q1: 100,
      q2: 100,
      q3: 100,
      q4: 100,
    })
  })

  test('BUD-R2: baseline only from working, close only from active, no reopening', async ({
    admin,
  }) => {
    await setup(admin)
    await baseline(admin)
    await expectApiError(baseline(admin), { status: 417, type: 'ValidationError' })
    const closed = await admin.post<Row>(`${bookRef.rowUrl(BOOK)}:close`, {})
    expect(closed.lifecycle).toBe('closed')
    await expectApiError(admin.post(`${bookRef.rowUrl(BOOK)}:close`, {}), { status: 417, type: 'ValidationError' })
    await expectApiError(baseline(admin), { status: 417, type: 'ValidationError' })
  })

  test('BUD-R2: lifecycle never moves through a direct save', async ({ admin }) => {
    await setup(admin)
    const book = await getRow(admin, 'Budget Book', BOOK)
    // lifecycle is read_only: the save lifecycle drops the client value on
    // the floor (and the controller refuses any change that does get
    // through) — either way, the book must still be working afterwards.
    await patchDoc(admin, bookRef.rowUrl(BOOK), {
      updated_at: book.updated_at,
      lifecycle: 'active',
    }).catch(() => undefined)
    const after = await getRow(admin, 'Budget Book', BOOK)
    expect(after.lifecycle).toBe('working')
  })
})

describe('BUD-R3: an active book locks its table', () => {
  test('BUD-R3: working books impose nothing', async ({ admin }) => {
    const rows = await setup(admin)
    const updated = await patchDoc(admin, lineRef.rowUrl(String(rows.aBev.row_id)), {
      updated_at: rows.aBev.updated_at,
      q1: 999,
    })
    expect(Number(updated.q1)).toBe(999)
  })

  test('BUD-R3: declared columns, inserts, and deletes are refused; undeclared columns pass', async ({
    admin,
  }) => {
    const rows = await activeSetup(admin)
    const name = String(rows.aBev.row_id)
    const fresh = await getRow(admin, LINE, name)
    // measure
    await expectApiError(patchDoc(admin, lineRef.rowUrl(name), { updated_at: fresh.updated_at, q1: 1 }), { status: 417, type: 'ValidationError' })
    // key
    await expectApiError(patchDoc(admin, lineRef.rowUrl(name), {
        updated_at: fresh.updated_at,
        store: 'Elsewhere',
      }), { status: 417, type: 'ValidationError' })
    // owner
    await expectApiError(patchDoc(admin, lineRef.rowUrl(name), {
        updated_at: fresh.updated_at,
        owner: 'meena',
      }), { status: 417, type: 'ValidationError' })
    // undeclared column still edits
    const noted = await patchDoc(admin, lineRef.rowUrl(name), {
      updated_at: fresh.updated_at,
      notes: 'still editable',
    })
    expect(noted.notes).toBe('still editable')
    // insert
    await expectApiError(admin.post(lineRef.url, { store: 'New', subcategory: 'New', q1: 1 }), { status: 417, type: 'ValidationError' })
    // delete — a raw fetch, which expectApiError reads the envelope off
    // directly (no hand-rolled throw-on-not-ok wrapper needed).
    await expectApiError(admin.fetch(lineRef.rowUrl(name), { method: 'DELETE' }), {
      status: 417,
      type: 'ValidationError',
    })
    // the row survived, byte-identical on declared columns
    const after = await getRow(admin, LINE, name)
    expect(Number(after.q1)).toBe(100)
    expect(after.store).toBe('Adyar')
  })

  test('BUD-R3: renaming a governed row is refused (renameDoc runs no hooks)', async ({
    admin,
  }) => {
    const rows = await activeSetup(admin)
    const name = String(rows.aBev.row_id)
    // A rename would orphan every budget_version_line pointing at this row.
    await expectApiError(admin.post(`${lineRef.rowUrl(name)}:rename`, { new_name: 'sneaky-rename' }), { status: 417, type: 'ValidationError' })
    const still = await getRow(admin, LINE, name)
    expect(still.row_id).toBe(name)
  })

  test('BUD-R3: closing the book releases the lock on its table', async ({ admin }) => {
    const rows = await activeSetup(admin)
    await admin.post(`${bookRef.rowUrl(BOOK)}:close`, {})
    const fresh = await getRow(admin, LINE, String(rows.aBev.row_id))
    const updated = await patchDoc(admin, lineRef.rowUrl(String(rows.aBev.row_id)), {
      updated_at: fresh.updated_at,
      q1: 123,
    })
    expect(Number(updated.q1)).toBe(123)
  })
})

describe('BUD-R4: a change computes its own facts', () => {
  test('BUD-R4: current values snap, deltas and total_delta compute', async ({ admin }) => {
    const rows = await activeSetup(admin)
    const change = await makeChange(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [
        { line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 150 },
        { line_ref: rows.aBev.row_id, measure_column: 'q2', proposed_value: 80 },
      ],
    })
    const lines = change.lines as Row[]
    expect(Number(lines[0].current_value)).toBe(100)
    expect(Number(lines[0].delta)).toBe(50)
    expect(Number(lines[1].delta)).toBe(-20)
    expect(Number(change.total_delta)).toBe(30)
    expect(change.crosses_owner).toBe(false)
  })

  test('BUD-R4: crosses_owner is true exactly when referenced owners differ', async ({ admin }) => {
    const rows = await activeSetup(admin)
    const change = await makeChange(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [
        { line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 150 },
        { line_ref: rows.bBev.row_id, measure_column: 'q1', proposed_value: 150 },
      ],
    })
    expect(change.crosses_owner).toBe(true)
  })

  test('BUD-R4: a change must point at reality', async ({ admin }) => {
    const rows = await activeSetup(admin)
    // missing row
    await expectApiError(makeChange(admin, {
        book: BOOK,
        lines: [{ line_ref: 'no-such-row', measure_column: 'q1', proposed_value: 1 }],
      }), { status: 417, type: 'ValidationError' })
    // undeclared measure
    await expectApiError(makeChange(admin, {
        book: BOOK,
        lines: [{ line_ref: rows.aBev.row_id, measure_column: 'q9', proposed_value: 1 }],
      }), { status: 417, type: 'ValidationError' })
    // a proposal proposes a number
    await expectApiError(makeChange(admin, {
        book: BOOK,
        lines: [{ line_ref: rows.aBev.row_id, measure_column: 'q1' }],
      }), { status: 417, type: 'ValidationError' })
    // no lines at all
    await expectApiError(makeChange(admin, { book: BOOK, lines: [] }), { status: 417, type: 'ValidationError' })
  })

  test('BUD-R4: over_doa is computed from the book policy, direction-aware', async ({ admin }) => {
    await makeLineTable(admin)
    const rows = await makeRows(admin)
    // Escalates INCREASES over 100 — an even bigger decrease stays under DOA.
    await makeBook(admin, { doa_amount: 100, escalation_dir: 'increase' })
    await sql`update workflow set is_active = false where ref_table = 'Budget Change'`
    await baseline(admin)
    const up = await makeChange(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [{ line_ref: rows.bBev.row_id, measure_column: 'q1', proposed_value: 350 }],
    })
    expect(Number(up.total_delta)).toBe(150)
    expect(up.over_doa).toBe(true)
    const down = await makeChange(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [{ line_ref: rows.bBev.row_id, measure_column: 'q2', proposed_value: 20 }],
    })
    expect(Number(down.total_delta)).toBe(-180)
    expect(down.over_doa).toBe(false)
  })

  test('BUD-R4: a working book takes no changes (it is edited directly)', async ({ admin }) => {
    const rows = await setup(admin)
    await expectApiError(makeChange(admin, {
        book: BOOK,
        lines: [{ line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 1 }],
      }), { status: 417, type: 'ValidationError' })
  })
})

describe('BUD-R5: approval applies, atomically, through the front door', () => {
  test('BUD-R5: submit applies every line and records Version diffs', async ({ admin }) => {
    const rows = await activeSetup(admin)
    const change = await makeChange(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [
        { line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 150 },
        { line_ref: rows.aBev.row_id, measure_column: 'q2', proposed_value: 80 },
      ],
    })
    const submitted = await submit(admin, String(change.row_id))
    expect(submitted.status).toBe('submitted')
    const line = await getRow(admin, LINE, String(rows.aBev.row_id))
    expect(Number(line.q1)).toBe(150)
    expect(Number(line.q2)).toBe(80)
    expect(Number(line.q3)).toBe(100)
    // one Version entry diffing exactly the applied measures
    const versions = await sql`
      select data from version where ref_table = ${LINE} and ref_name = ${String(rows.aBev.row_id)}`
    expect(versions).toHaveLength(1)
    const changed = (versions[0].data as { changed: [string, unknown, unknown][] }).changed
    const cols = changed.map(([c]) => c).sort()
    expect(cols).toEqual(['q1', 'q2'])
  })

  test('BUD-R5/BUD-I2: a stale snapshot refuses the whole approval, applying nothing', async ({
    admin,
  }) => {
    const rows = await activeSetup(admin)
    const stale = await makeChange(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [
        { line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 111 },
        { line_ref: rows.bBev.row_id, measure_column: 'q1', proposed_value: 222 },
      ],
    })
    // Another change wins the race on aBev.q1 …
    const winner = await makeChange(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [{ line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 400 }],
    })
    await submit(admin, String(winner.row_id))
    // … so the stale one is refused whole-request.
    await expectApiError(submit(admin, String(stale.row_id)), { status: 409, type: 'ConflictError' })
    // Nothing applied, status untouched (BUD-I2).
    const untouched = await getRow(admin, LINE, String(rows.bBev.row_id))
    expect(Number(untouched.q1)).toBe(200)
    const changeAfter = await getRow(admin, 'Budget Change', String(stale.row_id))
    expect(changeAfter.status).toBe('draft')
  })

  test('BUD-H1/BUD-J3: a workflow transition into submitted applies the change too', async ({
    admin,
  }) => {
    const rows = await activeSetup(admin)
    await admin.post('/api/save_row', {
      table: 'Workflow',
      row: {
        row_id: 'Bb Fast Lane',
        ref_table: 'Budget Change',
        is_active: true,
        states: [
          { state: 'Draft', target_status: 'draft' },
          { state: 'Approved', target_status: 'submitted' },
        ],
        transitions: [
          { state: 'Draft', action: 'Self-Approve', next_state: 'Approved', allowed: 'All' },
        ],
      },
    })
    const change = await makeChange(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [{ line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 175 }],
    })
    await admin.post(`${changeRef.rowUrl(String(change.row_id))}:apply_workflow_action`, {
      action: 'Self-Approve',
    })
    // Applied exactly as a direct submit would have (BUD-R5's convergence).
    const line = await getRow(admin, LINE, String(rows.aBev.row_id))
    expect(Number(line.q1)).toBe(175)
    const after = await getRow(admin, 'Budget Change', String(change.row_id))
    expect(after.status).toBe('submitted')
    // The shortcut is on the record.
    const actions = await sql`
      select * from workflow_action where ref_table = 'Budget Change' and ref_name = ${String(change.row_id)}`
    expect(actions).toHaveLength(1)
    expect(actions[0].to_state).toBe('Approved')
  })

  test('BUD-R11: an attached workflow owns the gate — plain :submit is refused for everyone', async ({
    admin,
  }) => {
    const rows = await activeSetup(admin)
    await admin.post('/api/save_row', {
      table: 'Workflow',
      row: {
        row_id: 'Bb Gate Flow',
        ref_table: 'Budget Change',
        is_active: true,
        states: [
          { state: 'Draft', target_status: 'draft' },
          { state: 'Approved', target_status: 'submitted' },
        ],
        transitions: [{ state: 'Draft', action: 'Approve', next_state: 'Approved', allowed: 'All' }],
      },
    })
    const change = await makeChange(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [{ line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 175 }],
    })
    // Even as Administrator: the direct action names the workflow and refuses.
    await expectApiError(submit(admin, String(change.row_id)), { status: 417, type: 'ValidationError' })
    const line = await getRow(admin, LINE, String(rows.aBev.row_id))
    expect(Number(line.q1)).toBe(100)
  })
})

describe('BUD-R6: a transfer nets to zero', () => {
  test('BUD-R6: non-zero nets are refused, zero nets apply and preserve the grand total', async ({
    admin,
  }) => {
    const rows = await activeSetup(admin)
    await expectApiError(makeChange(admin, {
        book: BOOK,
        change_type: 'transfer',
        lines: [
          { line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 50 },
          { line_ref: rows.bBev.row_id, measure_column: 'q1', proposed_value: 230 },
        ],
      }), { status: 417, type: 'ValidationError' })
    // single-ended
    await expectApiError(makeChange(admin, {
        book: BOOK,
        change_type: 'transfer',
        lines: [{ line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 50 }],
      }), { status: 417, type: 'ValidationError' })
    const grandBefore = await sql`
      select sum(q1 + q2 + q3 + q4) as total from ${sql('bb_line')}`
    // −50 on aBev.q1, +30 bBev.q1, +20 aSnk.q2 — a three-way zero net
    const ok = await makeChange(admin, {
      book: BOOK,
      change_type: 'transfer',
      lines: [
        { line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 50 },
        { line_ref: rows.bBev.row_id, measure_column: 'q1', proposed_value: 230 },
        { line_ref: rows.aSnk.row_id, measure_column: 'q2', proposed_value: 40 },
      ],
    })
    expect(Number(ok.total_delta)).toBe(0)
    await submit(admin, String(ok.row_id))
    const grandAfter = await sql`
      select sum(q1 + q2 + q3 + q4) as total from ${sql('bb_line')}`
    expect(Number(grandAfter[0].total)).toBe(Number(grandBefore[0].total))
  })
})

describe('BUD-R7: a new line arrives complete and unique', () => {
  test('BUD-R7: half a key, a colliding key, and a duplicated cell are refused', async ({
    admin,
  }) => {
    await activeSetup(admin)
    await expectApiError(makeChange(admin, {
        book: BOOK,
        change_type: 'new_line',
        lines: [{ new_line_key: { store: 'Adyar' }, measure_column: 'q1', proposed_value: 10 }],
      }), { status: 417, type: 'ValidationError' })
    await expectApiError(makeChange(admin, {
        book: BOOK,
        change_type: 'new_line',
        lines: [
          {
            new_line_key: { store: 'Adyar', subcategory: 'Beverages' },
            measure_column: 'q1',
            proposed_value: 10,
          },
        ],
      }), { status: 417, type: 'ValidationError' })
    await expectApiError(makeChange(admin, {
        book: BOOK,
        change_type: 'new_line',
        lines: [
          {
            new_line_key: { store: 'Adyar', subcategory: 'Millet Snacks' },
            measure_column: 'q3',
            proposed_value: 10,
          },
          {
            new_line_key: { store: 'Adyar', subcategory: 'Millet Snacks' },
            measure_column: 'q3',
            proposed_value: 20,
          },
        ],
      }), { status: 417, type: 'ValidationError' })
  })

  test('BUD-R7: on approval the row is born with proposed measures, absent ones 0', async ({
    admin,
  }) => {
    await activeSetup(admin)
    const change = await makeChange(admin, {
      book: BOOK,
      change_type: 'new_line',
      lines: [
        {
          new_line_key: { store: 'Adyar', subcategory: 'Millet Snacks' },
          measure_column: 'q3',
          proposed_value: 60,
        },
        {
          new_line_key: { store: 'Adyar', subcategory: 'Millet Snacks' },
          measure_column: 'q4',
          proposed_value: 75,
        },
      ],
    })
    expect(Number(change.total_delta)).toBe(135)
    await submit(admin, String(change.row_id))
    const [born] = await sql`
      select * from ${sql('bb_line')} where store = 'Adyar' and subcategory = 'Millet Snacks'`
    expect(Number(born.q1)).toBe(0)
    expect(Number(born.q2)).toBe(0)
    expect(Number(born.q3)).toBe(60)
    expect(Number(born.q4)).toBe(75)
  })
})

describe('BUD-R8: discontinue zeroes forward, never deletes', () => {
  test('BUD-R8: forward periods zero, earlier ones stand, the flag sets — and a revise reinstates', async ({
    admin,
  }) => {
    const rows = await activeSetup(admin)
    const name = String(rows.aSnk.row_id)
    const change = await makeChange(admin, {
      book: BOOK,
      change_type: 'discontinue',
      effective_from: 'q3',
      lines: [{ line_ref: name }],
    })
    // snapped: q3+q4 = 30+40
    expect(Number(change.total_delta)).toBe(-70)
    await submit(admin, String(change.row_id))
    const line = await getRow(admin, LINE, name)
    expect(Number(line.q1)).toBe(10)
    expect(Number(line.q2)).toBe(20)
    expect(Number(line.q3)).toBe(0)
    expect(Number(line.q4)).toBe(0)
    expect(line.budget_discontinued).toBe(true)
    // reinstatement is a revise that clears the flag
    const revive = await makeChange(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [{ line_ref: name, measure_column: 'q4', proposed_value: 25 }],
    })
    await submit(admin, String(revive.row_id))
    const after = await getRow(admin, LINE, name)
    expect(Number(after.q4)).toBe(25)
    expect(after.budget_discontinued).toBe(false)
  })

  test('BUD-R8: a second discontinue on an already-discontinued line is refused', async ({
    admin,
  }) => {
    const rows = await activeSetup(admin)
    const name = String(rows.aSnk.row_id)
    const first = await makeChange(admin, {
      book: BOOK,
      change_type: 'discontinue',
      effective_from: 'q3',
      lines: [{ line_ref: name }],
    })
    await submit(admin, String(first.row_id))
    // The earlier periods are the wind-down yardstick — re-zeroing them via
    // a second discontinue is refused at draft time.
    await expectApiError(makeChange(admin, {
        book: BOOK,
        change_type: 'discontinue',
        effective_from: 'q1',
        lines: [{ line_ref: name }],
      }), { status: 417, type: 'ValidationError' })
    const line = await getRow(admin, LINE, name)
    expect(Number(line.q1)).toBe(10)
    expect(Number(line.q2)).toBe(20)
  })

  test('BUD-R8: effective_from must be a declared measure, and only on discontinue', async ({
    admin,
  }) => {
    const rows = await activeSetup(admin)
    await expectApiError(makeChange(admin, {
        book: BOOK,
        change_type: 'discontinue',
        effective_from: 'q9',
        lines: [{ line_ref: rows.aSnk.row_id }],
      }), { status: 417, type: 'ValidationError' })
    await expectApiError(makeChange(admin, {
        book: BOOK,
        change_type: 'revise',
        effective_from: 'q3',
        lines: [{ line_ref: rows.aSnk.row_id, measure_column: 'q1', proposed_value: 5 }],
      }), { status: 417, type: 'ValidationError' })
  })
})

describe('BUD-R9: applied changes are history', () => {
  test('BUD-R9: cancel is refused; the road back is a new change', async ({ admin }) => {
    const rows = await activeSetup(admin)
    const change = await makeChange(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [{ line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 150 }],
    })
    await submit(admin, String(change.row_id))
    await expectApiError(admin.post(`${changeRef.rowUrl(String(change.row_id))}:cancel`, {}), { status: 417, type: 'ValidationError' })
    const after = await getRow(admin, 'Budget Change', String(change.row_id))
    expect(after.status).toBe('submitted')
  })
})

describe('BUD-I1: the ledger reconciles', () => {
  test('BUD-I1: for every row, current Σmeasures = v0 Σmeasures + Σ applied deltas', async ({
    admin,
  }) => {
    const rows = await activeSetup(admin)
    // a spread of applied changes: revise, transfer, new_line, discontinue
    for (const doc of [
      {
        book: BOOK,
        change_type: 'revise',
        lines: [{ line_ref: rows.aBev.row_id, measure_column: 'q1', proposed_value: 150 }],
      },
      {
        book: BOOK,
        change_type: 'transfer',
        lines: [
          { line_ref: rows.aBev.row_id, measure_column: 'q2', proposed_value: 60 },
          { line_ref: rows.bBev.row_id, measure_column: 'q2', proposed_value: 240 },
        ],
      },
      {
        book: BOOK,
        change_type: 'new_line',
        lines: [
          {
            new_line_key: { store: 'Velachery', subcategory: 'Beverages' },
            measure_column: 'q1',
            proposed_value: 500,
          },
        ],
      },
      {
        book: BOOK,
        change_type: 'discontinue',
        effective_from: 'q4',
        lines: [{ line_ref: rows.aSnk.row_id }],
      },
    ] as Row[]) {
      const change = await makeChange(admin, doc)
      await submit(admin, String(change.row_id))
    }

    // v0 totals per ref_name
    const [version] = await sql`select row_id from budget_version where book = ${BOOK}`
    const v0 = await sql`
      select ref_name, data from budget_version_line where version = ${String(version.row_id)}`
    const v0Total = new Map<string, number>()
    for (const l of v0) {
      const d = l.data as Record<string, unknown>
      v0Total.set(
        String(l.ref_name),
        ['q1', 'q2', 'q3', 'q4'].reduce((s, c) => s + Number(d[c] ?? 0), 0),
      )
    }
    // applied deltas per line_ref (new_line deltas reconcile the born rows)
    const applied = await sql`
      select l.line_ref, l.new_line_key, l.delta
      from budget_change_line l
      join budget_change c on c.row_id = l.parent
      where c.book = ${BOOK} and c.status = 'submitted'`
    const deltaByRef = new Map<string, number>()
    let bornDelta = 0
    for (const l of applied) {
      if (l.line_ref) {
        const k = String(l.line_ref)
        deltaByRef.set(k, (deltaByRef.get(k) ?? 0) + Number(l.delta))
      } else bornDelta += Number(l.delta)
    }
    // live totals
    const live = await sql`
      select row_id, store, subcategory, q1 + q2 + q3 + q4 as total from ${sql('bb_line')}`
    for (const row of live) {
      const name = String(row.row_id)
      if (v0Total.has(name)) {
        expect(Number(row.total)).toBe(v0Total.get(name)! + (deltaByRef.get(name) ?? 0))
      } else {
        // born after baseline: reconciles from 0 at its birth change
        expect(Number(row.total)).toBe(bornDelta)
      }
    }
  })
})
