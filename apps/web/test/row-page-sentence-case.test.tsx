// #910 checklist 20: the row page's headings read in sentence case, never in
// capitals drawn by the stylesheet ("ACTIVITY", "TAGS").
import { tableSlug } from 'shared'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const TABLE = 'Sc Ticket'
type Admin = Parameters<typeof renderApp>[1]

async function openTab(admin: Admin, tab: string) {
  await admin.post('/api/table_def', { name: TABLE, columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  for (const property of ['enable_tags', 'enable_discussion', 'enable_assignments', 'enable_files'])
    await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: TABLE, property, value: 'true' } })
  const row = (await admin.post('/api/save_row', { table: TABLE, row: { title: 'Leaking roof' } })) as { row_id: string }
  await renderApp(`/featherbase/admin/table/${tableSlug(TABLE)}/row/${row.row_id}`, admin)
  await screen.findByTestId('form-view')
  await userEvent.click(await screen.findByRole('tab', { name: tab }))
}

const capitalised = () => [...document.querySelectorAll('.uppercase')].map((el) => el.textContent)

for (const tab of ['Activity', 'Collaboration'])
  test(`the ${tab} tab draws no heading in capitals`, async ({ admin }) => {
    await openTab(admin, tab)
    await screen.findByRole('tabpanel')
    await new Promise((r) => setTimeout(r, 300))
    expect(capitalised()).toEqual([])
  })
