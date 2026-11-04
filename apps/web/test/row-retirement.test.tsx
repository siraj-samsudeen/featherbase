// #859: retire a row without deleting it, with a reason. The form offers
// Retire and Reactivate, a refused delete offers Retire instead, and the list
// leaves retired rows out until asked.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'

const TABLE = 'Retire Bin'
const path = `/featherbase/admin/table/${encodeURIComponent(tableSlug(TABLE))}`
const api = `/api/table/${encodeURIComponent(TABLE)}`
const WAIT = { timeout: 15_000 }

type Admin = Parameters<typeof renderApp>[1]

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: TABLE, id_pattern: 'prompt', columns: [
    { column_name: 'city', column_type: 'Data', in_list_view: true },
  ] })
  await admin.post(api, { row_id: 'Riverside', city: 'Kochi' })
  await admin.post(api, { row_id: 'Sample plant', city: 'Nowhere' })
}

test('#859 retire from the form with a reason, then reactivate', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`${path}/row/${encodeURIComponent('Sample plant')}`, admin)
  await user.click(await screen.findByRole('button', { name: 'Record actions' }))
  await user.click(await screen.findByTestId('form-retire', {}, WAIT))
  const dialog = screen.getByTestId('retire-row-dialog')
  const confirm = within(dialog).getByTestId('retire-row-confirm')
  expect(confirm).toBeDisabled()
  await user.type(within(dialog).getByTestId('retire-reason'), 'Not a real location')
  expect(confirm).toBeEnabled()
  await user.click(confirm)

  expect((await screen.findByTestId('retired-reason', {}, WAIT)).textContent).toBe('Not a real location')
  expect(screen.getByTestId('retired-badge')).toBeInTheDocument()
  await waitFor(() => expect(screen.getAllByTestId('activity-retired-reason')[0].textContent).toBe('Reason: Not a real location'), WAIT)

  await user.click(screen.getByRole('button', { name: 'Record actions' }))
  await user.click(await screen.findByTestId('form-reactivate', {}, WAIT))
  await waitFor(() => expect(screen.queryByTestId('retired-notice')).toBeNull(), WAIT)
  const row = await admin.get<{ retired_at: unknown }>(`${api}/${encodeURIComponent('Sample plant')}`)
  expect(row.retired_at).toBeNull()
}, 40_000)

test('#859 a delete refused by history offers Retire instead', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await admin.post('/api/table/Comment', { ref_table: TABLE, ref_name: 'Sample plant', content: 'keep this' })
  await renderApp(`${path}/row/${encodeURIComponent('Sample plant')}`, admin)
  await user.click(await screen.findByRole('button', { name: 'Record actions' }))
  await user.click(await screen.findByTestId('form-delete', {}, WAIT))
  await user.click(within(screen.getByTestId('delete-row-dialog')).getByTestId('delete-row-confirm'))
  await screen.findByTestId('delete-row-error', {}, WAIT)
  await user.click(await screen.findByTestId('delete-row-retire-instead'))
  expect(screen.getByTestId('retire-row-dialog')).toBeInTheDocument()
}, 40_000)

test('#859 the list leaves retired rows out until asked, and marks them', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await admin.post(`${api}/${encodeURIComponent('Sample plant')}:retire`, { reason: 'Not a real location' })
  await renderApp(path, admin)
  await waitFor(() => expect(screen.getByTestId('list-rows').textContent).toContain('Riverside'), WAIT)
  expect(screen.getByTestId('list-rows').textContent).not.toContain('Sample plant')
  expect(screen.getByTestId('list-total').textContent).toContain('1 total')

  await user.click(screen.getByTestId('list-show-retired-toggle'))
  await waitFor(() => expect(screen.getByTestId('list-rows').textContent).toContain('Sample plant'), WAIT)
  expect(screen.getByTestId('list-total').textContent).toContain('2 total')
  expect(within(screen.getByTestId('list-rows')).getAllByTestId('retired-badge')).toHaveLength(1)
}, 40_000)
