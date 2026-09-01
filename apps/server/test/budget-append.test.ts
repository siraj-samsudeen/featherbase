import { describe, expect } from 'vitest'
import { test, patchDoc } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { expectApiError, makeTable, tableRef } from './fixtures'
import { sql } from '../src/db'

// Spec 0007, BUD-R14/R15/R16 — append_decisions mode (owner decisions Q7,
// Q8, Q9 of 2026-09-01). The bound table is a read-only MODEL; approval
// appends immutable decisions beside it, a decision may address a scope
// rather than a row, and the ledger is append-only. Precedence and roll-up
// are deliberately NOT here — they are the application's.

const MODEL = 'Ap Model'
const BOOK = 'Ap 2026'
const modelRef = tableRef(MODEL)
const bookRef = tableRef('Budget Book')
const changeRef = tableRef('Budget Change')

type Row = Record<string, unknown>

async function setup(admin: TestClient, bookOverrides: Row = {}) {
  await makeTable(admin, {
    name: MODEL,
    columns: ['region', 'store', 'forecast:Currency', 'target:Currency'],
  })
  const rows: Record<string, Row> = {}
  for (const [key, doc] of Object.entries({
    kl1: { region: 'Kerala', store: '1501', forecast: 400000, target: 400000 },
    kl2: { region: 'Kerala', store: '1502', forecast: 300000, target: 300000 },
    tn1: { region: 'Tamil Nadu', store: '2201', forecast: 500000, target: 500000 },
  }))
    rows[key] = await admin.post<Row>(modelRef.url, doc)
  await admin.post('/api/save_row', {
    table: 'Budget Book',
    row: {
      row_id: BOOK,
      ref_table: MODEL,
      fiscal_year: '2026',
      mode: 'append_decisions',
      model_version: 'run-47',
      key_columns: [{ column_name: 'region' }, { column_name: 'store' }],
      measure_columns: [
        { column_name: 'forecast', period_label: 'Forecast' },
        { column_name: 'target', period_label: 'Target' },
      ],
      ...bookOverrides,
    },
  })
  await sql`update workflow set is_active = false where ref_table = 'Budget Change'`
  await admin.post(`${bookRef.rowUrl(BOOK)}:baseline`, {})
  return rows
}

async function decide(admin: TestClient, doc: Row): Promise<Row> {
  return admin.post<Row>(changeRef.url, { reason: 'append test', ...doc })
}

async function approve(admin: TestClient, name: string) {
  return admin.post(`${changeRef.rowUrl(name)}:submit`, {})
}

async function decisions(book = BOOK) {
  return sql`select * from budget_decision where book = ${book} order by row_id`
}

// JSON columns are stored as text (the same shape `new_line_key` has), so a
// scope reads back as its JSON image.
const scopeOf = (d: Row) => JSON.parse(String(d.scope)) as Record<string, unknown>

describe('BUD-R14: append mode leaves the model alone', () => {
  test('BUD-R14: approval appends a decision and the model row is untouched', async ({ admin }) => {
    const rows = await setup(admin)
    const ref = String(rows.kl1.row_id)
    const change = await decide(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [
        { target_kind: 'row', line_ref: ref, measure_column: 'target', proposed_value: 550000 },
      ],
    })
    await approve(admin, String(change.row_id))

    // The model still says what the engine said. That is the whole point.
    const model = await admin.get<Row>(modelRef.rowUrl(ref))
    expect(Number(model.target)).toBe(400000)

    const led = await decisions()
    expect(led).toHaveLength(1)
    expect(led[0].target_kind).toBe('row')
    expect(led[0].line_ref).toBe(ref)
    expect(led[0].measure).toBe('target')
    expect(Number(led[0].value)).toBe(550000)
    // Provenance and anchor: which approval, and against which model run.
    expect(led[0].change).toBe(String(change.row_id))
    expect(led[0].model_version).toBe('run-47')
    expect(led[0].decided_by).toBe('Administrator')
  })

  test('BUD-R14: two decisions on the same target both survive — mutate mode cannot express this', async ({
    admin,
  }) => {
    const rows = await setup(admin)
    const ref = String(rows.kl1.row_id)
    for (const value of [550000, 480000]) {
      const c = await decide(admin, {
        book: BOOK,
        change_type: 'revise',
        lines: [{ target_kind: 'row', line_ref: ref, measure_column: 'target', proposed_value: value }],
      })
      await approve(admin, String(c.row_id))
    }
    const led = await decisions()
    expect(led.map((d) => Number(d.value))).toEqual([550000, 480000])
    // Neither overwrote the other; which is in force is the application's
    // to derive, and the superseded one stays readable for grading.
    expect(Number((await admin.get<Row>(modelRef.rowUrl(ref))).target)).toBe(400000)
  })

  test('BUD-R14: a decision is a revision — transfer, new_line and discontinue are refused', async ({
    admin,
  }) => {
    const rows = await setup(admin)
    for (const change_type of ['transfer', 'new_line', 'discontinue']) {
      await expectApiError(
        decide(admin, {
          book: BOOK,
          change_type,
          effective_from: change_type === 'discontinue' ? 'target' : undefined,
          lines: [
            {
              target_kind: 'row',
              line_ref: rows.kl1.row_id,
              measure_column: 'target',
              proposed_value: 1,
            },
          ],
        }),
        { status: 417, type: 'ValidationError' },
      )
    }
  })
})

describe('BUD-R15: a decision may address a scope, and stays one decision', () => {
  test('BUD-R15: a Kerala-wide push is ONE stored decision, not one per leaf', async ({ admin }) => {
    await setup(admin)
    const change = await decide(admin, {
      book: BOOK,
      change_type: 'revise',
      reason: 'Kerala push',
      lines: [
        {
          target_kind: 'scope',
          scope: { region: 'Kerala' }, // store absent = every store in Kerala
          measure_column: 'target',
          basis: 'delta',
          proposed_value: 10000000,
        },
      ],
    })
    // The engine reads the push as its own number — never divided, never
    // repeated per leaf.
    expect(Number(change.total_delta)).toBe(10000000)
    await approve(admin, String(change.row_id))

    const led = await decisions()
    expect(led).toHaveLength(1)
    expect(led[0].target_kind).toBe('scope')
    expect(scopeOf(led[0])).toEqual({ region: 'Kerala' })
    expect(led[0].basis).toBe('delta')
    expect(Number(led[0].value)).toBe(10000000)
    expect(led[0].line_ref).toBeNull()
    // Both Kerala model rows are untouched: the engine never resolved the
    // scope to leaves, which is what keeps the roll-up honest.
    const all = await sql`select target from ${sql('ap_model')} order by store`
    expect(all.map((r) => Number(r.target))).toEqual([400000, 300000, 500000])
  })

  test('BUD-R15: a scope names declared key columns, and cannot be left wide open', async ({
    admin,
  }) => {
    await setup(admin)
    const line = (scope: unknown) => ({
      target_kind: 'scope',
      scope,
      measure_column: 'target',
      basis: 'delta',
      proposed_value: 1,
    })
    // A dimension the book never declared — the typo this catches.
    await expectApiError(
      decide(admin, { book: BOOK, change_type: 'revise', lines: [line({ regoin: 'Kerala' })] }),
      { status: 417, type: 'ValidationError' },
    )
    // Every dimension open addresses the whole book; say so deliberately.
    await expectApiError(
      decide(admin, { book: BOOK, change_type: 'revise', lines: [line({})] }),
      { status: 417, type: 'ValidationError' },
    )
    // A scope carries scope, not line_ref.
    await expectApiError(
      decide(admin, {
        book: BOOK,
        change_type: 'revise',
        lines: [{ ...line({ region: 'Kerala' }), line_ref: 'something' }],
      }),
      { status: 417, type: 'ValidationError' },
    )
  })

  test('BUD-R15: a null dimension is dropped, so one scope has one stored shape', async ({
    admin,
  }) => {
    await setup(admin)
    const change = await decide(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [
        {
          target_kind: 'scope',
          scope: { region: 'Kerala', store: null },
          measure_column: 'target',
          basis: 'delta',
          proposed_value: 5,
        },
      ],
    })
    await approve(admin, String(change.row_id))
    const led = await decisions()
    expect(scopeOf(led[0])).toEqual({ region: 'Kerala' })
  })
})

describe('BUD-R16: the ledger is append-only', () => {
  test('BUD-R16: a decision cannot be edited or deleted', async ({ admin }) => {
    const rows = await setup(admin)
    const change = await decide(admin, {
      book: BOOK,
      change_type: 'revise',
      lines: [
        {
          target_kind: 'row',
          line_ref: rows.kl1.row_id,
          measure_column: 'target',
          proposed_value: 550000,
        },
      ],
    })
    await approve(admin, String(change.row_id))
    const [d] = await decisions()
    const name = String(d.row_id)
    const decisionRef = tableRef('Budget Decision')

    const loaded = await admin.get<Row>(decisionRef.rowUrl(name))
    await expectApiError(
      patchDoc(admin, decisionRef.rowUrl(name), { updated_at: loaded.updated_at, value: 1 }),
      { status: 417, type: 'ValidationError' },
    )
    await expectApiError(admin.fetch(decisionRef.rowUrl(name), { method: 'DELETE' }), {
      status: 417,
      type: 'ValidationError',
    })
    const still = await admin.get<Row>(decisionRef.rowUrl(name))
    expect(Number(still.value)).toBe(550000)
  })
})
