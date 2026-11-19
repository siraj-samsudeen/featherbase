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
  await admin.post('/api/table_def', { name: DT, id_pattern: 'hash', title_column: 'shelf_name', columns: [
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
  await admin.post('/api/table_def', { name: 'Tvd Locker', id_pattern: 'hash', title_column: 'locker_name', columns: [
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
    await userEvent.click(screen.getByTestId('compact-rows'))
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
