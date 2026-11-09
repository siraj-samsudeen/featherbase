// #859: retire a row without deleting it, with a reason. The form offers
// Retire and Reactivate, a refused delete offers Retire instead, and the list
// leaves retired rows out until asked.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { vi } from 'vitest'
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

test('#859 a System Manager deletes a row permanently, seeing what points at it first', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await admin.post('/api/table_def', { name: 'Retire Bin Order', columns: [
    { column_name: 'plant', column_type: 'Reference', reference_table: TABLE },
  ] })
  await admin.post('/api/table/Retire%20Bin%20Order', { plant: 'Sample plant' })
  await admin.post('/api/table/Comment', { ref_table: TABLE, ref_name: 'Sample plant', content: 'made by mistake' })
  await renderApp(`${path}/row/${encodeURIComponent('Sample plant')}`, admin)
  await user.click(await screen.findByRole('button', { name: 'Record actions' }))
  await user.click(await screen.findByTestId('form-purge', {}, WAIT))
  const dialog = await screen.findByTestId('purge-dialog')
  const group = await within(dialog).findByTestId('purge-group', {}, WAIT)
  expect(group.textContent).toContain('Retire Bin Order')
  expect(group.getAttribute('data-action')).toBe('delete')
  expect(within(dialog).getByTestId('purge-summary').textContent).toContain('1 comment')
  const confirm = within(dialog).getByTestId('purge-confirm')
  await user.type(within(dialog).getByTestId('purge-reason'), 'Created by mistake')
  expect(confirm).toBeDisabled()
  await user.click(within(dialog).getByTestId('purge-links-clear'))
  await waitFor(() => expect(within(dialog).getByTestId('purge-group').getAttribute('data-action')).toBe('clear'), WAIT)
  await user.type(within(dialog).getByTestId('purge-confirm-word'), 'DELETE')
  expect(confirm).toBeEnabled()
  await user.click(confirm)
  await screen.findByTestId('list-view', {}, WAIT)
  const gone = await admin.fetch(`${api}/${encodeURIComponent('Sample plant')}`)
  expect(gone.status).toBe(404)
  const orders = await admin.get<{ data: { plant: string | null }[] }>(`/api/table/Retire%20Bin%20Order?fields=${encodeURIComponent('["plant"]')}`)
  expect(orders.data).toEqual([{ plant: null }])
}, 40_000)

test('#859 Escape closes the Delete permanently dialog wherever it was opened, changing nothing', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`${path}/row/${encodeURIComponent('Sample plant')}`, admin)
  await user.click(await screen.findByRole('button', { name: 'Record actions' }))
  await user.click(await screen.findByTestId('form-purge', {}, WAIT))
  await screen.findByTestId('purge-dialog')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('purge-dialog')).toBeNull(), WAIT)
  expect((await admin.fetch(`${api}/${encodeURIComponent('Sample plant')}`)).status).toBe(200)
}, 40_000)

const SAMPLE = `${api}/${encodeURIComponent('Sample plant')}`

/** Opens Sample plant's form and one of its record actions. */
async function recordAction(admin: Admin, action: string) {
  const user = userEvent.setup()
  await renderApp(`${path}/row/${encodeURIComponent('Sample plant')}`, admin)
  await user.click(await screen.findByRole('button', { name: 'Record actions' }))
  await user.click(await screen.findByTestId(action, {}, WAIT))
  return user
}

test('#859 a delete refused by history also offers Delete permanently instead', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table/Comment', { ref_table: TABLE, ref_name: 'Sample plant', content: 'keep this' })
  const user = await recordAction(admin, 'form-delete')
  await user.click(within(screen.getByTestId('delete-row-dialog')).getByTestId('delete-row-confirm'))
  await user.click(await screen.findByTestId('delete-row-purge-instead', {}, WAIT))
  expect(screen.queryByTestId('delete-row-dialog')).not.toBeInTheDocument()
  expect(await screen.findByTestId('purge-dialog')).toBeInTheDocument()
}, 40_000)

test('#859 Reactivate on a row deleted meanwhile says why it failed', async ({ admin }) => {
  await seed(admin)
  await admin.post(`${SAMPLE}:retire`, { reason: 'Not a real location' })
  const user = userEvent.setup()
  await renderApp(`${path}/row/${encodeURIComponent('Sample plant')}`, admin)
  await screen.findByTestId('retired-badge', {}, WAIT)
  // Its history holds it against a plain delete; a System Manager removes it for good.
  await admin.post(`${api}:purge`, { ids: ['Sample plant'], links: 'clear', reason: 'Created by mistake', confirm: true })
  await user.click(screen.getByRole('button', { name: 'Record actions' }))
  await user.click(await screen.findByTestId('form-reactivate', {}, WAIT))
  expect(await screen.findByText(/not found/i, {}, WAIT)).toBeInTheDocument()
}, 40_000)

test('#859 Retire on a row deleted meanwhile says why, keeping the dialog open', async ({ admin }) => {
  await seed(admin)
  const user = await recordAction(admin, 'form-retire')
  const dialog = screen.getByTestId('retire-row-dialog')
  await user.type(within(dialog).getByTestId('retire-reason'), 'Not a real location')
  await admin.delete(SAMPLE)
  await user.click(within(dialog).getByTestId('retire-row-confirm'))
  expect(await within(dialog).findByText(/not found/i, {}, WAIT)).toBeInTheDocument()
  expect(within(dialog).getByTestId('retire-row-confirm')).toBeEnabled()
}, 40_000)

test('#859 a click outside the Retire dialog closes it, retiring nothing', async ({ admin }) => {
  await seed(admin)
  const user = await recordAction(admin, 'form-retire')
  await user.click(screen.getByTestId('retire-row-dialog').parentElement!)
  expect(screen.queryByTestId('retire-row-dialog')).not.toBeInTheDocument()
  expect((await admin.get<{ retired_at: unknown }>(SAMPLE)).retired_at).toBeNull()
}, 40_000)

test('#859 Delete permanently of a row deleted meanwhile says why, keeping the dialog open', async ({ admin }) => {
  await seed(admin)
  const user = await recordAction(admin, 'form-purge')
  const dialog = await screen.findByTestId('purge-dialog')
  await within(dialog).findByTestId('purge-summary', {}, WAIT)
  await user.type(within(dialog).getByTestId('purge-reason'), 'Created by mistake')
  await user.type(within(dialog).getByTestId('purge-confirm-word'), 'DELETE')
  await admin.delete(SAMPLE)
  await user.click(within(dialog).getByTestId('purge-confirm'))
  expect(await within(dialog).findByText(/not found/i, {}, WAIT)).toBeInTheDocument()
  expect(screen.getByTestId('purge-dialog')).toBeInTheDocument()
}, 40_000)

test('#859 a click outside Delete permanently closes it, deleting nothing', async ({ admin }) => {
  await seed(admin)
  const user = await recordAction(admin, 'form-purge')
  await user.click((await screen.findByTestId('purge-dialog')).parentElement!)
  expect(screen.queryByTestId('purge-dialog')).not.toBeInTheDocument()
  expect((await admin.fetch(SAMPLE)).status).toBe(200)
}, 40_000)

test('#859 Delete permanently can go back from clearing the links to deleting what points at the row', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', { name: 'Retire Bin Order', columns: [
    { column_name: 'plant', column_type: 'Reference', reference_table: TABLE },
  ] })
  await admin.post('/api/table/Retire%20Bin%20Order', { plant: 'Sample plant' })
  const user = await recordAction(admin, 'form-purge')
  const dialog = await screen.findByTestId('purge-dialog')
  await within(dialog).findByTestId('purge-group', {}, WAIT)
  await user.click(within(dialog).getByTestId('purge-links-clear'))
  await waitFor(() => expect(within(dialog).getByTestId('purge-group').getAttribute('data-action')).toBe('clear'), WAIT)
  await user.click(within(dialog).getByTestId('purge-links-cascade'))
  await waitFor(() => expect(within(dialog).getByTestId('purge-group').getAttribute('data-action')).toBe('delete'), WAIT)
}, 40_000)

/** Requests whose address ends with `suffix` are lost, as offline. */
function dropNetwork(suffix: string) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith(suffix)
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
}

test('#859 a retire the network drops says it failed and leaves the row active', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`${path}/row/${encodeURIComponent('Sample plant')}`, admin)
  await user.click(await screen.findByRole('button', { name: 'Record actions' }))
  await user.click(await screen.findByTestId('form-retire', {}, WAIT))
  const dialog = screen.getByTestId('retire-row-dialog')
  await user.type(within(dialog).getByTestId('retire-reason'), 'Not a real location')
  dropNetwork(':retire')
  await user.click(within(dialog).getByTestId('retire-row-confirm'))
  expect(await within(dialog).findByTestId('retire-row-error')).toHaveTextContent('Retire failed')
  expect(screen.queryByTestId('retired-badge')).not.toBeInTheDocument()
})

test('#859 a reactivation the network drops says it failed and leaves the row retired', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await admin.post(`${api}/${encodeURIComponent('Sample plant')}:retire`, { reason: 'closed' })
  await renderApp(`${path}/row/${encodeURIComponent('Sample plant')}`, admin)
  await screen.findByTestId('retired-badge', {}, WAIT)
  await user.click(await screen.findByRole('button', { name: 'Record actions' }))
  dropNetwork(':reactivate')
  await user.click(await screen.findByTestId('form-reactivate', {}, WAIT))
  expect(await screen.findByTestId('form-banner')).toHaveTextContent('Reactivate failed')
  expect(screen.getByTestId('retired-badge')).toBeInTheDocument()
})
