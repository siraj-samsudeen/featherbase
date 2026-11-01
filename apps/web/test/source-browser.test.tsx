import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll } from 'vitest'
import postgres from 'postgres'
import { invalidateSources } from 'server/src/sources/registry'
import { EXTERNAL_DATABASE_URL } from 'server/test/external-database'
import { test, expect, renderApp } from './pg-test'

// External data sources — browsing what a data source holds and turning one of
// its tables into a Featherbase table, from the source browser page.

const ENV = 'WEB_SB_FIXTURE_URL'
process.env[ENV] = EXTERNAL_DATABASE_URL
let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 1 })
  await cli.unsafe('drop schema if exists web_sb cascade')
  await cli.unsafe('create schema web_sb')
  await cli.unsafe(`create table web_sb.depot (code integer primary key, city text);
    create table web_sb.depot_tag (depot integer not null, tag text not null, primary key (depot, tag));`)
  await cli.unsafe(`create table web_sb.schedule (id text primary key, starts text, ends text);
    insert into web_sb.schedule values
      ('good', '2026-11-01', '2026-11-02'),
      ('bad-start', 'not-a-date', '2026-11-02'),
      ('bad-month', '2026-00-01', '2026-11-02'),
      ('bad-end', '2026-11-01', '2026-11-00');`)
})
afterAll(async () => {
  invalidateSources()
  await cli.unsafe('drop schema if exists web_sb cascade')
  await cli.end({ timeout: 2 })
})

test('the Gantt view skips malformed external dates without hiding valid neighboring records', async ({ admin }) => {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'web-gantt', engine: 'postgres', url_env: ENV, default_schema: 'web_sb', access: 'read_only' })
  // The external driver returns the real source's text. No native Date
  // write, fabricated metadata or callback can supply this malformed value.
  await admin.post('/api/table_def', {
    name: 'External Schedule', data_source: 'web-gantt', external_schema: 'web_sb', external_table: 'schedule', external_pk: 'id',
    columns: [
      { column_name: 'start', column_type: 'Date', source_column: 'starts' },
      { column_name: 'end', column_type: 'Date', source_column: 'ends' },
    ],
  })
  const rows = await admin.get<{ data: { row_id: string; start: string; end: string }[] }>(`/api/table/External%20Schedule?fields=${encodeURIComponent(JSON.stringify(['row_id', 'start', 'end']))}`)
  expect(rows.data).toContainEqual(expect.objectContaining({ row_id: 'bad-start', start: 'not-a-date' }))
  await renderApp('/featherbase/admin/External%20Schedule/view/gantt', admin)
  expect(await screen.findByTestId('gantt-bar-good')).toHaveAttribute('data-start', '2026-11-01')
  expect(screen.getByTestId('gantt-bar-good')).toHaveAttribute('data-end', '2026-11-02')
  for (const id of ['bad-start', 'bad-month', 'bad-end'])
    expect(screen.queryByTestId(`gantt-bar-${id}`)).not.toBeInTheDocument()
})

test('the source browser lists a source\'s tables, marks one with no single identifying column as unusable, and turns the others on', async ({ admin }) => {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'web-sb', engine: 'postgres', url_env: ENV, default_schema: 'web_sb', access: 'read_only' })
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/source/web-sb', admin)

  await user.click(await screen.findByTestId('sb-load'))
  const unusable = await screen.findByTestId('sb-row-depot_tag', undefined, { timeout: 8000 })
  expect(unusable).toHaveTextContent(/single-column primary key/)
  expect(unusable.querySelector('input[type="checkbox"]')).toBeDisabled()

  const usable = screen.getByTestId('sb-row-depot')
  expect(usable).toHaveTextContent('code')
  await user.click(usable.querySelector('input[type="checkbox"]')!)
  await user.click(screen.getByTestId('sb-reflect'))

  const result = await screen.findByTestId('sb-result', undefined, { timeout: 8000 })
  expect(result).toHaveTextContent('Created: Web Depot')
  await waitFor(async () => {
    const meta = await admin.get<{ data_source: string; external_table: string }>('/api/table/Web%20Depot:meta')
    expect(meta).toMatchObject({ data_source: 'web-sb', external_table: 'depot' })
  })
  // Once turned on, it is shown as already connected and cannot be picked twice.
  await waitFor(() => expect(screen.getByTestId('sb-row-depot').querySelector('input[type="checkbox"]')).toBeDisabled())
})

// "Already connected" (external-data-sources): a builder opens a source one
// of whose tables was connected earlier — not in this visit.
test('opening a source with a table already connected shows that table linked to its Featherbase table, and it cannot be picked again', async ({ admin }) => {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'web-sb3', engine: 'postgres', url_env: ENV, default_schema: 'web_sb', access: 'read_only' })
  await admin.post('/api/table/Data%20Source/web-sb3:reflect', { tables: ['web_sb.depot'], prefix: 'Earlier' })
  const user = userEvent.setup()
  const { router } = await renderApp('/featherbase/admin/source/web-sb3', admin)

  await user.click(await screen.findByTestId('sb-load'))
  const row = await screen.findByTestId('sb-row-depot', undefined, { timeout: 8000 })
  expect(row.querySelector('input[type="checkbox"]')).toBeDisabled()
  const link = within(row).getByRole('link', { name: 'Earlier Depot' })
  // A table not yet connected shows its proposed name as plain text, not a link.
  expect(within(screen.getByTestId('sb-row-depot_tag')).queryByRole('link')).not.toBeInTheDocument()

  await user.click(link)
  await waitFor(() =>
    expect(decodeURIComponent((router.state as { location: { pathname: string } }).location.pathname)).toBe(
      '/featherbase/admin/Earlier Depot',
    ),
  )
})

// Testing the connection, and turning a table on under a chosen prefix and
// module — paths the merged web coverage report (ADR 0012) showed untaken.
test('test connection says whether the source answers, and a prefix and module shape what is turned on', async ({ admin }) => {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'web-sb2', engine: 'postgres', url_env: ENV, default_schema: 'web_sb', access: 'read_only' })
  await admin.post('/api/table/Data%20Source', { row_id: 'web-sb-gone', engine: 'postgres', url_env: 'WEB_SB_NOT_SET', access: 'read_only' })
  const user = userEvent.setup()

  await renderApp('/featherbase/admin/source/web-sb-gone', admin)
  await user.click(await screen.findByTestId('sb-test'))
  expect(await screen.findByTestId('sb-test-result', undefined, { timeout: 8000 })).toHaveTextContent(
    'Failed: Environment variable WEB_SB_NOT_SET is not set',
  )

  cleanup()
  await renderApp('/featherbase/admin/source/web-sb2', admin)
  await user.click(await screen.findByTestId('sb-test'))
  expect(await screen.findByTestId('sb-test-result', undefined, { timeout: 8000 })).toHaveTextContent('Connection OK')

  await user.type(screen.getByTestId('sb-schema'), 'web_sb')
  await user.type(screen.getByTestId('sb-prefix'), 'Gold')
  await user.type(screen.getByTestId('sb-module'), 'Warehouse')
  await user.click(screen.getByTestId('sb-load'))
  const usable = await screen.findByTestId('sb-row-depot', undefined, { timeout: 8000 })
  await user.click(usable.querySelector('input[type="checkbox"]')!)
  await user.click(screen.getByTestId('sb-reflect'))
  const result = await screen.findByTestId('sb-result', undefined, { timeout: 8000 })
  expect(result).toHaveTextContent('Created: Gold Depot')
  const meta = await admin.get<{ module: string; external_table: string }>('/api/table/Gold%20Depot:meta')
  expect(meta).toMatchObject({ module: 'Warehouse', external_table: 'depot' })
})
