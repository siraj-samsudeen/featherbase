// #1211: an agent reaches an upgraded app's Tables through /mcp. The browser's
// version check (a tab loaded before the upgrade is refused until it reloads)
// stays as it was: only the calls /mcp makes itself speak the installed version.
import { describe, expect } from 'vitest'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { sql } from '../src/db'
import { expectStatus } from './fixtures'
import { connectAgent, issueToken } from './agent-driver'
import type { TestClient } from 'feather-testing-postgres'

const SOURCE = resolve('../..', 'test-apps/other')

/** test-apps/other at 2.0.0, with one migration, so an upgrade leaves a non-empty migration_ledger. */
async function upgradedPackage() {
  const directory = await mkdtemp(resolve('test/.upgrade-'))
  await cp(SOURCE, directory, { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(directory, 'featherbase.json'), 'utf8'))
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  const column = { column_name: 'notes', label: 'Notes', column_type: 'Text' }
  manifest.tables[0].columns.push(column)
  manifest.migrations = [{ id: 'add_notes', fromVersion: pkg.version, toVersion: '2.0.0',
    operations: [{ kind: 'addColumn', table: 'other.task', column }] }]
  await writeFile(resolve(directory, 'package.json'), JSON.stringify({ ...pkg, version: '2.0.0' }))
  await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(manifest))
  return directory
}

async function installThenUpgrade(admin: TestClient, directory: string) {
  await discoverPackages([SOURCE])
  await admin.post('/api/install_app', { name: 'other' })
  await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'counted-before-upgrade', quantity: 37 } })
  await discoverPackages([SOURCE, directory])
  await loadInstalledApps()
  const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
  await admin.post('/api/upgrade_app', { name: 'other', version: '2.0.0', planId: plan.planId })
  await discoverPackages([SOURCE, directory])
  await loadInstalledApps()
  await admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })
  expect(await sql`select package_version, jsonb_array_length(migration_ledger) as steps from installed_app where name = 'other'`)
    .toEqual([{ package_version: '2.0.0', steps: 1 }])
}

describe('#1211 /mcp on an upgraded app', () => {
  test('an agent reads and adds rows on the upgraded app\'s Table', async ({ admin }) => {
    const directory = await upgradedPackage()
    try {
      await installThenUpgrade(admin, directory)
      const agent = await connectAgent(await issueToken(admin))
      const page = await agent.ok<{ rows: { row_id: string; quantity: number }[] }>('query_rows', { table: 'other.task' })
      expect(page.rows).toContainEqual(expect.objectContaining({ row_id: 'counted-before-upgrade', quantity: 37 }))
      const created = await agent.ok<{ row_id: string; notes: string }>('create_row', { table: 'other.task', values: { row_id: 'added-by-agent', quantity: 83, notes: 'added by an agent' } })
      expect(created).toMatchObject({ notes: 'added by an agent' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('a browser tab still naming the old version is refused until it reloads', async ({ admin }) => {
    const directory = await upgradedPackage()
    try {
      await installThenUpgrade(admin, directory)
      const read = (headers: Record<string, string>) => admin.fetch('/api/table/other.task', { headers })
      const stale = await read({ 'X-Featherbase-App-Version': 'other@0.0.1' })
      await expectStatus(stale, 409)
      expect(await stale.json()).toMatchObject({ error: { type: 'ConflictError', message: expect.stringMatching(/App other was upgraded/) } })
      // A browser request naming no version is a stale client too: the server fills nothing in for it.
      await expectStatus(await read({}), 409)
      await expectStatus(await read({ 'X-Featherbase-App-Version': 'other@2.0.0' }), 200)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('an access token on the REST path keeps the browser rule: an old version it names is refused', async ({ admin }) => {
    const directory = await upgradedPackage()
    try {
      await installThenUpgrade(admin, directory)
      const token = await issueToken(admin)
      // The REST path with an access token is not /mcp: an old version named there is still refused.
      const res = await admin.fetch('/api/table/other.task', { headers: { authorization: `Bearer ${token}`, 'X-Featherbase-App-Version': 'other@0.0.1' } })
      await expectStatus(res, 409)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
