// The zones a spreadsheet-import scenario re-imports (#1070): a table of 61
// (or more) made-up zones, imported through the public :import endpoint the
// way a first import lands them. Shared by the server and web scenario tests.
import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

export type Zone = { row_id: string; zone_code: string; region: string; population: number }

export function zones(count = 61): Zone[] {
  return Array.from({ length: count }, (_, i) => ({
    row_id: `ZONE-${String(i + 1).padStart(3, '0')}`,
    zone_code: `Z${String(i + 1).padStart(3, '0')}`,
    region: 'North',
    population: 1000 + i,
  }))
}

export const zonesCsv = (rows: Zone[]) =>
  ['Zone Code,Region,Population', ...rows.map((r) => `${r.zone_code},${r.region},${r.population}`)].join('\n')

export type ImportedZones = { table: string; rows: Zone[] }

export type ZoneOptions = {
  corrected?: boolean
  history?: boolean
  count?: number
  keyed?: boolean
  repeated?: boolean
  restricted?: boolean
}

export async function importedZones(admin: TestClient, opts: ZoneOptions = {}): Promise<ImportedZones> {
  const { corrected = false, history = true, count = 61, keyed = false, repeated = false, restricted = false } = opts
  const table = `Reimport Zones ${randomUUID().slice(0, 8)}`
  const rows = zones(count)
  if (repeated) rows[1]!.zone_code = rows[0]!.zone_code
  await admin.post('/api/table_def', {
    name: table,
    columns: [
      { column_name: 'zone_code', label: 'Zone Code', column_type: 'Data', in_list_view: true, ...(restricted ? { tier: 'restricted' } : {}) },
      { column_name: 'region', label: 'Region', column_type: 'Data' },
      { column_name: 'population', label: 'Population', column_type: 'Int' },
    ],
  })
  // No public setting exposes this metadata flag.
  if (!history) {
    await sql`update table_def set track_changes = false where name = ${table}`
    invalidateMeta()
  }
  const runId = randomUUID()
  for (let start = 0; start < rows.length; start += 500) {
    const result = await admin.post<{ inserted: number; failed: unknown[] }>(`/api/table/${encodeURIComponent(table)}:import`, {
      rows: rows.slice(start, start + 500), ...(keyed ? { key_column: 'zone_code' } : {}),
      context: { run_id: runId, file_name: 'zones.csv' },
    })
    expect(result.inserted).toBe(Math.min(500, rows.length - start))
    expect(result.failed).toEqual([])
  }
  if (corrected) {
    const first = await admin.get<{ updated_at: string }>(`/api/table/${encodeURIComponent(table)}/${rows[0]!.row_id}`)
    const res = await admin.fetch(`/api/table/${encodeURIComponent(table)}/${rows[0]!.row_id}`, {
      method: 'PATCH', body: JSON.stringify({ region: 'South', updated_at: first.updated_at }),
    })
    expect(res.status).toBe(200)
    expect((await admin.get<{ region: string }>(`/api/table/${encodeURIComponent(table)}/${rows[0]!.row_id}`)).region).toBe('South')
  }
  expect((await admin.get<{ track_changes: boolean }>(`/api/table/${encodeURIComponent(table)}:meta`)).track_changes).toBe(history)
  return { table, rows }
}

export async function zoneCount(admin: TestClient, table: string) {
  return (await admin.get<{ count: number }>(`/api/table/${encodeURIComponent(table)}:count`)).count
}

/** Every zone's population by zone code, as stored. */
export async function populations(admin: TestClient, table: string) {
  const fields = encodeURIComponent('["zone_code","population"]')
  const rows: { zone_code: string; population: number }[] = []
  for (let start = 0; ; ) {
    const page = await admin.get<{ data: { zone_code: string; population: number }[]; total: number }>(
      `/api/table/${encodeURIComponent(table)}?fields=${fields}&order_by=row_id%20asc&limit_page_length=500&limit_start=${start}`,
    )
    rows.push(...page.data)
    if (page.data.length === 0 || rows.length >= page.total) break
    start += page.data.length
  }
  return Object.fromEntries(rows.map((row) => [row.zone_code, row.population]))
}

export const populationsOf = (rows: Zone[]) => Object.fromEntries(rows.map((row) => [row.zone_code, row.population]))

/**
 * Dates the zones table and its first import back (the table first, as it was
 * made first), so import history lists a later run first: in the test's one
 * transaction now() never moves. History older than the table is a previous
 * table's of the same name and is hidden, so both move together.
 */
export async function importedEarlier(table: string) {
  await sql`update table_def set created_at = created_at - interval '2 hours' where name = ${table}`
  await sql`update import_log set created_at = created_at - interval '1 hour' where ref_table = ${table}`
  invalidateMeta()
}
