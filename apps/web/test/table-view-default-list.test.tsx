// #1282 A4: a Table's default view in the real list. A fresh person opens on it; a person's own choice wins; Reset
// shows only when their view differs and clears only their own choices; Show Retired and a board's grouping are
// remembered; the team Activity feed offers Undo while a save is the default. Made-up names.
import { act, cleanup, renderHook, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setSession } from '../src/lib/api'
import { useLinksPreference } from '../src/components/RecordLinks'
import { vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { tableHref } from 'shared'
import { createUserWithRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'
import { openListMenu } from './list-menus'

const T = { timeout: 10_000 }
const DT = 'Tvd Shelf'
type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: DT, id_pattern: 'hash', title_column: 'shelf_name', columns: [
    { column_name: 'shelf_name', column_type: 'Data', label: 'Shelf', in_list_view: true },
    { column_name: 'aisle', column_type: 'Data', label: 'Aisle', in_list_view: true },
    { column_name: 'bay', column_type: 'Int', label: 'Bay' },
    { column_name: 'kind', column_type: 'Choice', label: 'Kind', choices: 'Open\nClosed' },
  ] })
  for (const [shelf_name, aisle, bay, kind] of [['Alpha', 'A1', 3, 'Open'], ['Bravo', 'A2', 1, 'Closed'], ['Charlie', 'A3', 2, 'Open']] as const)
    await admin.post('/api/save_row', { table: DT, row: { shelf_name, aisle, bay, kind } })
}

const shelves = () => within(screen.getByTestId('list-rows')).getAllByRole('link').map((a) => a.textContent).filter((t) => ['Alpha', 'Bravo', 'Charlie'].includes(t ?? ''))
const headers = () => [...screen.getByTestId('list-view').querySelectorAll('thead [data-testid^="col-"]')].map((el) => (el.textContent ?? '').replace(/[↑↓]/g, '').trim())
const putDefault = (admin: Admin, settings: unknown) => admin.fetch(`/api/table_view_default/${enc(DT)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings }) })

test("a fresh person opens on the Table's default: its columns, sort and compact rows", async ({ admin, createUser }) => {
  await seed(admin)
  await putDefault(admin, { shownCols: ['bay'], hiddenCols: ['aisle'], sort: { field: 'bay', dir: 'asc' }, compact: false })
  const reader = await createUserWithRole(admin, createUser, { role: 'Tvd Reader', table: DT, can_read: true })
  await renderApp(tableHref(DT), reader)
  await waitFor(() => expect(shelves()).toEqual(['Bravo', 'Charlie', 'Alpha']), T)
  expect(headers()).toEqual(['Shelf', 'Bay'])
  // Nothing differs from the default, so there is nothing to reset.
  expect((await openListMenu('View')).queryByRole('button', { name: "Reset to the Table's Default" })).not.toBeInTheDocument()
})

// Codex adversarial round 2: a default sorted by a column this reader may not read never breaks their list.
test("a default's sort on a column the reader may not read gives way to the Table's own order", async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Tvd Locker', id_pattern: 'hash', title_column: 'locker_name', columns: [
    { column_name: 'locker_name', column_type: 'Data', label: 'Locker', in_list_view: true },
    { column_name: 'code', column_type: 'Data', label: 'Code', tier: 'restricted' },
  ] })
  for (const [locker_name, code] of [['North', 'z'], ['South', 'a']]) await admin.post('/api/save_row', { table: 'Tvd Locker', row: { locker_name, code } })
  await admin.fetch(`/api/table_view_default/${enc('Tvd Locker')}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { sort: { field: 'code', dir: 'asc' } } }) })
  const reader = await createUserWithRole(admin, createUser, { role: 'Tvd Basic', table: 'Tvd Locker', tier: 'basic', can_read: true })
  await renderApp(tableHref('Tvd Locker'), reader)
  await waitFor(() => expect(within(screen.getByTestId('list-rows')).getAllByRole('link').map((a) => a.textContent).sort()).toEqual(['North', 'South']), T)
  expect(screen.queryByTestId('list-error')).not.toBeInTheDocument()
})

test("a person's own sort wins; Reset shows, and clears only their own choices", async ({ admin, createUser }) => {
  await seed(admin)
  await putDefault(admin, { sort: { field: 'bay', dir: 'asc' } })
  const reader = await createUserWithRole(admin, createUser, { role: 'Tvd Reset', table: DT, can_read: true })
  const other = await createUser({ roles: ['Tvd Reset'] })
  for (const who of [reader, other]) await who.fetch(`/api/user_settings/${enc(DT)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sort: { field: 'shelf_name', dir: 'desc' } }) })
  await renderApp(tableHref(DT), reader)
  await waitFor(() => expect(shelves()).toEqual(['Charlie', 'Bravo', 'Alpha']), T)
  await userEvent.click((await openListMenu('View')).getByRole('button', { name: "Reset to the Table's Default" }))
  await waitFor(() => expect(shelves()).toEqual(['Bravo', 'Charlie', 'Alpha']), T)
  expect((await other.get<{ settings: { sort?: unknown } }>(`/api/user_settings/${enc(DT)}`)).settings.sort).toEqual({ field: 'shelf_name', dir: 'desc' })
})

test('Show Retired is remembered, and its toggle reads as on when the list opens again', async ({ admin }) => {
  await seed(admin)
  const view = await renderApp(tableHref(DT), admin)
  await waitFor(() => expect(shelves().length).toBe(3), T)
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Show Retired' }, T))
  await waitFor(async () => expect((await admin.get<{ settings: { showRetired?: boolean } }>(`/api/user_settings/${enc(DT)}`)).settings.showRetired).toBe(true), T)
  view.unmount()
  cleanup()
  await renderApp(tableHref(DT), admin)
  await waitFor(async () => expect(await screen.findByRole('checkbox', { name: 'Show Retired' }, T)).toBeChecked(), T)
  // Showing retired rows differs from the default, so Reset is offered.
  expect((await openListMenu('View')).getByRole('button', { name: "Reset to the Table's Default" })).toBeInTheDocument()
})

test("a board's grouping is remembered for the person on that Table", async ({ admin }) => {
  await seed(admin)
  await admin.fetch(`/api/user_settings/${enc(DT)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groupBy: 'kind' }) })
  await renderApp(`${tableHref(DT)}/view/kanban`, admin)
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('kind'), T)
})

test("the team feed's line for a save offers Undo while it is the default", async ({ admin }) => {
  await seed(admin)
  await putDefault(admin, { compact: true })
  await renderApp('/featherbase/admin', admin)
  const feed = await screen.findByTestId('activity-feed', {}, T)
  await userEvent.click(await within(feed).findByTestId('feed-tab-team', {}, T))
  const line = await waitFor(() => within(feed).getAllByTestId('feed-item').find((r) => r.textContent?.includes('set the default view of'))!, T)
  expect(line).toHaveTextContent(DT)
  await userEvent.click(within(line).getByTestId('feed-undo'))
  await waitFor(async () => expect((await admin.get<{ default: unknown }>(`/api/table_view_default/${enc(DT)}`)).default).toBeNull(), T)
  await waitFor(() => expect(within(feed).queryByTestId('feed-undo')).not.toBeInTheDocument(), T)
})

// Codex adversarial round 2: Reset goes after a save already on its way, so that save never brings a choice back.
test('Reset waits for a slow earlier save, so the cleared choice stays cleared', async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(DT), admin)
  await waitFor(() => expect(shelves().length).toBe(3), T)
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (init?.method === 'PUT' && url.includes(`/api/user_settings/${enc(DT)}`)) await new Promise((r) => setTimeout(r, 400))
    return real(input, init)
  })
  try {
    await userEvent.click(screen.getByRole('button', { name: 'Compact Rows' }))
    await userEvent.click((await openListMenu('View')).getByRole('button', { name: "Reset to the Table's Default" }))
    await new Promise((r) => setTimeout(r, 600))
    await waitFor(async () => expect((await admin.get<{ settings: { compact?: boolean } | null }>(`/api/user_settings/${enc(DT)}`)).settings?.compact).toBeUndefined(), T)
  } finally { vi.restoreAllMocks() }
})

// Codex adversarial round 2: a Links choice held on screen gives way once the person's settings are read again
// (a Reset), where no address names the walk's own choice.
test("a Links choice held on screen gives way once a Reset is read back", async ({ admin }) => {
  await seed(admin)
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useLinksPreference(DT), { wrapper })
  await waitFor(() => expect(result.current.ready).toBe(true), T)
  act(() => result.current.setAs('tree'))
  expect(result.current.as).toBe('tree')
  await waitFor(async () => expect((await admin.get<{ settings: { links?: { as?: string } } }>(`/api/user_settings/${enc(DT)}`)).settings.links?.as).toBe('tree'), T)
  await admin.fetch(`/api/user_settings/${enc(DT)}/reset`, { method: 'POST' })
  await act(() => queryClient.invalidateQueries({ queryKey: ['user-settings', DT] }))
  await waitFor(() => expect(result.current.as).toBe('sections'), T)
})

// Codex adversarial round 3: no column can be switched before the person's saved columns arrive, so a switch never
// replaces choices it could not see yet.
test("the column switches wait for the person's saved columns, which stay as they were", async ({ admin }) => {
  await seed(admin)
  await admin.fetch(`/api/user_settings/${enc(DT)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shownCols: ['bay'], hiddenCols: [] }) })
  const real = globalThis.fetch
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!init?.method && url.endsWith(`/api/user_settings/${enc(DT)}`)) await held
    return real(input, init)
  })
  try {
    await renderApp(tableHref(DT), admin)
    await userEvent.click(await screen.findByTestId('list-columns', {}, T))
    expect(await screen.findByTestId('list-col-toggle-aisle', {}, T)).toBeDisabled()
    release()
    await waitFor(() => expect(screen.getByTestId('list-col-toggle-aisle')).toBeEnabled(), T)
    await userEvent.click(screen.getByTestId('list-col-toggle-aisle'))
    await waitFor(async () => expect((await admin.get<{ settings: { shownCols?: string[]; hiddenCols?: string[] } }>(`/api/user_settings/${enc(DT)}`)).settings)
      .toMatchObject({ shownCols: ['bay'], hiddenCols: ['aisle'] }), T)
  } finally { release(); vi.restoreAllMocks() }
})

// Verifier: a phone shows every list as Table, which is the phone's, not the person's choice; a default saved from
// a phone keeps the person's own desktop layout.
test("a default made on a phone keeps the person's desktop layout, not the phone's Table", async ({ admin }) => {
  await seed(admin)
  await admin.fetch(`/api/user_settings/${enc(DT)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'split' }) })
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: q === '(width < 48rem)', media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList)
  try {
    await renderApp(tableHref(DT), admin)
    await waitFor(() => expect(screen.getByTestId('list-view')).toBeInTheDocument(), T)
    await userEvent.click(await waitFor(async () => (await openListMenu('View')).getByRole('button', { name: "Make This the Table's Default…" }), T))
    const dialog = await screen.findByTestId('table-default-dialog', {}, T)
    expect(within(dialog).getByTestId('table-default-words').children[0]!.textContent).toBe('List And Record')
  } finally { vi.restoreAllMocks() }
})

test('the confirm closes on Escape and on a click outside it, saving nothing', async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(DT), admin)
  await waitFor(() => expect(shelves().length).toBe(3), T)
  const open = async () => {
    await userEvent.click(await waitFor(async () => (await openListMenu('View')).getByRole('button', { name: "Make This the Table's Default…" }), T))
    return screen.findByTestId('table-default-dialog', {}, T)
  }
  await open()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('table-default-dialog')).not.toBeInTheDocument())
  const dialog = await open()
  await userEvent.click(dialog.parentElement!)
  await waitFor(() => expect(screen.queryByTestId('table-default-dialog')).not.toBeInTheDocument())
  expect((await admin.get<{ default: unknown }>(`/api/table_view_default/${enc(DT)}`)).default).toBeNull()
})

test("the toast's Undo says so when the save is no longer the default", async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(DT), admin)
  await waitFor(() => expect(shelves().length).toBe(3), T)
  await userEvent.click(await waitFor(async () => (await openListMenu('View')).getByRole('button', { name: "Make This the Table's Default…" }), T))
  await userEvent.click(await screen.findByTestId('table-default-confirm', {}, T))
  await screen.findByTestId('table-default-toast', {}, T)
  // Another save lands first, so this one is no longer the default.
  await putDefault(admin, { compact: true })
  await userEvent.click(screen.getByTestId('table-default-undo'))
  expect(await screen.findByText("Couldn't undo: it is no longer the default.", {}, T)).toBeInTheDocument()
})

test('a Reset the server refuses says the list could not be saved', async ({ admin }) => {
  await seed(admin)
  await admin.fetch(`/api/user_settings/${enc(DT)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ compact: true }) })
  await renderApp(tableHref(DT), admin)
  await waitFor(() => expect(shelves().length).toBe(3), T)
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/reset')) return new Response(JSON.stringify({ error: { type: 'InternalError', message: 'no' } }), { status: 500 })
    return real(input, init)
  })
  try {
    await userEvent.click((await openListMenu('View')).getByRole('button', { name: "Reset to the Table's Default" }))
    expect(await screen.findByTestId('list-settings-error', {}, T)).toBeInTheDocument()
  } finally { vi.restoreAllMocks() }
})

test("choosing a board's grouping remembers it", async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Tvd Bin', id_pattern: 'hash', title_column: 'bin_name', columns: [
    { column_name: 'bin_name', column_type: 'Data', label: 'Bin', in_list_view: true },
    { column_name: 'state', column_type: 'Choice', label: 'State', choices: 'Full\nEmpty' },
    { column_name: 'size', column_type: 'Choice', label: 'Size', choices: 'Small\nLarge' },
  ] })
  await renderApp(`${tableHref('Tvd Bin')}/view/kanban`, admin)
  await userEvent.selectOptions(await screen.findByRole('combobox', {}, T), 'size')
  await waitFor(async () => expect((await admin.get<{ settings: { groupBy?: string } }>(`/api/user_settings/${enc('Tvd Bin')}`)).settings.groupBy).toBe('size'), T)
})

test("a board's grouping that could not be saved still holds for this visit", async ({ admin }) => {
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Tvd Crate', id_pattern: 'hash', title_column: 'crate_name', columns: [
    { column_name: 'crate_name', column_type: 'Data', label: 'Crate', in_list_view: true },
    { column_name: 'state', column_type: 'Choice', label: 'State', choices: 'Full\nEmpty' },
    { column_name: 'size', column_type: 'Choice', label: 'Size', choices: 'Small\nLarge' },
  ] })
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (init?.method === 'PUT' && url.includes('/api/user_settings/')) return new Response('{}', { status: 500 })
    return real(input, init)
  })
  try {
    await renderApp(`${tableHref('Tvd Crate')}/view/kanban`, admin)
    await userEvent.selectOptions(await screen.findByRole('combobox', {}, T), 'size')
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('size'), T)
  } finally { vi.restoreAllMocks() }
})
