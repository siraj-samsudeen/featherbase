// #1418 (Option A, issue #1418's UI checklist): above a read-only copy's list,
// what it holds and the two ways to load it, for a System Manager or a role
// the app lets load it; nothing for anyone else. The copy is the copyproof
// app's forecast lines, on the made-up warehouse of the server's tests.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { tableSlug } from 'shared'
import { sql } from 'server/src/db'
import { runOneJob } from 'server/src/jobs'
import { LINES, Warehouse, forecastLines, install, load, removeFolders, withRosterPlaces, writeApp } from 'server/test/read-only-copy-app'
import { test, expect, renderApp } from './pg-test'

const warehouse = new Warehouse('b4_copy_bar')
beforeAll(() => warehouse.create())
afterAll(() => warehouse.drop())
afterEach(async () => { vi.restoreAllMocks(); await removeFolders() })

const WAIT = { timeout: 8000 }
const LIST = `/featherbase/admin/table/${tableSlug(LINES)}`

async function holding(admin: Parameters<typeof install>[0]) {
  await install(admin, await writeApp([forecastLines(warehouse.schema)]))
  await warehouse.publish('Dec-1', [['Dec-1', 'LKS', 'GJ01', '2026-12-01', '1000.00'], ['Dec-1', 'RVR', 'GJ01', '2026-12-01', '800.00']])
  expect(await load(LINES)).toMatchObject({ status: 'loaded' })
}

/** Every request the page makes that the server refuses, from now on. */
function recordFailures(): string[] {
  const failures: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await real(input, init)
    if (response.status >= 400) failures.push(`${response.status} ${String(input)}`)
    return response
  })
  return failures
}

test('a System Manager sees what the copy holds, checks for a new run, and the list follows', async ({ admin }) => {
  await holding(admin)
  await renderApp(LIST, admin)
  const bar = await screen.findByTestId('read-only-copy-bar', {}, WAIT)
  expect(bar).toHaveTextContent(/^Read-only copyLoaded by Copy proof from copyproof-warehouse · run Dec-1 · 2 rows · loaded .+Check for a new runLoad now$/)
  expect(within(bar).getByRole('link', { name: 'copyproof-warehouse' })).toBeInTheDocument()
  expect(screen.queryByTestId('copy-again')).not.toBeInTheDocument()
  await warehouse.publish('Dec-2', [['Dec-2', 'LKS', 'GJ01', '2026-12-01', '1120.00']])
  await userEvent.click(within(bar).getByRole('button', { name: 'Check for a new run' }))
  await waitFor(() => expect(within(screen.getByTestId('read-only-copy-bar')).getByRole('status')).toHaveTextContent('A load is running. The list shows the run above until it finishes.'), WAIT)
  expect(within(bar).getByRole('button', { name: 'Load now' })).toBeDisabled()
  await sql`update background_job set run_at = now() where method = 'read_only_copy_load'`
  expect(await runOneJob()).toBe(true)
  await waitFor(() => expect(screen.getByTestId('read-only-copy-bar')).toHaveTextContent('run Dec-2 · 1 rows'), WAIT)
  await waitFor(() => expect(screen.getByTestId('list-rows')).not.toHaveTextContent('RVR'), WAIT)
  expect(within(screen.getByTestId('read-only-copy-bar')).getByRole('button', { name: 'Load now' })).toBeEnabled()
}, 30_000)

test('a refused load says why, and a copy not loaded yet says so', async ({ admin }) => {
  await install(admin, await writeApp([forecastLines(warehouse.schema)]))
  await sql`insert into dataset_snapshot (row_id, dataset, state, built_at, error)
    values ('refused-load', ${LINES}, 'failed', now(), 'the source has no column value (renamed or removed?). The last good load is kept')`
  await renderApp(LIST, admin)
  const bar = await screen.findByTestId('read-only-copy-bar', {}, WAIT)
  expect(bar).toHaveTextContent('from copyproof-warehouse · not loaded yet')
  expect(within(screen.getByTestId('read-only-copy-bar')).getByRole('alert')).toHaveTextContent(/^The last load \(.+\) was refused: the source has no column value \(renamed or removed\?\)\. The last good load is kept\.$/)
}, 30_000)

test('a role the app lets load the copy sees the bar; its source is plain text to them', async ({ admin, createUser }) => {
  await holding(admin)
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: LINES, role: 'Forecast Loader', operation: 'read' } })
  const loader = await createUser({ email: 'forecast.loader@example.com', roles: ['Forecast Loader'] })
  await renderApp(LIST, loader)
  const bar = await screen.findByTestId('read-only-copy-bar', {}, WAIT)
  expect(within(bar).queryByRole('link')).not.toBeInTheDocument()
  expect(bar).toHaveTextContent('from copyproof-warehouse · run Dec-1')
  await userEvent.click(within(bar).getByRole('button', { name: 'Load now' }))
  await waitFor(() => expect(within(screen.getByTestId('read-only-copy-bar')).getByRole('status')).toHaveTextContent('A load is running'), WAIT)
  expect((await sql`select payload from background_job where method = 'read_only_copy_load'`)[0].payload).toMatchObject({ table: LINES, force: true })
}, 30_000)

test('a reader who may not load the copy sees no bar, and the list asks nothing that fails', async ({ admin, createUser }) => {
  await holding(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Forecast Viewer' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: LINES, role: 'Forecast Viewer', operation: 'read' } })
  const reader = await createUser({ email: 'forecast.viewer@example.com', roles: ['Forecast Viewer'] })
  const failures = recordFailures()
  // #1454: a copy is about stores, so the reader sees their places' rows: Lakeside here
  await withRosterPlaces([{ label: 'Lakeside', filters: { store: ['LKS'] } }], async () => {
    await renderApp(LIST, reader)
    await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('LKS'), WAIT)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining(':copy_load_state'), expect.anything()), WAIT)
    expect(screen.getByTestId('list-rows')).not.toHaveTextContent('RVR')
  })
  expect(screen.queryByTestId('read-only-copy-bar')).not.toBeInTheDocument()
  expect(failures).toEqual([])
}, 30_000)

test('a load the bar cannot start says why', async ({ admin }) => {
  await holding(admin)
  await renderApp(LIST, admin)
  const bar = await screen.findByTestId('read-only-copy-bar', {}, WAIT)
  // The app stops declaring the copy between the page opening and the press.
  const { registerAppCopies } = await import('server/src/read-only-copy')
  registerAppCopies('copyproof', [])
  await userEvent.click(within(bar).getByRole('button', { name: 'Check for a new run' }))
  await waitFor(() => expect(within(screen.getByTestId('read-only-copy-bar')).getByRole('alert')).toHaveTextContent('copyproof.forecast_line_day is not a read-only copy'), WAIT)
}, 30_000)
