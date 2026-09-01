// Spec 0007 M4 (BUD-R14/R15/R16) at the component tier. Everything here is
// what layer 2 is for (docs/TESTING.md § The three layers): the row form's
// wording branches on *server* state (the book's mode, read back from
// /api/budget/line), the scope composer is form logic, and the assertion
// that matters is what got SENT — a scope decision must leave as one line
// carrying the scope the person built, and the model row must not move.
// Nothing here needs a real browser, so nothing here is an e2e spec.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from 'server/src/db'

const MODEL = 'Dec Model'
const BOOK = 'Dec 2026'
const PLAIN_MODEL = 'Dec Plain Model'
const PLAIN_BOOK = 'Dec Plain 2026'
const T = encodeURIComponent

interface Row {
  row_id: string
  [k: string]: unknown
}

interface ChangeLine {
  target_kind?: string
  line_ref?: string | null
  scope?: unknown
  measure_column?: string
  basis?: string
  proposed_value?: unknown
}

async function makeModel(admin: TestClient, name: string): Promise<Record<string, Row>> {
  await admin.post('/api/table_def', {
    name,
    columns: [
      { column_name: 'region', column_type: 'Data' },
      { column_name: 'store', column_type: 'Data' },
      { column_name: 'forecast', column_type: 'Currency' },
      { column_name: 'target', column_type: 'Currency' },
    ],
  })
  const rows: Record<string, Row> = {}
  for (const [key, doc] of Object.entries({
    kl1: { region: 'Kerala', store: '1501', forecast: 400000, target: 400000 },
    kl2: { region: 'Kerala', store: '1502', forecast: 300000, target: 300000 },
    tn1: { region: 'Tamil Nadu', store: '2201', forecast: 500000, target: 500000 },
  }))
    rows[key] = await admin.post<Row>(`/api/table/${T(name)}`, doc)
  return rows
}

async function makeBook(
  admin: TestClient,
  { name, model, mode }: { name: string; model: string; mode: string },
) {
  await admin.post('/api/save_row', {
    table: 'Budget Book',
    row: {
      row_id: name,
      ref_table: model,
      fiscal_year: '2026',
      mode,
      model_version: mode === 'append_decisions' ? 'run-47' : null,
      key_columns: [{ column_name: 'region' }, { column_name: 'store' }],
      measure_columns: [
        { column_name: 'forecast', period_label: 'Forecast' },
        { column_name: 'target', period_label: 'Target' },
      ],
    },
  })
  // BUD-R11: a Workflow on Budget Change would own the gate and refuse the
  // plain :submit these tests approve with. The demo app installs one, so
  // stand any down inside this test's own transaction.
  await sql`update workflow set is_active = false where ref_table = 'Budget Change'`
  await admin.post(`/api/table/${T('Budget Book')}/${T(name)}:baseline`, {})
}

/** An append-mode book over a three-row model, already active. */
async function appendBook(admin: TestClient): Promise<Record<string, Row>> {
  const rows = await makeModel(admin, MODEL)
  await makeBook(admin, { name: BOOK, model: MODEL, mode: 'append_decisions' })
  return rows
}

async function mutateBook(admin: TestClient): Promise<Record<string, Row>> {
  const rows = await makeModel(admin, PLAIN_MODEL)
  await makeBook(admin, { name: PLAIN_BOOK, model: PLAIN_MODEL, mode: 'mutate_rows' })
  return rows
}

/** Draft a decision straight through the API, then approve it. */
async function appendDecision(admin: TestClient, line: ChangeLine, reason: string) {
  const draft = await admin.post<Row>(`/api/table/${T('Budget Change')}`, {
    book: BOOK,
    change_type: 'revise',
    reason,
    lines: [line],
  })
  await admin.post(`/api/table/${T('Budget Change')}/${T(String(draft.row_id))}:submit`, {})
  return String(draft.row_id)
}

const linesOf = async (admin: TestClient, change: string) =>
  (await admin.get<{ lines?: ChangeLine[] }>(`/api/table/${T('Budget Change')}/${T(change)}`))
    .lines ?? []

const draftsOf = async (admin: TestClient, book: string) =>
  (
    await admin.get<{ data: Row[] }>(
      `/api/table/${T('Budget Change')}?filters=${T(JSON.stringify([['book', '=', book]]))}` +
        `&fields=${T(JSON.stringify(['row_id', 'status']))}`,
    )
  ).data

test('BUD-R14: an append-mode row says Decisions, counts them, and never offers to change the row', async ({
  admin,
}) => {
  const rows = await appendBook(admin)
  await renderApp(`/admin/${T(MODEL)}/${T(rows.kl1.row_id)}`, admin)

  const pill = await screen.findByTestId('budget-governed-pill')
  expect(pill).toHaveTextContent(`Decisions · ${BOOK}`)
  // "Governed" and "Propose change" both promise the model row will move.
  // In this mode it never does, so neither word may appear.
  expect(pill.textContent).not.toContain('Governed')
  expect(screen.queryByTestId('budget-propose')).not.toBeInTheDocument()
  expect(screen.getByTestId('budget-decisions-badge')).toHaveTextContent('0 decisions on this row')
  expect(screen.getByTestId('budget-readonly-note')).toHaveTextContent(
    'approving writes a decision beside it, never into it',
  )
  const propose = screen.getByTestId('budget-propose-decision')
  expect(propose).toHaveTextContent('Propose decision')
  expect(propose.getAttribute('href')).toContain('/admin/budget-decisions')
})

test('BUD-R14: a mutate_rows row keeps the M2 wording — Governed, and Propose change', async ({
  admin,
}) => {
  const rows = await mutateBook(admin)
  await renderApp(`/admin/${T(PLAIN_MODEL)}/${T(rows.kl1.row_id)}`, admin)

  const pill = await screen.findByTestId('budget-governed-pill')
  expect(pill).toHaveTextContent(`Governed · ${PLAIN_BOOK}`)
  expect(screen.getByTestId('budget-propose')).toHaveTextContent('Propose change')
  expect(screen.queryByTestId('budget-propose-decision')).not.toBeInTheDocument()
  expect(screen.queryByTestId('budget-decisions-badge')).not.toBeInTheDocument()
  expect(screen.queryByTestId('budget-readonly-note')).not.toBeInTheDocument()
})

test('BUD-R14: the row badge counts the decisions already appended to that row, and the row still reads its model value', async ({
  admin,
}) => {
  const rows = await appendBook(admin)
  const ref = String(rows.kl1.row_id)
  for (const value of [550000, 480000])
    await appendDecision(
      admin,
      { target_kind: 'row', line_ref: ref, measure_column: 'target', proposed_value: value },
      `push to ${value}`,
    )
  // A Kerala scope decision reaches this store in the application's reading,
  // and must NOT be counted here: counting it would mean the engine expanded
  // the scope, which BUD-R15 forbids.
  await appendDecision(
    admin,
    { target_kind: 'scope', scope: { region: 'Kerala' }, measure_column: 'target', basis: 'delta', proposed_value: 1 },
    'Kerala push',
  )

  // An unapproved draft is still only a proposal: it counts as pending, not
  // as a decision, because nothing has been appended yet.
  await admin.post(`/api/table/${T('Budget Change')}`, {
    book: BOOK,
    change_type: 'revise',
    reason: 'still thinking',
    lines: [{ target_kind: 'row', line_ref: ref, measure_column: 'forecast', proposed_value: 1 }],
  })

  await renderApp(`/admin/${T(MODEL)}/${T(ref)}`, admin)
  expect(await screen.findByTestId('budget-decisions-badge')).toHaveTextContent(
    '2 decisions on this row',
  )
  expect(screen.getByTestId('budget-pending-badge')).toHaveTextContent('1 pending')
  const live = await admin.get<Row>(`/api/table/${T(MODEL)}/${T(ref)}`)
  expect(Number(live.target)).toBe(400000)
})

test('BUD-R15: a scope decision names each dimension or says All, and leaves as one line', async ({
  admin,
}) => {
  await appendBook(admin)
  await renderApp(`/admin/budget-decisions?book=${T(BOOK)}`, admin)

  await screen.findByTestId('budget-decision-composer')
  // With no row in hand the only target is a scope, and the form says why.
  expect(screen.getByTestId('budget-decision-target')).toHaveValue('scope')
  expect(screen.getByTestId('budget-decision-target-note')).toHaveTextContent(
    'Open a model row to decide about that one row',
  )
  // Every declared dimension gets a control, and both start open.
  expect(screen.getByTestId('budget-scope-summary')).toHaveTextContent(
    'region: all · store: all',
  )
  expect(screen.getByTestId('budget-scope-too-wide')).toBeInTheDocument()
  expect(screen.getByTestId('budget-decision-save')).toBeDisabled()

  await userEvent.selectOptions(screen.getByTestId('budget-scope-mode-region'), 'is')
  await userEvent.type(screen.getByTestId('budget-scope-value-region'), 'Kerala')
  // store stays All — and says so, rather than being an empty box.
  expect(screen.getByTestId('budget-scope-summary')).toHaveTextContent(
    'region: Kerala · store: all',
  )
  expect(screen.queryByTestId('budget-scope-too-wide')).not.toBeInTheDocument()

  await userEvent.selectOptions(screen.getByTestId('budget-decision-measure'), 'target')
  await userEvent.selectOptions(screen.getByTestId('budget-decision-basis'), 'delta')
  expect(screen.getByTestId('budget-basis-help')).toHaveTextContent(
    'this number is added to what the model says',
  )
  await userEvent.type(screen.getByTestId('budget-decision-value'), '10000')
  // The reason gates the draft: BUD-R4 requires one and so does this form.
  expect(screen.getByTestId('budget-decision-save')).toBeDisabled()
  await userEvent.type(screen.getByTestId('budget-decision-reason'), 'Kerala festival push')
  await userEvent.click(screen.getByTestId('budget-decision-save'))

  const result = await screen.findByTestId('budget-decision-result')
  const link = within(result).getByTestId('budget-decision-draft')
  const change = link.textContent!
  expect(link.getAttribute('href')).toBe(`/admin/${T('Budget Change')}/${T(change)}`)

  // One line, carrying the scope the person built — never expanded to the
  // two Kerala rows underneath.
  const lines = await linesOf(admin, change)
  expect(lines).toHaveLength(1)
  expect(lines[0].target_kind).toBe('scope')
  expect(lines[0].scope).toEqual({ region: 'Kerala' })
  expect(lines[0].line_ref == null || lines[0].line_ref === '').toBe(true)
  expect(lines[0].measure_column).toBe('target')
  expect(lines[0].basis).toBe('delta')
  expect(Number(lines[0].proposed_value)).toBe(10000)
  // Still a draft: this surface proposes, the existing lanes approve.
  expect((await draftsOf(admin, BOOK)).map((d) => d.status)).toEqual(['draft'])
})

test('BUD-R15: switching a named dimension back to All drops it from the scope that is sent', async ({
  admin,
}) => {
  await appendBook(admin)
  await renderApp(`/admin/budget-decisions?book=${T(BOOK)}`, admin)
  await screen.findByTestId('budget-decision-composer')

  for (const dim of ['region', 'store']) {
    await userEvent.selectOptions(screen.getByTestId(`budget-scope-mode-${dim}`), 'is')
    await userEvent.type(screen.getByTestId(`budget-scope-value-${dim}`), dim === 'region' ? 'Kerala' : '1501')
  }
  expect(screen.getByTestId('budget-scope-summary')).toHaveTextContent(
    'region: Kerala · store: 1501',
  )
  // Reopening the store dimension must forget the typed value entirely —
  // what the summary says is what the server is asked for.
  await userEvent.selectOptions(screen.getByTestId('budget-scope-mode-store'), 'all')
  expect(screen.getByTestId('budget-scope-summary')).toHaveTextContent('region: Kerala · store: all')

  await userEvent.type(screen.getByTestId('budget-decision-value'), '250')
  await userEvent.type(screen.getByTestId('budget-decision-reason'), 'region-wide')
  await userEvent.click(screen.getByTestId('budget-decision-save'))

  const change = (await screen.findByTestId('budget-decision-draft')).textContent!
  const lines = await linesOf(admin, change)
  expect(lines[0].scope).toEqual({ region: 'Kerala' })
})

test('BUD-R14: opened from a governed row the composer targets that row, defaults to Set, and sends line_ref', async ({
  admin,
}) => {
  const rows = await appendBook(admin)
  const ref = String(rows.kl1.row_id)
  await renderApp(`/admin/budget-decisions?book=${T(BOOK)}&line_ref=${T(ref)}`, admin)

  await screen.findByTestId('budget-decision-composer')
  expect(screen.getByTestId('budget-decision-target')).toHaveValue('row')
  // A row target has no scope to build, so the builder is not rendered.
  expect(screen.queryByTestId('budget-scope-builder')).not.toBeInTheDocument()
  expect(screen.getByTestId('budget-basis-help')).toHaveTextContent(
    'the measure becomes this number, whatever the model says',
  )

  await userEvent.selectOptions(screen.getByTestId('budget-decision-measure'), 'target')
  await userEvent.type(screen.getByTestId('budget-decision-value'), '550000')
  await userEvent.type(screen.getByTestId('budget-decision-reason'), 'store rebase')
  await userEvent.click(screen.getByTestId('budget-decision-save'))

  const change = (await screen.findByTestId('budget-decision-draft')).textContent!
  const lines = await linesOf(admin, change)
  expect(lines[0].target_kind).toBe('row')
  expect(lines[0].line_ref).toBe(ref)
  expect(lines[0].basis).toBe('set')
  expect(Number(lines[0].proposed_value)).toBe(550000)

  // Compose another clears the form back to an empty proposal.
  await userEvent.click(screen.getByTestId('budget-decision-again'))
  expect(await screen.findByTestId('budget-decision-value')).toHaveValue(null)
  expect(screen.getByTestId('budget-decision-save')).toBeDisabled()
})

test('BUD-R14: a refusal the form cannot pre-empt is shown, not swallowed, and drafts nothing', async ({
  admin,
}) => {
  const rows = await appendBook(admin)
  // The composer pre-empts what it can (a wide-open scope, a missing
  // reason). Everything else is the engine's to refuse, and the person must
  // see it: here, a decision aimed at a row that is not in the model.
  await renderApp(
    `/admin/budget-decisions?book=${T(BOOK)}&line_ref=${T(`${String(rows.kl1.row_id)}-gone`)}`,
    admin,
  )
  await screen.findByTestId('budget-decision-composer')
  await userEvent.type(screen.getByTestId('budget-decision-value'), '1')
  await userEvent.type(screen.getByTestId('budget-decision-reason'), 'typo target')
  await userEvent.click(screen.getByTestId('budget-decision-save'))

  expect(await screen.findByTestId('budget-decision-error')).toHaveTextContent(
    `does not exist in ${MODEL}`,
  )
  expect(await draftsOf(admin, BOOK)).toHaveLength(0)
})

test('BUD-R16: the ledger lists appended decisions newest first, with the scope in words', async ({
  admin,
}) => {
  const rows = await appendBook(admin)
  const ref = String(rows.kl1.row_id)
  const first = await appendDecision(
    admin,
    { target_kind: 'row', line_ref: ref, measure_column: 'target', proposed_value: 550000 },
    'store rebase',
  )
  const second = await appendDecision(
    admin,
    {
      target_kind: 'scope',
      scope: { region: 'Kerala' },
      measure_column: 'forecast',
      basis: 'delta',
      proposed_value: 10000,
    },
    'Kerala festival push',
  )

  await renderApp(`/admin/budget-decisions?book=${T(BOOK)}`, admin)
  const ledgerRows = await screen.findAllByTestId('budget-ledger-row')
  const ledger = screen.getByTestId('budget-ledger')
  expect(ledger).toHaveTextContent('Decision ledger · 2 recorded')
  expect(ledgerRows).toHaveLength(2)
  // Newest first — the standing judgment is what the reader came for, and
  // the superseded one stays readable underneath (BUD-R16).
  expect(ledgerRows[0]).toHaveTextContent('scope')
  // The scope reads as words, not as JSON: every declared dimension named,
  // the open one saying "all" out loud.
  expect(ledgerRows[0]).toHaveTextContent('region: Kerala · store: all')
  expect(ledgerRows[0].textContent).not.toContain('{')
  expect(ledgerRows[0]).toHaveTextContent('delta')
  expect(ledgerRows[0]).toHaveTextContent('10,000')
  expect(ledgerRows[0]).toHaveTextContent('run-47')
  expect(ledgerRows[0]).toHaveTextContent('Administrator')
  expect(ledgerRows[0]).toHaveTextContent(second)

  expect(ledgerRows[1]).toHaveTextContent(ref)
  expect(ledgerRows[1]).toHaveTextContent('550,000')
  expect(ledgerRows[1]).toHaveTextContent(first)
})

test('BUD-R16: a book with nothing appended says so rather than showing an empty grid', async ({
  admin,
}) => {
  await appendBook(admin)
  await renderApp(`/admin/budget-decisions?book=${T(BOOK)}`, admin)
  expect(await screen.findByTestId('budget-ledger-empty')).toHaveTextContent(
    'No decision has been appended to this book yet',
  )
  expect(screen.queryByTestId('budget-ledger-table')).not.toBeInTheDocument()
  expect(screen.getByTestId('budget-decide-anchor')).toHaveTextContent(
    `Model: ${MODEL} · version run-47`,
  )
})

test('BUD-R14: the desk lists only append-mode books, and picking one opens its composer', async ({
  admin,
}) => {
  await appendBook(admin)
  await mutateBook(admin)
  await renderApp('/admin/budget-decisions', admin)

  const picker = await screen.findByTestId('budget-decide-book')
  await waitFor(() => expect(picker.querySelectorAll('option')).toHaveLength(2))
  const options = [...picker.querySelectorAll('option')].map((o) => o.value)
  expect(options).toEqual(['', BOOK])
  // A mutate_rows book appends nothing; its road is the Budget Change form.
  expect(options).not.toContain(PLAIN_BOOK)
  expect(screen.queryByTestId('budget-decision-composer')).not.toBeInTheDocument()

  await userEvent.selectOptions(picker, BOOK)
  expect(await screen.findByTestId('budget-decision-composer')).toBeInTheDocument()
})

test('BUD-R14: an append book\u2019s form offers the decision desk', async ({ admin }) => {
  await appendBook(admin)
  await renderApp(`/admin/${T('Budget Book')}/${T(BOOK)}`, admin)

  const link = await screen.findByTestId('budget-decisions-link')
  expect(link).toHaveTextContent('Decisions')
  expect(link.getAttribute('href')).toContain('/admin/budget-decisions')
  // The M2 actions are untouched beside it.
  expect(screen.getByTestId('budget-lifecycle')).toHaveTextContent('active')
  expect(screen.getByTestId('budget-compare-link')).toHaveTextContent('Compare')
})

test('BUD-R14: a mutate_rows book\u2019s form has no decision desk to offer', async ({ admin }) => {
  await mutateBook(admin)
  await renderApp(`/admin/${T('Budget Book')}/${T(PLAIN_BOOK)}`, admin)

  expect(await screen.findByTestId('budget-lifecycle')).toHaveTextContent('active')
  expect(screen.queryByTestId('budget-decisions-link')).not.toBeInTheDocument()
})

test('BUD-R16: past one page the ledger reports the book’s real total, and the page it shows is the newest slice', async ({
  admin,
}) => {
  await appendBook(admin)
  // One approval, 55 scope decisions — deliberately more than the ledger's
  // 50-row page, and all appended in a single transaction so every one of
  // them carries the SAME `decided_at`. That is both halves of this test:
  // a count that must not come from the page in hand, and an order that
  // `decided_at` alone cannot settle.
  const lines = Array.from({ length: 55 }, (_, i) => ({
    target_kind: 'scope',
    scope: { store: `S${String(i).padStart(2, '0')}` },
    measure_column: 'target',
    proposed_value: 1000 + i,
  }))
  const draft = await admin.post<Row>(`/api/table/${T('Budget Change')}`, {
    book: BOOK,
    change_type: 'revise',
    reason: 'store-by-store rebase',
    lines,
  })
  await admin.post(`/api/table/${T('Budget Change')}/${T(String(draft.row_id))}:submit`, {})

  const appended = (
    await admin.get<{ data: Row[]; total: number }>(
      `/api/table/${T('Budget Decision')}?filters=${T(JSON.stringify([['book', '=', BOOK]]))}` +
        `&fields=${T(JSON.stringify(['row_id']))}&order_by=${T('row_id desc')}&limit_page_length=100`,
    )
  ).data.map((d) => String(d.row_id))
  expect(appended).toHaveLength(55)

  await renderApp(`/admin/budget-decisions?book=${T(BOOK)}`, admin)
  const ledgerRows = await screen.findAllByTestId('budget-ledger-row')
  expect(ledgerRows).toHaveLength(50)
  // The heading counts what the BOOK holds, not what this page happens to
  // carry, and says out loud that it is showing a slice.
  expect(screen.getByTestId('budget-ledger-count')).toHaveTextContent(
    'Decision ledger · 55 recorded · showing the latest 50',
  )
  // Newest first by append order, with no tie for the planner to break: the
  // slice is exactly the 50 newest decision ids, in descending order. The
  // ids are zero-padded for exactly this reason — unpadded, decision 9 of a
  // change would sort above decision 10 of the same change.
  const shown = ledgerRows.map((r) => r.textContent ?? '')
  expect(shown[0]).toContain(appended[0])
  expect(appended[0]).toMatch(/-055$/)
  expect(shown[49]).toContain(appended[49])
  // The five oldest fell off the page rather than being scattered through it.
  for (const old of appended.slice(50)) expect(shown.join('\n')).not.toContain(old)
})
