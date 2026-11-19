// #1282 A4: a Table's default view in the real list. A fresh person opens on it; a person's own choice wins; Reset
// shows only when their view differs and clears only their own choices; Show Retired and a board's grouping are
// remembered; the team Activity feed offers Undo while a save is the default. Made-up names.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
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
