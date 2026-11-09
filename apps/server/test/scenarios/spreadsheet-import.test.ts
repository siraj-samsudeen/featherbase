// spreadsheet-import's fenced scenarios that the server alone proves (#1070):
// the matching analysis a person without System Manager gets from the public
// :import endpoint. The Import Wizard requires System Manager, which bypasses
// column tiers, so these go through the API as the restricted person; never
// give that person System Manager to make the wizard open. The scenarios a
// person works through in the wizard are in apps/web/test/scenarios/.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { importedZones, populations, populationsOf, zoneCount, type ImportedZones } from '../reimport-zones'

const scenario = scenarioFor(test, 'spreadsheet-import')

/** A person whose role may read and append the zones, and change them only when `update`. */
async function importer(admin: TestClient, createUser: (o: { roles: string[] }) => Promise<TestClient>, table: string, update: boolean) {
  const role = `${table} Importer`
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: role } })
  for (const operation of ['read', 'create', ...(update ? ['update'] : [])])
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: table, role, operation } })
  return createUser({ roles: [role] })
}

async function analyzeKeys(person: TestClient, zones: ImportedZones) {
  const path = `/api/table/${encodeURIComponent(zones.table)}`
  const read = await person.get<{ total: number }>(`${path}?fields=${encodeURIComponent('["row_id","region"]')}`)
  expect(read.total).toBe(61)
  const res = await person.fetch(`${path}:import`, {
    method: 'POST',
    body: JSON.stringify({ analyze_keys: true, columns: ['zone_code'], rows: zones.rows.map(({ zone_code }) => ({ zone_code })) }),
  })
  expect(res.status).toBe(201)
  return res.json()
}

describe('spreadsheet-import', () => {
  scenario('An unreadable matching column is not offered', async ({ admin, createUser }, step) => {
    let zones!: ImportedZones
    let person!: TestClient
    let analysis: unknown
    await step('the user can read the zones but cannot read their zone codes', async () => {
      zones = await importedZones(admin, { restricted: true })
      person = await importer(admin, createUser, zones.table, true)
    })
    await step('the user prepares the identical zones file for another import', async () => {
      analysis = await analyzeKeys(person, zones)
    })
    await step('zone codes are not offered as a matching column or used to disclose overlap', () =>
      expect(analysis).toEqual({ key_candidates: [] }))
  })

  scenario('Readable overlap does not require permission to change rows', async ({ admin, createUser }, step) => {
    let zones!: ImportedZones
    let person!: TestClient
    let analysis: unknown
    await step('the user can read and append the zones but cannot change existing zones', async () => {
      zones = await importedZones(admin)
      person = await importer(admin, createUser, zones.table, false)
    })
    await step('the user checks overlap before appending the identical zones file', async () => {
      analysis = await analyzeKeys(person, zones)
    })
    await step('all 61 rows are reported as overlapping without an available matching key', async () => {
      expect(analysis).toEqual({ key_candidates: [{ column: 'zone_code', matched: 61, complete: true, can_match: false }] })
      expect(await zoneCount(admin, zones.table)).toBe(61)
      expect(await populations(admin, zones.table)).toEqual(populationsOf(zones.rows))
    })
  })
})
