// #1264 on a real row page: who made the row is a link to their Person record
// for a System Manager, in Activity and in the form's footer; a reader of the
// Table who may not read Person sees the same name as plain words.
import { screen, waitFor } from '@testing-library/react'
import { rowHref, tableSlug } from 'shared'
import { grantRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'

const T = 'Actor Links Desk'
type Client = Parameters<typeof renderApp>[1]
type CreateUser = (o: { email?: string; roles?: string[] }) => Promise<Client>
const WAIT = { timeout: 10_000 }

async function seed(admin: Client) {
  await admin.post('/api/table_def', { name: T, columns: [{ column_name: 'note', column_type: 'Data', label: 'Note', in_list_view: true }] })
  const row = await admin.post<{ row_id: string }>('/api/save_row', { table: T, row: { note: 'first' } })
  await grantRole(admin, { role: `${T} Reader`, table: T, can_read: true })
  return row.row_id
}
const page = (id: string) => `/featherbase/admin/table/${encodeURIComponent(tableSlug(T))}/row/${encodeURIComponent(id)}`

test('a System Manager reads who made the row as a link to their Person record', async ({ admin }) => {
  const id = await seed(admin)
  await renderApp(page(id), admin)
  // The links themselves, not role queries: those are slow on a full row page.
  const linkIn = (testid: string) => waitFor(() => {
    const link = screen.getByTestId(testid).querySelector<HTMLAnchorElement>('a[data-record-link="link"]')
    expect(link).not.toBeNull()
    return link!
  }, WAIT)
  const created = await linkIn('activity-created')
  expect(created).toHaveTextContent('Administrator')
  expect(created).toHaveAttribute('href', rowHref('Person', 'Administrator'))
  const footer = await linkIn('bookkeeping-line')
  expect(footer).toHaveTextContent('Administrator')
  expect(footer).toHaveAttribute('href', rowHref('Person', 'Administrator'))
})

test('a reader who may not read Person sees the same name, not a link', async ({ admin, createUser }) => {
  const id = await seed(admin)
  const reader = await (createUser as CreateUser)({ email: 'actor-reader@example.com', roles: [`${T} Reader`] })
  await renderApp(page(id), reader)
  const created = await screen.findByTestId('activity-created', {}, WAIT)
  await waitFor(() => expect(created).toHaveTextContent('Administrator'), WAIT)
  expect(created.querySelector('a')).toBeNull()
})

// #1264: a person in a list cell opens their record, not the row's panel.
test("clicking a person in a list cell doesn't also open the row in the panel", async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Actor Links Owners', columns: [
      { column_name: 'note', column_type: 'Data', in_list_view: true },
      { column_name: 'owner', column_type: 'Reference', reference_table: 'Person', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: 'Actor Links Owners', row: { note: 'first', owner: 'Administrator' } })
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug('Actor Links Owners'))}`, admin)
  const cell = await screen.findByTestId('cell-owner', {}, WAIT)
  const link = await waitFor(() => {
    const found = cell.querySelector<HTMLAnchorElement>('a[data-record-link="link"]')
    expect(found).not.toBeNull()
    return found!
  }, WAIT)
  // The link itself is followed by the browser; here only the row's own click must not fire.
  link.addEventListener('click', (e) => e.preventDefault())
  link.click()
  await new Promise((done) => setTimeout(done, 300))
  expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument()
})
