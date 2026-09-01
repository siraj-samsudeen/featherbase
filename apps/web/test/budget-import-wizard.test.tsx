// Spec 0007 BUD-J4/BUD-R12 at the component tier: when the Import wizard's
// target Table is governed by an active Budget Book, the sheet's import flow
// is replaced by the proposal flow. What belongs here rather than in e2e is
// exactly what layer 2 is for (docs/TESTING.md § The three layers): the
// governed branch renders from *server* state (a Budget Book query), the
// reason gate is form logic, and the interesting assertion is what got sent
// and what did NOT — the bound table must be untouched while drafts exist.
// The browser tier keeps only the real file drop
// (apps/web/e2e/budget-import-ui.spec.ts).

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const LINE = 'Wiz Bgt Line'
const BOOK = 'Wiz Bgt 2026'
const T = encodeURIComponent

interface Row {
  row_id: string
  [k: string]: unknown
}

/** A governed line table: two rows, an active book over store+subcategory. */
async function governedTable(admin: TestClient): Promise<Record<string, Row>> {
  await admin.post('/api/table_def', {
    name: LINE,
    columns: [
      { column_name: 'store', column_type: 'Data' },
      { column_name: 'subcategory', column_type: 'Data' },
      { column_name: 'q1', column_type: 'Currency' },
      { column_name: 'q2', column_type: 'Currency' },
    ],
  })
  const rows: Record<string, Row> = {}
  rows.bev = await admin.post<Row>(`/api/table/${T(LINE)}`, {
    store: 'Adyar',
    subcategory: 'Beverages',
    q1: 100,
    q2: 100,
  })
  rows.snk = await admin.post<Row>(`/api/table/${T(LINE)}`, {
    store: 'Adyar',
    subcategory: 'Snacks',
    q1: 50,
    q2: 50,
  })
  await admin.post('/api/save_row', {
    table: 'Budget Book',
    row: {
      row_id: BOOK,
      ref_table: LINE,
      fiscal_year: '2026',
      key_columns: [{ column_name: 'store' }, { column_name: 'subcategory' }],
      measure_columns: [
        { column_name: 'q1', period_label: 'Q1' },
        { column_name: 'q2', period_label: 'Q2' },
      ],
    },
  })
  await admin.post(`/api/table/${T('Budget Book')}/${T(BOOK)}:baseline`, {})
  return rows
}

// jsdom's File does not implement Blob.arrayBuffer(), which parseWorkbook
// calls; the gap is the environment's, not the product's, so the test fills
// it here rather than reshaping the code under test.
function augustFile(body: string): File {
  const file = new File([body], 'august-update.csv', { type: 'text/csv' })
  if (typeof file.arrayBuffer !== 'function')
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(body).buffer,
    })
  return file
}

/** Drop a file on the wizard opened against the governed Table. */
async function openWizardWith(admin: TestClient, csv: string) {
  await renderApp(`/admin/import?table=${T(LINE)}`, admin)
  const input = await screen.findByTestId('iw-file-input')
  await userEvent.upload(input, augustFile(csv))
  // The panel appears only once the Budget Book query resolves, so every
  // caller waits for it rather than racing the governed branch.
  return screen.findByTestId('iw-gov-reason-0')
}

const AUGUST = 'store,subcategory,q1,q2\nAdyar,Beverages,100,80\nVelachery,Juices,40,40\n'

test('BUD-J4: a governed target replaces the import controls with the proposal panel', async ({
  admin,
}) => {
  await governedTable(admin)
  await openWizardWith(admin, AUGUST)

  // The banner names the governing book …
  const banner = await screen.findByTestId('iw-gov-banner-0')
  expect(banner).toHaveTextContent(BOOK)
  // … and the plain-import path is gone: no match key, no Import button.
  expect(screen.queryByTestId('iw-key-0')).not.toBeInTheDocument()
  expect(screen.queryByTestId('iw-import')).not.toBeInTheDocument()
  expect(screen.queryByTestId('iw-check')).not.toBeInTheDocument()
  // The mapping grid stays — it is what translates headers to columns.
  expect(screen.getByTestId('iw-mapping-0')).toBeInTheDocument()
})

test('BUD-R12: the reason gates both buttons, and Preview reports the diff without writing', async ({
  admin,
}) => {
  const rows = await governedTable(admin)
  await openWizardWith(admin, AUGUST)

  const preview = await screen.findByTestId('iw-gov-preview-0')
  const create = screen.getByTestId('iw-gov-create-0')
  expect(preview).toBeDisabled()
  expect(create).toBeDisabled()

  await userEvent.type(screen.getByTestId('iw-gov-reason-0'), 'August reforecast')
  expect(preview).toBeEnabled()
  expect(create).toBeEnabled()

  await userEvent.click(preview)
  const report = await screen.findByTestId('iw-gov-preview-result-0')
  expect(report).toHaveTextContent('1 changed cell')
  expect(report).toHaveTextContent('1 new row')
  // The row the file never mentions is absent, not "unchanged": only a
  // matched row whose declared measures all agree counts as unchanged.
  expect(report).toHaveTextContent('0 unchanged')

  // A rehearsal writes nothing: no drafts, and the bound row still reads 100.
  const drafts = await admin.get<{ data: unknown[] }>(
    `/api/table/${T('Budget Change')}?filters=${T(JSON.stringify([['book', '=', BOOK]]))}`,
  )
  expect(drafts.data).toHaveLength(0)
  const live = await admin.get<Row>(`/api/table/${T(LINE)}/${T(rows.bev.row_id)}`)
  expect(Number(live.q2)).toBe(100)
})

test('BUD-R12: Create drafts the changes and links them, leaving the bound table untouched', async ({
  admin,
}) => {
  const rows = await governedTable(admin)
  await openWizardWith(admin, AUGUST)

  await userEvent.type(screen.getByTestId('iw-gov-reason-0'), 'August reforecast')
  await userEvent.click(await screen.findByTestId('iw-gov-create-0'))

  const result = await screen.findByTestId('iw-gov-result-0')
  expect(result).toHaveTextContent('Created 2 draft Budget Changes')
  // One link per draft, each addressing the Budget Change form.
  const links = within(result).getAllByRole('link')
  expect(links).toHaveLength(2)
  for (const a of links)
    expect(a.getAttribute('href')).toMatch(/^\/admin\/Budget%20Change\/BCR-/)

  // The drafts exist and are drafts; the bound row is untouched until one is
  // approved — the whole point of import-as-proposal.
  const drafts = await admin.get<{ data: { status: string; change_type: string }[] }>(
    `/api/table/${T('Budget Change')}?filters=${T(JSON.stringify([['book', '=', BOOK]]))}` +
      `&fields=${T(JSON.stringify(['row_id', 'status', 'change_type']))}`,
  )
  expect(drafts.data.map((d) => d.status)).toEqual(['draft', 'draft'])
  expect(drafts.data.map((d) => d.change_type).sort()).toEqual(['new_line', 'revise'])
  const live = await admin.get<Row>(`/api/table/${T(LINE)}/${T(rows.bev.row_id)}`)
  expect(Number(live.q2)).toBe(100)
})

test('BUD-R12: discontinue-missing is opt-in, and offers only the book’s measures', async ({
  admin,
}) => {
  await governedTable(admin)
  // This file omits Adyar/Snacks entirely.
  await openWizardWith(admin, 'store,subcategory,q1,q2\nAdyar,Beverages,100,80\n')

  await userEvent.type(screen.getByTestId('iw-gov-reason-0'), 'August reforecast')
  // Off by default: the effective-from picker is not even rendered.
  expect(screen.queryByTestId('iw-gov-effective-0')).not.toBeInTheDocument()
  await userEvent.click(await screen.findByTestId('iw-gov-preview-0'))
  await waitFor(() =>
    expect(screen.getByTestId('iw-gov-preview-result-0')).toHaveTextContent('0 discontinued'),
  )

  // Opting in reveals the measure picker — the book's own measures, in order.
  await userEvent.click(screen.getByTestId('iw-gov-missing-0'))
  const from = await screen.findByTestId('iw-gov-effective-0')
  expect([...from.querySelectorAll('option')].map((o) => o.value)).toEqual(['q1', 'q2'])

  await userEvent.selectOptions(from, 'q2')
  await userEvent.click(screen.getByTestId('iw-gov-preview-0'))
  await waitFor(() =>
    expect(screen.getByTestId('iw-gov-preview-result-0')).toHaveTextContent('1 discontinued'),
  )
})

test('BUD-R12: an ungoverned target keeps the ordinary import controls', async ({ admin }) => {
  // Same file, a Table with no Budget Book: the wizard must not change shape.
  await admin.post('/api/table_def', {
    name: 'Wiz Plain Line',
    columns: [
      { column_name: 'store', column_type: 'Data' },
      { column_name: 'subcategory', column_type: 'Data' },
      { column_name: 'q1', column_type: 'Currency' },
      { column_name: 'q2', column_type: 'Currency' },
    ],
  })
  await renderApp(`/admin/import?table=${T('Wiz Plain Line')}`, admin)
  const input = await screen.findByTestId('iw-file-input')
  await userEvent.upload(input, augustFile(AUGUST))

  expect(await screen.findByTestId('iw-key-0')).toBeInTheDocument()
  expect(screen.getByTestId('iw-import')).toBeInTheDocument()
  expect(screen.queryByTestId('iw-gov-banner-0')).not.toBeInTheDocument()
  expect(screen.queryByTestId('iw-gov-panel-0')).not.toBeInTheDocument()
})
