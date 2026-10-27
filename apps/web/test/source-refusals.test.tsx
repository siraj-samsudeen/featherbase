// Connected (external Postgres) Tables from the list and the source browser:
// bulk-deleting rows of a Table that tracks the source's modified column, and
// the source browser's refusals and skips. Gaps the merged web coverage report
// (ADR 0012) showed. The "foreign database" is a schema created outside the
// sandbox, as source-browser.test.tsx does; each refusal is the server's own.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll } from 'vitest'
import postgres from 'postgres'
import { invalidateSources } from 'server/src/sources/registry'
import { EXTERNAL_DATABASE_URL } from 'server/test/external-database'
import { test, expect, renderApp } from './pg-test'

const ENV = 'WEB_SRF_FIXTURE_URL'
process.env[ENV] = EXTERNAL_DATABASE_URL
let cli: ReturnType<typeof postgres>

type Admin = Parameters<typeof renderApp>[1]

beforeAll(async () => {
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 1 })
  await cli.unsafe('drop schema if exists web_srf cascade')
  await cli.unsafe('create schema web_srf')
  await cli.unsafe(`create table web_srf.shelf (
    id integer primary key, label text, updated_at timestamptz not null default now())`)
})
afterAll(async () => {
  invalidateSources()
  await cli.unsafe('drop schema if exists web_srf cascade')
  await cli.end({ timeout: 2 })
})

async function source(admin: Admin, access = 'read_write') {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'web-srf', engine: 'postgres', url_env: ENV, default_schema: 'web_srf', access })
}

test('bulk-deleting rows of a connected Table removes them from the source', async ({ admin }) => {
  await cli.unsafe(`delete from web_srf.shelf; insert into web_srf.shelf (id, label) values (1, 'A1'), (2, 'A2'), (3, 'A3')`)
  await source(admin)
  await admin.post('/api/table_def', {
    name: 'Srf Shelf',
    data_source: 'web-srf',
    external_schema: 'web_srf',
    external_table: 'shelf',
    external_pk: 'id',
    external_modified: 'updated_at',
    columns: [{ column_name: 'label', column_type: 'Data', in_list_view: true }],
  })
  await renderApp('/featherbase/admin/Srf%20Shelf', admin)
  const rows = await screen.findByTestId('list-rows', {}, { timeout: 8000 })
  await waitFor(() => expect(within(rows).getAllByTestId('row-check')).toHaveLength(3))
  const checks = within(rows).getAllByTestId('row-check')
  fireEvent.click(checks[0])
  fireEvent.click(checks[1])
  fireEvent.click(await screen.findByTestId('bulk-delete'))
  await waitFor(() => expect(within(screen.getByTestId('list-rows')).getAllByTestId('row-check')).toHaveLength(1))
  const left = await cli`select id from web_srf.shelf order by id`
  expect(left).toHaveLength(1)
})

test('testing or turning on tables of a source deleted meanwhile says it is not found', async ({ admin }) => {
  const user = userEvent.setup()
  await source(admin, 'read_only')
  await renderApp('/featherbase/admin/source/web-srf', admin)
  await user.click(await screen.findByTestId('sb-load'))
  const shelf = await screen.findByTestId('sb-row-shelf', undefined, { timeout: 8000 })
  await user.click(shelf.querySelector('input[type="checkbox"]')!)

  await admin.delete('/api/table/Data%20Source/web-srf')
  invalidateSources()
  await user.click(screen.getByTestId('sb-test'))
  expect(await screen.findByTestId('sb-test-result', undefined, { timeout: 8000 })).toHaveTextContent(/^Failed: .*not found/i)
  await user.click(screen.getByTestId('sb-reflect'))
  expect(await screen.findByText(/Data Source web-srf not found/i)).toBeInTheDocument()
})

test('a table whose name is already taken is skipped, with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await source(admin, 'read_only')
  await admin.post('/api/table_def', { name: 'Web Shelf', columns: [{ column_name: 'label', column_type: 'Data' }] })
  cleanup()
  await renderApp('/featherbase/admin/source/web-srf', admin)
  await user.click(await screen.findByTestId('sb-load'))
  const shelf = await screen.findByTestId('sb-row-shelf', undefined, { timeout: 8000 })
  await user.click(shelf.querySelector('input[type="checkbox"]')!)
  await user.click(screen.getByTestId('sb-reflect'))
  expect(await screen.findByTestId('sb-result', undefined, { timeout: 8000 })).toHaveTextContent('Skipped: web_srf.shelf (Table Web Shelf already exists)')
})
