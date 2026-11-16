// RPT-001: the report view over a Table's rows. Totals over every matching
// row are report-totals.test.tsx's; these are the rest of what the Playwright
// report-view spec walked through (#1080): reaching the report from the list,
// a small grouping in full, folding a group, and the column picker.
import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Rpv Task'
const WAIT = { timeout: 8000 }

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
      { column_name: 'stage', column_type: 'Choice', label: 'Status', choices: 'Open\nClosed', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
    ],
  })
  for (const [title, stage, qty] of [['alpha', 'Open', 1], ['bravo', 'Open', 2], ['charlie', 'Closed', 5]] as const)
    await admin.post('/api/save_row', { table: DT, row: { title, stage, qty } })
}

const group = (value: string) => {
  const header = screen.getAllByTestId('group-header').find((h) => h.dataset.group === value)
  if (!header) throw new Error(`no group ${value}`)
  return header
}

async function openReport(admin: Admin) {
  await renderApp(`/featherbase/admin/table/${tableSlug(DT)}/view/report`, admin)
  await screen.findByTestId('report-view', {}, WAIT)
  await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(3), WAIT)
}

test('RPT-001: the list\'s view menu opens the report, with every row and the grand total', async ({ admin }) => {
  await seed(admin)
  const { router } = await renderApp(`/featherbase/admin/table/${tableSlug(DT)}`, admin)
  await userEvent.click(await screen.findByRole('button', { name: 'View: List' }, WAIT))
  await userEvent.click(await screen.findByTestId('open-report'))
  await screen.findByTestId('report-view', {}, WAIT)
  expect((router.state as { location: { pathname: string } }).location.pathname).toBe(`/featherbase/admin/table/${tableSlug(DT)}/view/report`)
  await waitFor(() => expect(screen.getByTestId('report-total')).toHaveTextContent('3 rows'), WAIT)
  expect(screen.getAllByTestId('report-row')).toHaveLength(3)
  await waitFor(() => expect(screen.getByTestId('grand-sum-qty')).toHaveTextContent('8'))
})

test('RPT-001: grouping by a Choice gives each group its count and sum', async ({ admin }) => {
  await seed(admin)
  await openReport(admin)
  await userEvent.selectOptions(screen.getByTestId('report-groupby'), 'stage')
  await waitFor(() => expect(screen.getAllByTestId('group-header')).toHaveLength(2))
  await waitFor(() => expect(within(group('Closed')).getByTestId('group-count')).toHaveTextContent('(1)'))
  expect(within(group('Closed')).getByTestId('group-sum-qty')).toHaveTextContent('5')
  expect(within(group('Open')).getByTestId('group-count')).toHaveTextContent('(2)')
  expect(within(group('Open')).getByTestId('group-sum-qty')).toHaveTextContent('3')
})

test('RPT-001: clicking a group folds its rows away, and clicking again brings them back', async ({ admin }) => {
  await seed(admin)
  await openReport(admin)
  await userEvent.selectOptions(screen.getByTestId('report-groupby'), 'stage')
  await waitFor(() => expect(screen.getAllByTestId('group-header')).toHaveLength(2))
  await userEvent.click(group('Open'))
  await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(1))
  await userEvent.click(group('Open'))
  await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(3))
})

test('RPT-001: the column picker takes a column out of the report and puts it back', async ({ admin }) => {
  await seed(admin)
  await openReport(admin)
  expect(screen.getByTestId('report-head-qty')).toBeInTheDocument()
  await userEvent.click(screen.getByTestId('report-columns'))
  await userEvent.click(await screen.findByTestId('report-col-qty'))
  await waitFor(() => expect(screen.queryByTestId('report-head-qty')).not.toBeInTheDocument())
  await userEvent.click(screen.getByTestId('report-col-qty'))
  await waitFor(() => expect(screen.getByTestId('report-head-qty')).toBeInTheDocument())
})
