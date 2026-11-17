// #1259: a list in three views, switched by three buttons beside its title,
// remembered per person per Table. A queue opens on cards; a saved view keeps
// the view it was saved in. Every test that switches waits for the settings
// PUT to land (list-settings.test.tsx): a write that outlives the test's
// transaction would commit for real.
import { tableSlug } from 'shared'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const DT = 'Lv Desk'
const QUEUE = 'Lv Requests'
type Admin = Parameters<typeof renderApp>[1]

async function seed(admin: Admin, name = DT, queue = false) {
  await admin.post('/api/table_def', {
    name, ...(queue ? { queue: true } : {}),
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true }],
  })
  await admin.post('/api/save_row', { table: name, row: { title: 'Anitha' } })
}

async function openList(as: Admin, name = DT, query = '') {
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(name))}${query}`, as)
  await screen.findByTestId('list-view')
  await waitFor(() => expect(within(screen.getByTestId('list-rows')).getByText('Anitha')).toBeInTheDocument())
}

const view = () => within(screen.getByTestId('layout-switch'))
const pressed = () => within(screen.getByTestId('layout-switch')).getAllByRole('button')
  .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'))

test('three buttons beside the title, named; a data table opens on Table With Panel', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  const group = screen.getByRole('group', { name: 'View' })
  expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Table', 'List And Record', 'Table With Panel'])
  expect(within(group).getByRole('button', { name: 'Table' })).toHaveAttribute('title', 'Table')
  await waitFor(() => expect(pressed()).toEqual(['Table With Panel']))
})

test('a Table marked as a queue opens on List And Record', async ({ admin }) => {
  await seed(admin, QUEUE, true)
  await openList(admin, QUEUE)
  await waitFor(() => expect(pressed()).toEqual(['List And Record']))
})

test("the person's choice is remembered for the Table", async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  await userEvent.click(view().getByRole('button', { name: 'Table' }))
  expect(pressed()).toEqual(['Table'])
  await waitFor(async () => expect(((await admin.get(`/api/user_settings/${encodeURIComponent(DT)}`)) as { settings: { layout?: string } }).settings?.layout).toBe('table'))
  cleanup()
  await openList(admin)
  await waitFor(() => expect(pressed()).toEqual(['Table']))
})

test('a saved view opened from its link shows in its own view, and a choice made there is the person\'s', async ({ admin }) => {
  await seed(admin)
  await openList(admin, DT, '?layout=split')
  expect(pressed()).toEqual(['List And Record'])
  await userEvent.click(view().getByRole('button', { name: 'Table With Panel' }))
  expect(pressed()).toEqual(['Table With Panel'])
  await waitFor(async () => expect(((await admin.get(`/api/user_settings/${encodeURIComponent(DT)}`)) as { settings: { layout?: string } }).settings?.layout).toBe('panel'))
})
