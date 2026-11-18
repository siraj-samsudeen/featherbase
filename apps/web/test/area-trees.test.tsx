// #1282 G1–G6 on the Admin's Links tab: where an installed app declares an area's
// levels (here Location: Cluster › Site), the Also give form's "Pick on the trees ▸"
// opens the shared area picker, in an admin screen's words, and the store picked
// becomes the link's area. Fixture: a copy of test-apps/fixtures/bar-proof declaring it.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resolve } from 'node:path'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { rowHref } from 'shared'
import { discoverPackages } from 'server/src/runtime-packages'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

type Client = Parameters<typeof renderApp>[1]
const CLUSTER = 'At Cluster'
const SITE = 'At Site'
const MEMBER = 'At Member'
const ROLE = 'At Role'
const GIVEN = 'At Role Given'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function seed(admin: Client) {
  const directory = await mkdtemp(resolve('test/.areas-1282-'))
  directories.push(directory)
  await cp(resolve('../..', 'test-apps/fixtures/bar-proof'), directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.areas = [{
    name: 'Location', whole: 'Whole company',
    levels: [
      { table: CLUSTER, title: 'name', label: 'Cluster', plural: 'clusters' },
      { table: SITE, title: 'name', parent: 'cluster', label: 'Store', plural: 'stores', adminLabel: 'Site', adminPlural: 'sites', filters: [['is_store', '=', 1]] },
    ],
  }]
  await writeFile(file, JSON.stringify(manifest))
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })

  const data = (column_name: string) => ({ column_name, column_type: 'Data', in_list_view: true })
  await admin.post('/api/table_def', { name: CLUSTER, id_pattern: 'prompt', title_column: 'name', columns: [data('name')] })
  await admin.post('/api/table_def', { name: SITE, id_pattern: 'prompt', title_column: 'name', columns: [data('name'),
    { column_name: 'cluster', column_type: 'Reference', reference_table: CLUSTER }, { column_name: 'is_store', column_type: 'Check' }] })
  await admin.post('/api/table_def', { name: MEMBER, id_pattern: 'prompt', title_column: 'name', columns: [data('name')] })
  await admin.post('/api/table_def', { name: ROLE, id_pattern: 'prompt', title_column: 'name', columns: [data('name')] })
  await admin.post('/api/table_def', { name: GIVEN, id_pattern: 'hash', columns: [
    { column_name: 'member', column_type: 'Reference', reference_table: MEMBER, label: 'Member', in_list_view: true },
    { column_name: 'role', column_type: 'Reference', reference_table: ROLE, label: 'Role', in_list_view: true },
    { column_name: 'site', column_type: 'Reference', reference_table: SITE, label: 'Area' },
  ] })
  await admin.post('/api/save_row', { table: CLUSTER, row: { row_id: 'cs', name: 'Chennai South' } })
  await admin.post('/api/save_row', { table: CLUSTER, row: { row_id: 'no', name: 'North' } })
  await admin.post('/api/save_row', { table: SITE, row: { row_id: 'se', name: 'Store E', cluster: 'cs', is_store: true } })
  await admin.post('/api/save_row', { table: SITE, row: { row_id: 'sf', name: 'Store F', cluster: 'cs', is_store: true } })
  await admin.post('/api/save_row', { table: SITE, row: { row_id: 'wh', name: 'South Warehouse', cluster: 'cs', is_store: false } })
  await admin.post('/api/save_row', { table: MEMBER, row: { row_id: 'm1', name: 'Mira Member' } })
  await admin.post('/api/save_row', { table: ROLE, row: { row_id: 'r1', name: 'Floor Lead' } })
  await admin.post('/api/save_row', { table: ROLE, row: { row_id: 'r2', name: 'Team Leader' } })
  await admin.post('/api/save_row', { table: GIVEN, row: { member: 'm1', role: 'r1', site: 'sf' } })
}

test("Also give's Pick on the trees opens the shared area picker, in an admin screen's words, and the store picked becomes the area", async ({ admin }) => {
  await seed(admin)
  await renderApp(rowHref(MEMBER, 'm1'), admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Links' }))
  const line = await waitFor(() => screen.getAllByTestId('tick-line').find((l) => l.textContent?.includes('Team Leader')) ?? Promise.reject(new Error('no line')))
  fireEvent.click(within(line).getByRole('button', { name: 'Tick Team Leader' }))
  const form = await screen.findByTestId('also-give-form')
  fireEvent.click(within(form).getByTestId('area-pick'))
  const picker = await within(form).findByTestId('area-picker')
  // Two stores under Chennai South: its warehouse is no store. The level reads "Site" on an admin screen.
  const cluster = await within(picker).findByRole('button', { name: /Chennai South\s*2 sites/ })
  fireEvent.click(cluster)
  expect(await within(picker).findByRole('region', { name: 'Site' })).toBeInTheDocument()
  expect(within(picker).getByTestId('area-not-yet')).toHaveTextContent('Can be given at Site level for now')
  fireEvent.click(await within(picker).findByRole('button', { name: 'Store E' }))
  fireEvent.click(within(picker).getByRole('button', { name: 'Use this area' }))
  await waitFor(() => expect(within(form).queryByTestId('area-picker')).not.toBeInTheDocument())
  await waitFor(() => expect(within(form).getByTestId('area-pick')).toHaveTextContent('Store E ▸'))
  fireEvent.click(within(form).getByRole('button', { name: 'Add' }))
  await waitFor(async () => {
    const given = await admin.get<{ data: { role: string; site: string }[] }>(`/api/table/${encodeURIComponent(GIVEN)}?fields=${encodeURIComponent(JSON.stringify(['role', 'site']))}`)
    expect(given.data).toEqual(expect.arrayContaining([{ role: 'r2', site: 'se' }]))
  })
})

test('Cancel closes the picker and leaves the area as it was', async ({ admin }) => {
  await seed(admin)
  await renderApp(rowHref(MEMBER, 'm1'), admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Links' }))
  const line = await waitFor(() => screen.getAllByTestId('tick-line').find((l) => l.textContent?.includes('Team Leader')) ?? Promise.reject(new Error('no line')))
  fireEvent.click(within(line).getByRole('button', { name: 'Tick Team Leader' }))
  const form = await screen.findByTestId('also-give-form')
  fireEvent.click(within(form).getByTestId('area-pick'))
  fireEvent.click(within(await within(form).findByTestId('area-picker')).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(within(form).queryByTestId('area-picker')).not.toBeInTheDocument())
  expect(within(form).getByTestId('area-pick')).toHaveTextContent('Pick on the trees ▸')
})
