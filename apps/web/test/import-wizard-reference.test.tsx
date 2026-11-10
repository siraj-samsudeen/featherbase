// #1014: a new Table's link column. The wizard offered Reference as a type, but
// nothing asked which Table it links to, so the Table could not be made with a
// working link. Requests and refusals are the real server's.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableSlug } from 'shared'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'
import { makeTable } from 'server/test/fixtures'

type Admin = Parameters<typeof renderApp>[1]

const CSV = 'store_name,cluster\nEast,VLM\nWest,NOPE\nNorth,VLM\n'

async function clusters(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Iwl Cluster',
    id_pattern: 'field:cluster_code',
    title_column: 'cluster_name',
    columns: [
      { column_name: 'cluster_code', column_type: 'Data' },
      { column_name: 'cluster_name', column_type: 'Data' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Iwl Cluster', row: { cluster_code: 'VLM', cluster_name: 'Vellayambalam' } })
}

async function upload(csv: string, name: string) {
  const bytes = new TextEncoder().encode(csv).buffer
  const file = new File([bytes], name, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
}

/** The file open in the wizard, as a new Table, with its link column typed Reference. */
async function openNewTable(admin: Admin, table = 'Iwl Store', csv = CSV) {
  clearSession()
  await renderApp('/featherbase/admin/import', admin)
  await upload(csv, 'stores.csv')
  const name = await screen.findByTestId('iw-new-name-0', undefined, { timeout: 8000 })
  fireEvent.change(name, { target: { value: table } })
  const row = linkRow()
  setType(row, 'Reference')
  return row
}

const linkRow = () => [...document.querySelectorAll<HTMLElement>('[data-columnrow]')].find((r) => within(r).queryByText('cluster'))!
const setType = (row: HTMLElement, type: string) => fireEvent.change(row.querySelector('[data-rowfield="column_type"]')!, { target: { value: type } })
const toggleUse = (row: HTMLElement) => fireEvent.click(row.querySelector('[data-rowfield="include"]')!)
const picker = (row: HTMLElement) => within(row).getByRole('combobox', { name: 'Table Cluster links to' }) as HTMLSelectElement

test('choosing Reference shows a picker of the Tables the person can read, and only then', async ({ admin }) => {
  await clusters(admin)
  await makeTable(admin, { name: 'Iwl Secret', access_policy: { version: 1, roles: ['Iwl Member'] }, columns: ['note'] })
  await makeTable(admin, { name: 'Iwl Archived', columns: ['note'] })
  await admin.post(`/api/table_def/${encodeURIComponent('Iwl Archived')}/archive`, { note: 'old' })
  const row = await openNewTable(admin)

  await waitFor(() => expect(within(picker(row)).getByRole('option', { name: 'Iwl Cluster' })).toBeInTheDocument())
  expect(within(picker(row)).queryByRole('option', { name: 'Iwl Archived' })).not.toBeInTheDocument()

  setType(row, 'Data')
  expect(within(row).queryByRole('combobox', { name: 'Table Cluster links to' })).not.toBeInTheDocument()
  clearSession()
})

test('Import waits for the Table, saying which column needs one', async ({ admin }) => {
  await clusters(admin)
  const row = await openNewTable(admin)
  expect(screen.getByTestId('iw-import')).toBeDisabled()
  expect(screen.getByTestId('iw-links-unpicked')).toHaveTextContent('Choose the Table that Cluster links to')

  toggleUse(row)
  expect(screen.getByTestId('iw-import')).toBeEnabled()
  expect(screen.queryByTestId('iw-links-unpicked')).not.toBeInTheDocument()

  toggleUse(row)
  await waitFor(() => expect(within(picker(row)).getByRole('option', { name: 'Iwl Cluster' })).toBeInTheDocument())
  fireEvent.change(picker(row), { target: { value: 'Iwl Cluster' } })
  expect(screen.getByTestId('iw-import')).toBeEnabled()
  clearSession()
})

test('Check names a value with no row in the target, and makes nothing', async ({ admin }) => {
  await clusters(admin)
  const row = await openNewTable(admin)
  await waitFor(() => expect(within(picker(row)).getByRole('option', { name: 'Iwl Cluster' })).toBeInTheDocument())
  fireEvent.change(picker(row), { target: { value: 'Iwl Cluster' } })

  fireEvent.click(screen.getByTestId('iw-check'))
  const report = await screen.findByTestId('iw-check-0')
  expect(report).toHaveTextContent('2 rows ready, 1 with problems')
  expect(report).toHaveTextContent('row 3: "NOPE" is not a row of Iwl Cluster')
  expect(report).toHaveTextContent('Links match a row\'s ID')
  await expect(admin.get(`/api/table/${encodeURIComponent('Iwl Store')}:meta`)).rejects.toMatchObject({ status: 404 })
  clearSession()
})

test('a value matches a row by its ID: a name matches a Table named by name, not one keyed by code', async ({ admin }) => {
  await clusters(admin)
  await admin.post('/api/table_def', {
    name: 'Iwl Zone',
    id_pattern: 'field:zone_name',
    columns: [{ column_name: 'zone_name', column_type: 'Data' }],
  })
  await admin.post('/api/save_row', { table: 'Iwl Zone', row: { zone_name: 'Vellayambalam' } })
  const row = await openNewTable(admin, 'Iwl Store', 'store_name,cluster\nEast,Vellayambalam\n')
  await waitFor(() => expect(within(picker(row)).getByRole('option', { name: 'Iwl Zone' })).toBeInTheDocument())

  fireEvent.change(picker(row), { target: { value: 'Iwl Cluster' } })
  fireEvent.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-check-0')).toHaveTextContent('"Vellayambalam" is not a row of Iwl Cluster')

  fireEvent.change(picker(row), { target: { value: 'Iwl Zone' } })
  fireEvent.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-check-0')).toHaveTextContent('The 1 row links to a row')
  clearSession()
})

test('a retired target row still matches, as saving the link accepts it', async ({ admin }) => {
  await clusters(admin)
  await admin.post(`/api/table/${encodeURIComponent('Iwl Cluster')}/VLM:retire`, { reason: 'closed' })
  const row = await openNewTable(admin, 'Iwl Store', 'store_name,cluster\nEast,VLM\n')
  await waitFor(() => expect(within(picker(row)).getByRole('option', { name: 'Iwl Cluster' })).toBeInTheDocument())
  fireEvent.change(picker(row), { target: { value: 'Iwl Cluster' } })
  fireEvent.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-check-0')).toHaveTextContent('The 1 row links to a row')
  clearSession()
})

test('importing makes the link: good rows land, and a row with no match is reported', async ({ admin }) => {
  await clusters(admin)
  const row = await openNewTable(admin)
  await waitFor(() => expect(within(picker(row)).getByRole('option', { name: 'Iwl Cluster' })).toBeInTheDocument())
  fireEvent.change(picker(row), { target: { value: 'Iwl Cluster' } })
  fireEvent.click(screen.getByTestId('iw-import'))
  await waitFor(async () => {
    const list = await admin.get<{ total: number }>(`/api/table/${encodeURIComponent('Iwl Store')}?limit_page_length=10`)
    expect(list.total).toBe(2)
  }, { timeout: 8000 })
  const meta = await admin.get<{ columns: { column_name: string; column_type: string; reference_table: string | null }[] }>(`/api/table/${encodeURIComponent('Iwl Store')}:meta`)
  expect(meta.columns.find((c) => c.column_name === 'cluster')).toMatchObject({ column_type: 'Reference', reference_table: 'Iwl Cluster' })
  expect(await screen.findByTestId('iw-results', undefined, { timeout: 8000 })).toHaveTextContent('Iwl Store')
  clearSession()
})

// Moved from the deleted e2e/import-reference-column.spec.ts: the imported
// link works as a link — the new Table's list reads it by the linked row's
// title, and its address is that row's page.
test('the imported link reads by the linked row\'s title in the new list, and leads to that row', async ({ admin }) => {
  await clusters(admin)
  const row = await openNewTable(admin)
  await waitFor(() => expect(within(picker(row)).getByRole('option', { name: 'Iwl Cluster' })).toBeInTheDocument())
  fireEvent.change(picker(row), { target: { value: 'Iwl Cluster' } })
  fireEvent.click(screen.getByTestId('iw-import'))
  await screen.findByTestId('iw-results', undefined, { timeout: 8000 })
  clearSession()
  cleanup()

  await renderApp(`/featherbase/admin/table/${tableSlug('Iwl Store')}`, admin)
  const links = await screen.findAllByRole('link', { name: /Vellayambalam/ }, { timeout: 8000 })
  expect(links).toHaveLength(2)
  const href = links[0].getAttribute('href')!
  expect(href).toMatch(/\/row\/VLM$/)
  cleanup()
  await renderApp(href, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(document.querySelector('[data-field=cluster_name]')).toHaveValue('Vellayambalam'))
})

// The verifier's find on #1014: the ids being checked travel in a read's
// address, and 600 long ones passed the real Node server's 16 KB header limit
// (431). The in-process server has no such limit, so the addresses are measured.
test('Check reads many long values in reads whose addresses stay under the server\'s 16 KB limit', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Iwl Long Names', id_pattern: 'field:zone_name', columns: [{ column_name: 'zone_name', column_type: 'Data' }] })
  const value = (i: number) => `Vellayambalam Regional Distribution Centre ${String(i).padStart(4, '0')}`
  await admin.post('/api/save_row', { table: 'Iwl Long Names', row: { zone_name: value(0) } })
  const csv = ['store_name,zone', ...Array.from({ length: 600 }, (_, i) => `S${i},${value(i)}`)].join('\n')

  clearSession()
  await renderApp('/featherbase/admin/import', admin)
  await upload(csv, 'long.csv')
  fireEvent.change(await screen.findByTestId('iw-new-name-0', undefined, { timeout: 8000 }), { target: { value: 'Iwl Long Stores' } })
  const zone = [...document.querySelectorAll<HTMLElement>('[data-columnrow]')].find((r) => within(r).queryByText('zone'))!
  setType(zone, 'Reference')
  const zonePicker = within(zone).getByRole('combobox', { name: 'Table Zone links to' })
  await waitFor(() => expect(within(zonePicker).getByRole('option', { name: 'Iwl Long Names' })).toBeInTheDocument())
  fireEvent.change(zonePicker, { target: { value: 'Iwl Long Names' } })

  const connected = globalThis.fetch
  const reads: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes(encodeURIComponent('Iwl Long Names'))) reads.push(url)
    return connected(input, init)
  })
  fireEvent.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-check-0', undefined, { timeout: 15_000 })).toHaveTextContent('1 row ready, 599 with problems')
  expect(reads.length).toBeGreaterThan(1)
  for (const url of reads) expect(new TextEncoder().encode(url).length).toBeLessThan(16 * 1024)
  clearSession()
})

test('a link column whose display name was cleared is named by its column name', async ({ admin }) => {
  await clusters(admin)
  const row = await openNewTable(admin)
  fireEvent.change(row.querySelector('[data-rowfield="label"]')!, { target: { value: '' } })
  expect(within(row).getByRole('combobox', { name: 'Table cluster links to' })).toBeInTheDocument()
  expect(screen.getByTestId('iw-links-unpicked')).toHaveTextContent('Choose the Table that cluster links to before importing.')
  clearSession()
})

test('two link columns waiting for their Tables are named together', async ({ admin }) => {
  await clusters(admin)
  await openNewTable(admin, 'Iwl Store', 'store_name,cluster,zone\nEast,VLM,Z1\n')
  const zone = [...document.querySelectorAll<HTMLElement>('[data-columnrow]')].find((r) => within(r).queryByText('zone'))!
  setType(zone, 'Reference')
  expect(screen.getByTestId('iw-links-unpicked')).toHaveTextContent('Choose the Table that Cluster, Zone link to before importing.')
  clearSession()
})

test('a link set back to Choose a Table waits for its Table again', async ({ admin }) => {
  await clusters(admin)
  const row = await openNewTable(admin)
  await waitFor(() => expect(within(picker(row)).getByRole('option', { name: 'Iwl Cluster' })).toBeInTheDocument())
  fireEvent.change(picker(row), { target: { value: 'Iwl Cluster' } })
  expect(screen.getByTestId('iw-import')).toBeEnabled()
  fireEvent.change(picker(row), { target: { value: '' } })
  expect(screen.getByTestId('iw-import')).toBeDisabled()
  expect(screen.getByTestId('iw-links-unpicked')).toHaveTextContent('Choose the Table that Cluster links to')
  clearSession()
})

test('Check with every row matched says they all link to a row in their Table', async ({ admin }) => {
  await clusters(admin)
  const row = await openNewTable(admin, 'Iwl Store', 'store_name,cluster\nEast,VLM\nWest,VLM\n')
  await waitFor(() => expect(within(picker(row)).getByRole('option', { name: 'Iwl Cluster' })).toBeInTheDocument())
  fireEvent.change(picker(row), { target: { value: 'Iwl Cluster' } })
  fireEvent.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-check-0')).toHaveTextContent('✓ All 2 rows link to a row in their Table')
  clearSession()
})

test('Check with a link column left blank in every row reads no Table and passes the rows', async ({ admin }) => {
  await clusters(admin)
  const row = await openNewTable(admin, 'Iwl Store', 'store_name,cluster\nEast,\nWest,\n')
  await waitFor(() => expect(within(picker(row)).getByRole('option', { name: 'Iwl Cluster' })).toBeInTheDocument())
  fireEvent.change(picker(row), { target: { value: 'Iwl Cluster' } })
  fireEvent.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-check-0')).toHaveTextContent('✓ All 2 rows link to a row in their Table')
  clearSession()
})
