// #151: the Table builder's cards view — label, friendly type chips, the
// type-specific detail inside the card, the Required / Show-in-list toggles,
// the one-click fix for a reserved name, and add / remove. table-builder.test
// drives the grid view; the merged web coverage report (ADR 0012) showed the
// cards view taken by no test. Every journey ends in the stored Table.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Meta = { columns: { column_name: string; column_type: string; reqd?: boolean; in_list_view?: boolean; choices?: string; reference_table?: string }[] }

test('a table built from cards stores what the cards said', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Cc Region', columns: [{ column_name: 'label', column_type: 'Data' }] })
  await renderApp('/featherbase/admin/new-table', admin)
  await screen.findByTestId('table-builder')
  await user.type(screen.getByTestId('dt-name'), 'Cc Depot')
  await user.click(screen.getByTestId('dt-view-cards'))
  expect(screen.getByTestId('dt-view-cards')).toHaveAttribute('aria-pressed', 'true')

  // Card 1: "Status" is a built-in name; the card offers the prefixed one.
  const first = screen.getByTestId('dt-card-0')
  await user.type(within(first).getByPlaceholderText('e.g. Date of Birth'), 'Status')
  expect(within(first).getByText('“status” is a built-in column every table gets')).toBeInTheDocument()
  await user.click(within(first).getByRole('button', { name: 'Use “cc_depot_status”' }))
  expect(within(first).getByText('stored as cc_depot_status')).toBeInTheDocument()
  // A list of options, required, shown in the list.
  await user.click(within(first).getByRole('button', { name: 'Pick from a list' }))
  expect(within(first).getByRole('button', { name: 'Pick from a list' })).toHaveAttribute('aria-pressed', 'true')
  await user.type(within(first).getByPlaceholderText('Small, Medium, Large'), 'Open, Closed')
  await user.click(within(first).getByRole('checkbox', { name: 'Required' }))
  await user.click(within(first).getByRole('checkbox', { name: 'Show in the list' }))

  // Card 2: a link to another table, chosen from the tables that exist.
  await user.click(screen.getByTestId('dt-card-add'))
  const second = await screen.findByTestId('dt-card-1')
  await user.type(within(second).getByPlaceholderText('e.g. Date of Birth'), 'Region')
  await user.click(within(second).getByRole('button', { name: 'Link to another table' }))
  await within(second).findByRole('option', { name: 'Cc Region' })
  await user.selectOptions(within(second).getByRole('combobox'), 'Cc Region')

  // Card 3 is added and taken away again.
  await user.click(screen.getByTestId('dt-card-add'))
  const third = await screen.findByTestId('dt-card-2')
  await user.click(within(third).getByRole('button', { name: 'Remove column' }))
  await waitFor(() => expect(screen.queryByTestId('dt-card-2')).not.toBeInTheDocument())

  await user.click(screen.getByTestId('dt-create'))
  await screen.findByTestId('list-view', undefined, { timeout: 10_000 })
  const meta = (await admin.get(`/api/table/${encodeURIComponent('Cc Depot')}:meta`)) as Meta
  expect(meta.columns.map((c) => c.column_name)).toEqual(['cc_depot_status', 'region'])
  const [status, region] = meta.columns
  expect(status).toMatchObject({ column_type: 'Choice', reqd: true, in_list_view: true })
  expect(status.choices?.split('\n')).toEqual(['Open', 'Closed'])
  expect(region).toMatchObject({ column_type: 'Reference', reference_table: 'Cc Region' })
})

test('a type the cards do not offer still shows on its card, and its missing target is called out until the type changes', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/new-table', admin)
  await screen.findByTestId('table-builder')
  // In the grid, pick a type the cards have no chip for, and claim a raw name.
  const row = document.querySelector('[data-columnrow]') as HTMLElement
  await user.selectOptions(row.querySelector('[data-rowfield="column_type"]') as HTMLSelectElement, 'Sub-table')
  await user.click(screen.getByTestId('dt-view-cards'))
  const card = screen.getByTestId('dt-card-0')
  expect(within(card).getByText('Sub-table')).toBeInTheDocument()
  expect(within(card).queryAllByRole('button', { pressed: true })).toHaveLength(0)

  // The stored name follows the label; Sub-table without a target is flagged.
  const label = within(card).getByPlaceholderText('e.g. Date of Birth')
  await user.type(label, 'Lines')
  expect(within(card).getByText('Name the table this points at')).toBeInTheDocument()
  await user.click(within(card).getByRole('button', { name: 'Text' }))
  expect(within(card).getByText('stored as lines')).toBeInTheDocument()
})
