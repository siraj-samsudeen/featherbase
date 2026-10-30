// Saved Views (openspec/specs/saved-views): the chips above a Table's list.
// Real ListView in jsdom against the in-process server, inside a rolled-back
// Postgres transaction. The server rules (privacy, permissions, delete) are
// in apps/server/test/saved-views.test.ts; this file proves what the person
// sees and can do on the list.

import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { getToken } from '../src/lib/api'
import { test, expect, renderApp } from './pg-test'


type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent
const OPEN = [['stage', '=', 'Open']]
const CLOSED = [['stage', '=', 'Closed']]
const cellTexts = () =>
  [...screen.getByTestId('list-rows').querySelectorAll('[data-testid="cell-stage"]')].map((e) => e.textContent ?? '')

async function seed(admin: Admin, table: string) {
  await admin.post('/api/table_def', {
    name: table,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
      { column_name: 'stage', column_type: 'Choice', label: 'Stage', choices: 'Open\nClosed', in_list_view: true },
    ],
  })
  for (const [title, stage] of [['a', 'Open'], ['b', 'Closed'], ['c', 'Open']])
    await admin.post('/api/save_row', { table, row: { title, stage } })
  // Anyone holding this role may read it, so a teammate can see the views.
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Sv Reader' } })
  await admin.post('/api/save_row', {
    table: 'Permission',
    row: { ref_table: table, role: 'Sv Reader', tier: 'basic', can_read: true },
  })
}

async function open(admin: Admin, table: string, filters?: unknown) {
  const search = filters ? `?filters=${enc(JSON.stringify(filters))}` : ''
  await renderApp(`/featherbase/admin/${enc(table)}${search}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
}

test('Reopen a saved view: opening it applies its filters in place of the ones already on the list', async ({ admin }) => {
  await seed(admin, 'Sv Reopen')
  await admin.post('/api/saved_views', { table: 'Sv Reopen', label: 'My open items', filters: OPEN })
  await open(admin, 'Sv Reopen', CLOSED)
  await waitFor(() => expect(cellTexts()).toEqual(['Closed']))

  fireEvent.click(await screen.findByTestId('saved-view-chip'))

  await waitFor(() => expect(cellTexts()).toEqual(['Open', 'Open']))
  expect(screen.getAllByTestId('filter-chip')).toHaveLength(1)
  expect(screen.getByTestId('filter-chip')).toHaveTextContent('stage = Open')
  expect(screen.getByTestId('saved-view-chip')).toHaveAttribute('aria-pressed', 'true')
})

test('A saved view is private unless its owner shares it: a private view is invisible to a teammate', async ({ admin, createUser }) => {
  await seed(admin, 'Sv Share')
  await admin.post('/api/saved_views', {
    table: 'Sv Share',
    label: 'Open ones',
    filters: OPEN,
  })
  const teammate = await createUser({ roles: ['Sv Reader'] })

  // Private: the teammate sees no chip at all.
  await open(teammate, 'Sv Share')
  await waitFor(() => expect(cellTexts()).toHaveLength(3))
  expect(screen.queryByTestId('saved-view-chip')).not.toBeInTheDocument()
})

test('A saved view is private unless its owner shares it: a shared view shows for the teammate with no way to change it', async ({ admin, createUser }) => {
  await seed(admin, 'Sv Shared')
  await admin.post('/api/saved_views', {
    table: 'Sv Shared',
    label: 'Open ones',
    filters: OPEN,
    shared: true,
  })
  const teammate = await createUser({ roles: ['Sv Reader'] })

  await open(teammate, 'Sv Shared', OPEN)
  const chip = await screen.findByTestId('saved-view-chip')
  expect(chip).toHaveTextContent('Open ones')
  // Even on the active chip, a teammate gets no share or delete control.
  expect(screen.queryByTestId('saved-view-share')).not.toBeInTheDocument()
  expect(screen.queryByTestId('saved-view-delete')).not.toBeInTheDocument()
  fireEvent.click(chip)
  await waitFor(() => expect(cellTexts()).toEqual(['Open', 'Open']))
})

test('A saved view is private unless its owner shares it: the owner shares it from its chip, and can delete it', async ({ admin }) => {
  await seed(admin, 'Sv Owner')
  const view = await admin.post<{ row_id: string }>('/api/saved_views', {
    table: 'Sv Owner',
    label: 'Open ones',
    filters: OPEN,
  })
  await open(admin, 'Sv Owner', OPEN)
  await screen.findByTestId('saved-view-chip')

  fireEvent.click(await screen.findByTestId('saved-view-share'))
  await waitFor(() => expect(screen.getByTestId('saved-view-chip')).toHaveTextContent('shared'))
  const shared = await admin.get<{ views: { row_id: string; shared: boolean }[] }>(`/api/saved_views?table=${enc('Sv Owner')}`)
  expect(shared.views.find((v) => v.row_id === view.row_id)?.shared).toBe(true)

  fireEvent.click(screen.getByTestId('saved-view-delete'))
  await waitFor(() => expect(screen.queryByTestId('saved-view-chip')).not.toBeInTheDocument())
  const left = await admin.get<{ views: unknown[] }>(`/api/saved_views?table=${enc('Sv Owner')}`)
  expect(left.views).toHaveLength(0)
})

test('Changing a saved view means saving over it: a view\'s chip offers no rename or edit', async ({ admin }) => {
  await seed(admin, 'Sv Fixed')
  await admin.post('/api/saved_views', { table: 'Sv Fixed', label: 'Open ones', filters: OPEN })
  await open(admin, 'Sv Fixed', OPEN)
  const bar = await screen.findByTestId('saved-views-bar')
  await within(bar).findByTestId('saved-view-chip')
  const controls = within(bar).getAllByRole('button').map((b) => b.getAttribute('data-testid'))
  expect(controls.sort()).toEqual(['save-view-open', 'saved-view-chip', 'saved-view-delete', 'saved-view-share'])
})

test('first-use filters can be saved, cancelled and reopened after remount without waiting for a nudge', async ({ admin }) => {
  await seed(admin, 'Sv First')
  await open(admin, 'Sv First')
  await waitFor(() => expect(cellTexts()).toHaveLength(3))
  expect(screen.queryByRole('button', { name: 'Save view' })).not.toBeInTheDocument()
  cleanup()
  await open(admin, 'Sv First', OPEN)
  fireEvent.click(await screen.findByRole('button', { name: 'Save view' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), { target: { value: 'Cancelled' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('textbox', { name: 'View name' })).not.toBeInTheDocument()
  expect((await admin.get<{ views: unknown[] }>('/api/saved_views?table=Sv%20First')).views).toEqual([])

  fireEvent.click(screen.getByRole('button', { name: 'Save view' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), { target: { value: 'First open items' } })
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
  expect(await screen.findByTestId('saved-view-chip')).toHaveTextContent('First open items')
  const saved = await admin.get<{ views: { label: string; filters: unknown; shared: boolean }[] }>('/api/saved_views?table=Sv%20First')
  expect(saved.views).toMatchObject([{ label: 'First open items', filters: OPEN, shared: false }])
  cleanup()
  await open(admin, 'Sv First', CLOSED)
  fireEvent.click(await screen.findByTestId('saved-view-chip'))
  await waitFor(() => expect(cellTexts()).toEqual(['Open', 'Open']))
})

test('an expired session hides its saved-view controls rather than exposing the old person’s state', async ({ admin }) => {
  await seed(admin, 'Sv Expired')
  await open(admin, 'Sv Expired', OPEN)
  fireEvent.click(await screen.findByRole('button', { name: 'Save view' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), { target: { value: 'Private draft' } })
  await admin.post('/api/logout', {})
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
  await waitFor(() => expect(getToken()).toBeNull())
  await waitFor(() => expect(screen.queryByTestId('saved-views-bar')).not.toBeInTheDocument())
  expect(screen.queryByDisplayValue('Private draft')).not.toBeInTheDocument()
})

test('a refused view save stays visible and can be corrected through the same form', async ({ admin }) => {
  await seed(admin, 'Sv Refused')
  await open(admin, 'Sv Refused', OPEN)
  fireEvent.click(await screen.findByRole('button', { name: 'Save view' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), { target: { value: 'x'.repeat(101) } })
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
  expect(await screen.findByTestId('saved-view-error')).toHaveAttribute('role', 'alert')
  expect(screen.getByRole('textbox', { name: 'View name' })).toHaveValue('x'.repeat(101))
  expect((await admin.get<{ views: unknown[] }>('/api/saved_views?table=Sv%20Refused')).views).toEqual([])
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), { target: { value: 'Corrected' } })
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
  expect(await screen.findByTestId('saved-view-chip')).toHaveTextContent('Corrected')
  expect(screen.queryByTestId('saved-view-error')).not.toBeInTheDocument()
})

function seedApplications(userId: string, table: string, filters: unknown, n: number) {
  localStorage.setItem(
    `fc-filter-count:${userId}`,
    JSON.stringify({ [`${table}|${JSON.stringify(filters)}`]: { n, t: Date.now() - 60_000 } }),
  )
}

test('Featherbase offers to save a filter you keep reusing: the third application in a week offers to save it, and saving makes it a view', async ({ admin }) => {
  await seed(admin, 'Sv Nudge')
  seedApplications(admin.user!, 'Sv Nudge', OPEN, 2)
  await open(admin, 'Sv Nudge', OPEN)

  const nudge = await screen.findByTestId('filter-nudge')
  expect(nudge).toHaveTextContent('3×')
  expect(screen.getAllByRole('textbox', { name: 'View name' })).toHaveLength(1)
  fireEvent.change(screen.getByTestId('nudge-name'), { target: { value: 'Open stuff' } })
  fireEvent.click(screen.getByTestId('nudge-save'))

  await waitFor(() => expect(screen.queryByTestId('filter-nudge')).not.toBeInTheDocument())
  expect(await screen.findByTestId('saved-view-chip')).toHaveTextContent('Open stuff')
  const list = await admin.get<{ views: { label: string; filters: unknown }[] }>(`/api/saved_views?table=${enc('Sv Nudge')}`)
  expect(list.views).toMatchObject([{ label: 'Open stuff', filters: OPEN }])
})

test('Featherbase offers to save a filter you keep reusing: it stays quiet before the third time, and "not now" silences it for that combination', async ({ admin }) => {
  await seed(admin, 'Sv Quiet')
  seedApplications(admin.user!, 'Sv Quiet', OPEN, 1)
  await open(admin, 'Sv Quiet', OPEN)
  await waitFor(() => expect(cellTexts()).toEqual(['Open', 'Open']))
  expect(screen.queryByTestId('filter-nudge')).not.toBeInTheDocument()

  // A list that already hit three applications, then dismissed.
  const { cleanup } = await import('@testing-library/react')
  cleanup()
  seedApplications(admin.user!, 'Sv Quiet', OPEN, 2)
  await open(admin, 'Sv Quiet', OPEN)
  fireEvent.click(await screen.findByTestId('nudge-dismiss'))
  await waitFor(() => expect(screen.queryByTestId('filter-nudge')).not.toBeInTheDocument())

  cleanup()
  seedApplications(admin.user!, 'Sv Quiet', OPEN, 5)
  await open(admin, 'Sv Quiet', OPEN)
  await waitFor(() => expect(cellTexts()).toEqual(['Open', 'Open']))
  expect(screen.queryByTestId('filter-nudge')).not.toBeInTheDocument()
})
