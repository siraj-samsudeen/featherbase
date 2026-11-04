import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll } from 'vitest'
import postgres from 'postgres'
import { invalidateSources } from 'server/src/sources/registry'
import { EXTERNAL_DATABASE_URL } from 'server/test/external-database'
import { test, expect, renderApp } from './pg-test'
import { tableHref } from 'shared'
import { grantRole } from 'server/test/fixtures'

// #796: a column whose source foreign key points at a table not connected yet
// says so beside its value; a System Manager is offered that table, and the
// offer opens the data source's tables with it already chosen.

const ENV = 'WEB_UNLINKED_FIXTURE_URL'
process.env[ENV] = EXTERNAL_DATABASE_URL
let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 1 })
  await cli.unsafe('drop schema if exists web_unlinked cascade')
  await cli.unsafe(`create schema web_unlinked;
    create table web_unlinked.rack (id bigint primary key, label text);
    create table web_unlinked.crate (id bigint primary key, rack_id bigint references web_unlinked.rack(id), weight int);
    insert into web_unlinked.rack values (1, 'Upper');
    insert into web_unlinked.crate values (5, 1, 12);`)
})
afterAll(async () => {
  invalidateSources()
  await cli.unsafe('drop schema if exists web_unlinked cascade')
  await cli.end({ timeout: 2 })
})

async function crateAlone(admin: { post: <T>(p: string, b: unknown) => Promise<T> }) {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'web-unlinked', engine: 'postgres', url_env: ENV, default_schema: 'web_unlinked', access: 'read_only' })
  await admin.post('/api/table/Data%20Source/web-unlinked:reflect', { tables: ['web_unlinked.crate'], names: { 'web_unlinked.crate': 'Crate' } })
}

test("a System Manager is told the rack table isn't connected and the offer opens it chosen", async ({ admin }) => {
  await crateAlone(admin)
  const user = userEvent.setup()
  const { router } = await renderApp(`${tableHref('Crate')}/row/5`, admin)
  const note = await screen.findByTestId('unlinked-rack_id', undefined, { timeout: 8000 })
  expect(note).toHaveTextContent('The rack table is not connected yet')
  // The note describes the field, so a screen reader hears it with the value.
  expect(screen.getByLabelText('Rack')).toHaveAttribute('aria-describedby', expect.stringContaining(note.id))
  // A column with no recorded foreign key carries no note.
  expect(screen.queryByTestId('unlinked-weight')).not.toBeInTheDocument()

  await user.click(within(note).getByRole('link', { name: 'Connect the rack table' }))
  await waitFor(() =>
    expect((router.state as { location: { pathname: string } }).location.pathname).toBe('/featherbase/admin/source/web-unlinked'),
  )
  const row = await screen.findByTestId('sb-row-rack', undefined, { timeout: 8000 })
  await waitFor(() => expect(within(row).getByRole('checkbox', { name: 'Reflect web_unlinked.rack' })).toBeChecked())
  expect(screen.getByTestId('sb-schema')).toHaveValue('web_unlinked')
  expect(within(screen.getByTestId('sb-row-crate')).getByRole('checkbox')).not.toBeChecked()
})

test('asking for a table already connected chooses nothing', async ({ admin }) => {
  await crateAlone(admin)
  await renderApp('/featherbase/admin/source/web-unlinked?connect=web_unlinked.crate', admin)
  const row = await screen.findByTestId('sb-row-crate', undefined, { timeout: 8000 })
  expect(within(row).getByRole('checkbox')).toBeDisabled()
  expect(within(row).getByRole('checkbox')).not.toBeChecked()
  expect(screen.getByTestId('sb-reflect')).toBeDisabled()
})

test('someone who may only read crates is told, but not offered to connect', async ({ admin, createUser }) => {
  await crateAlone(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Crate Reader' } })
  await grantRole(admin, { table: 'Crate', role: 'Crate Reader', can_read: true })
  const reader = await createUser({ email: 'crate-reader@example.test', roles: ['Crate Reader'] })
  await renderApp(`${tableHref('Crate')}/row/5`, reader)
  const note = await screen.findByTestId('unlinked-rack_id', undefined, { timeout: 8000 })
  expect(note).toHaveTextContent('The rack table is not connected yet')
  expect(within(note).queryByRole('link')).not.toBeInTheDocument()
})
