// #1454: the `scopedproof` app (a Table about places, mapped on store and section) and the place provider, for the
// place-scope tests and their spec scenarios. Every row is made up.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TestClient } from 'feather-testing-postgres'
import { expect } from 'vitest'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'

export const APP = 'scopedproof'
export const ANSWER = `${APP}.answer`
export const REASON = `${APP}.answer_reason`
const provider = resolve('../..', 'test-apps/fixtures/place-roster')

export const manifest = (more: Record<string, unknown> = {}) => ({
  manifestVersion: 1, platformVersion: '2026-10', name: APP, title: 'Scoped Table proof', entryTable: `${APP}.entry`,
  tables: [
    { name: `${APP}.entry`, label: 'entry', id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] },
    { name: REASON, label: 'answer reason', kind: 'sub_table', columns: [{ column_name: 'code', column_type: 'Data' }] },
    { name: ANSWER, label: 'answer', id_pattern: 'prompt', columns: [{ column_name: 'store', column_type: 'Data' }, { column_name: 'section', column_type: 'Data' },
      { column_name: 'body', column_type: 'Data' }, { column_name: 'notes', column_type: 'Text' },
      { column_name: 'reasons', column_type: 'Sub-table', row_table: REASON }] },
  ],
  roles: ['Answer Reader'],
  permissions: [
    { table: `${APP}.entry`, role: 'Answer Reader', can_read: true },
    { table: ANSWER, role: 'Answer Reader', can_read: true, can_write: true, can_create: true },
    { table: REASON, role: 'Answer Reader', can_read: true, can_write: true, can_create: true },
  ],
  rowRules: { [`${APP}.entry`]: { kind: 'all' }, [ANSWER]: { kind: 'places', columns: { store: 'store', section: 'section' } } },
  ...more,
})

const folders: string[] = []
/** Remove the app folders written so far (call from afterEach). */
export async function removeScopedFolders() { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) }
export async function writeApp(more: Record<string, unknown> = {}) {
  const dir = await mkdtemp(resolve('test/.scoped-proof-'))
  folders.push(dir)
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `featherbase-${APP}`, version: '1.0.0', type: 'module' }))
  await writeFile(join(dir, 'featherbase.json'), JSON.stringify(manifest(more)))
  return dir
}

/** Installs the app and the place provider, and seeds four answers at two stores (two of them with two reasons). */
export async function installed(admin: TestClient) {
  expect(await discoverPackages([await writeApp(), provider])).toEqual([])
  await admin.post('/api/install_app', { name: APP })
  await admin.post('/api/install_app', { name: 'placeroster' })
  for (const [row_id, store, section, body] of [['a1', 'N1', 'kids', 'north kids'], ['a2', 'N1', 'mens', 'north mens'],
    ['a3', 'S1', 'kids', 'south kids'], ['a4', 'S1', 'mens', 'south mens']])
    await admin.post('/api/save_row', { table: ANSWER, row: { row_id, store, section, body, notes: 'made up',
      reasons: row_id === 'a1' || row_id === 'a4' ? [{ code: `${row_id}-stockout` }, { code: `${row_id}-festival` }] : [] } })
}

/** Every made-up person's places, while `run` runs: the provider answers `places` for everyone. */
export async function withPlaces<T>(places: unknown, run: () => Promise<T>): Promise<T> {
  const digest = availableRuntimeVersions().find((p) => p.name === 'placeroster')!.digest
  const roster = await import(`${pathToFileURL(resolve(provider, 'server.mjs')).href}?artifact=${digest}`) as { faults: { result?: unknown } }
  roster.faults.result = places
  try { return await run() } finally { delete roster.faults.result }
}
export const ids = (rows: { row_id: string }[]) => rows.map((row) => row.row_id).sort()
export const list = async (client: TestClient, table = ANSWER, filters: unknown[] = []) =>
  (await client.get<{ data: { row_id: string }[] }>(`/api/table/${encodeURIComponent(table)}?${new URLSearchParams({ filters: JSON.stringify(filters), limit_page_length: '500' })}`)).data
export const NORTH_AND_SOUTH_KIDS = [{ label: 'North', filters: { store: ['N1'] } }, { label: 'South kids', filters: { store: ['S1'], section: ['kids'] } }]

