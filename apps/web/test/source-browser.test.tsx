import { screen, waitFor } from '@testing-library/react'
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
})
afterAll(async () => {
  invalidateSources()
  await cli.unsafe('drop schema if exists web_sb cascade')
  await cli.end({ timeout: 2 })
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
