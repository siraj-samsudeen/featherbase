// #1259: a list in three views, switched by three buttons beside its title,
// remembered per person per Table. A queue opens on cards; a saved view keeps
// the view it was saved in. Every test that switches waits for the settings
// PUT to land (list-settings.test.tsx): a write that outlives the test's
// transaction would commit for real.
import { tableSlug } from 'shared'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { api } from '../src/lib/api'

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
  // A queue, or a saved view's link, may open on the cards rather than the table.
  await waitFor(() => expect(screen.getByTestId('list-view')).toHaveTextContent('Anitha'))
}

const view = () => within(screen.getByTestId('layout-switch'))
const pressed = () => within(screen.getByTestId('layout-switch')).getAllByRole('button')
  .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'))

test('three buttons beside the title, named; a data table opens on Table With Panel', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  const group = screen.getByRole('group', { name: 'Views' })
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

test('the arrows move the open record through the rows; a modified arrow, an arrow in a field, or one past the end changes nothing', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', { table: DT, row: { title: 'Bala' } })
  await openList(admin)
  const lines = () => [...document.querySelectorAll<HTMLElement>('[data-row-id]')]
  const first = lines()[0]
  first.focus()
  fireEvent.keyDown(first, { key: 'Enter' })
  const panelName = () => screen.getByTestId('record-panel').getAttribute('aria-label')
  await waitFor(() => expect(panelName()).toBe(first.textContent?.match(/Anitha|Bala/)?.[0]))
  const shown = panelName()
  // Another key, Shift+arrow and an arrow typed in a field belong to someone else.
  fireEvent.keyDown(document.body, { key: 'a' })
  fireEvent.keyDown(document.body, { key: 'ArrowDown', shiftKey: true })
  fireEvent.keyDown(screen.getAllByRole('searchbox')[0], { key: 'ArrowDown' })
  expect(panelName()).toBe(shown)
  // Up from the first row: nowhere to go.
  fireEvent.keyDown(document.body, { key: 'ArrowUp' })
  expect(panelName()).toBe(shown)
  fireEvent.keyDown(document.body, { key: 'ArrowDown' })
  await waitFor(() => expect(panelName()).not.toBe(shown))
})

test('a choice the server fails to keep still shows, for now', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(input).includes('/api/user_settings/') && init?.method === 'PUT'
      ? Promise.resolve(Response.json({ error: { type: 'TestFailure', message: 'refused' } }, { status: 500 }))
      : real(input, init))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await userEvent.click(view().getByRole('button', { name: 'Table' }))
  expect(pressed()).toEqual(['Table'])
  vi.restoreAllMocks()
})

test("a saved view's view lasts while the person opens its cards", async ({ admin }) => {
  await seed(admin)
  await openList(admin, DT, '?layout=split')
  expect(pressed()).toEqual(['List And Record'])
  const card = (await screen.findAllByTestId('record-card'))[0]
  await userEvent.click(within(card).getAllByRole('button')[0])
  await screen.findByTestId('record-panel')
  expect(pressed()).toEqual(['List And Record'])
  expect(screen.getByTestId('list-split')).toBeInTheDocument()
})

test('a link that opens a record shows it over the table even for someone who reads the list as Table', async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(DT)}`, { layout: 'table' })
  const view = await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`, admin)
  await screen.findByTestId('list-view')
  await waitFor(() => expect(pressed()).toEqual(['Table']))
  const row = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-row-id]')
    expect(found).not.toBeNull()
    return found!
  })
  // The address a colleague pasted: this list, with that row open.
  const id = row.getAttribute('data-row-id')!
  const path = { steps: [{ screen: 'list', table: DT, pane: { table: DT, row: id } }], at: 0 }
  cleanup()
  void view
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}?path=${encodeURIComponent(JSON.stringify(path))}`, admin)
  expect(await screen.findByTestId('record-panel')).toBeInTheDocument()
  expect(within(screen.getByTestId('record-panel-over')).getByTestId('record-panel')).toBeInTheDocument()
})

// Codex review (#1259): a saved view's view belongs to the walk's step, not to the mounted list.
const settled = async (admin: Admin, layout: string) =>
  waitFor(async () => expect(((await admin.get(`/api/user_settings/${encodeURIComponent(DT)}`)) as { settings: { layout?: string } }).settings?.layout).toBe(layout))

test("a view saved without a view of its own shows in the person's view, even right after one that has one", async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(DT)}`, { layout: 'table' })
  await admin.post('/api/saved_views', { table: DT, label: 'As Cards', filters: [['title', '=', 'Anitha']], layout: 'split' })
  await admin.post('/api/saved_views', { table: DT, label: 'Older View', filters: [['title', '=', 'Anitha']] })
  await openList(admin)
  await waitFor(() => expect(pressed()).toEqual(['Table']))
  await userEvent.click(await screen.findByRole('button', { name: 'As Cards' }))
  await waitFor(() => expect(pressed()).toEqual(['List And Record']))
  await userEvent.click(screen.getByRole('button', { name: 'Older View' }))
  await waitFor(() => expect(pressed()).toEqual(['Table']))
  await settled(admin, 'table')
})

test("a saved view's view survives a reload of the record opened from it", async ({ admin }) => {
  await seed(admin)
  const app = await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}?layout=split`, admin)
  await waitFor(() => expect(pressed()).toEqual(['List And Record']))
  const card = (await screen.findAllByTestId('record-card'))[0]
  await userEvent.click(within(card).getAllByRole('button')[0])
  await screen.findByTestId('record-panel')
  const href = (app.router as { state: { location: { href: string } } }).state.location.href
  expect(href).not.toContain('layout=split')
  cleanup()
  await renderApp(href, admin)
  await screen.findByTestId('record-panel')
  expect(pressed()).toEqual(['List And Record'])
})

test("opening the Table itself after a saved view's link shows the person's view", async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(DT)}`, { layout: 'table' })
  const app = await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}?layout=split`, admin)
  await waitFor(() => expect(pressed()).toEqual(['List And Record']))
  // The sidebar's link to the Table: a new entry, the list still mounted.
  ;(app.router as unknown as { history: { push: (href: string) => void } }).history.push(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`)
  await waitFor(() => expect(pressed()).toEqual(['Table']))
})

test('three quick choices are saved in the order they were made', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  // Each choice as soon as the last one shows, before its save has landed.
  for (const name of ['Table', 'List And Record', 'Table With Panel']) {
    fireEvent.click(view().getByRole('button', { name }))
    await waitFor(() => expect(pressed()).toEqual([name]))
  }
  await settled(admin, 'panel')
  await new Promise((done) => setTimeout(done, 300))
  await settled(admin, 'panel')
  expect(pressed()).toEqual(['Table With Panel'])
})

test("a choice made while the person's settings are still on their way is not undone by them", async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(DT)}`, { layout: 'split' })
  // The settings read is answered before the person chooses, and the answer held until after.
  let release!: () => void
  const held = new Promise<void>((done) => { release = done })
  const get = api.get.bind(api)
  const spy = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    const answer = get(path)
    if (path.startsWith('/api/user_settings/')) await held
    return answer
  })
  try {
    await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`, admin)
    fireEvent.click(await screen.findByRole('button', { name: 'Table' }))
    release()
    await settled(admin, 'table')
    await new Promise((done) => setTimeout(done, 300))
    expect(pressed()).toEqual(['Table'])
  } finally {
    spy.mockRestore()
  }
})
