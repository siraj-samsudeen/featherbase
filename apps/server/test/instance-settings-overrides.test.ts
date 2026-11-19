// #1345: a settings file sets how an instance's own Tables are found and read (Employee folds into its
// Person and is found by its code) through Metadata Overrides, so it survives a wipe. Only an allowlist
// of properties, never who may read or change anything; applying twice changes nothing; replacing an
// override someone made by hand is said. Made-up Tables.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { applyInstanceSettings, exportInstanceSettings } from '../src/instance-settings'
import { getMeta } from '../src/meta'
import { makeTable } from './fixtures'

async function roster(admin: TestClient) {
  await makeTable(admin, { name: 'Iso Roster', id_pattern: 'field:roster_code', title_column: 'full_name',
    columns: ['roster_code', 'full_name', { column_name: 'person', column_type: 'Reference', reference_table: 'Person' }] })
}

const file = (overrides: Record<string, unknown>[]) => ({ settings: { 'Metadata Override': overrides } })
const fold = [
  { row_id: 'iso-roster-person', table_name: 'Iso Roster', property: 'person_column', value: 'person' },
  { row_id: 'iso-roster-search', table_name: 'Iso Roster', property: 'search_columns', value: 'roster_code' },
]

describe('#1345: a settings file sets Metadata Overrides from an allowlist', () => {
  test('it makes a Table a person\'s record found by its code; applying again changes nothing', async ({ admin }) => {
    await roster(admin)
    const first = await applyInstanceSettings(file(fold), { by: 'Administrator' })
    expect(first.changes.filter((c) => c.field === 'value').map((c) => [c.row_id, c.new])).toEqual([['iso-roster-person', 'person'], ['iso-roster-search', 'roster_code']])
    const meta = await getMeta('Iso Roster')
    expect([meta.person_column, meta.search_columns]).toEqual(['person', ['roster_code']])
    const again = await applyInstanceSettings(file(fold), { by: 'Administrator' })
    expect([again.changes, again.warnings]).toEqual([[], []])
  })

  test('a property outside the allowlist is refused, naming it, and nothing is saved', async ({ admin }) => {
    await roster(admin)
    for (const property of ['enable_files', 'sort_column', 'hidden']) {
      const row = { row_id: `iso-${property}`, table_name: 'Iso Roster', ...(property === 'hidden' ? { column_name: 'full_name' } : {}), property, value: '1' }
      await expect(applyInstanceSettings(file([...fold, row]), { by: 'Administrator' })).rejects.toThrow(`Metadata Override property ${property} cannot be set by the settings file`)
    }
    expect(await sql`select 1 from metadata_override where table_name = 'Iso Roster'`).toEqual([])
  })

  test('an override someone made by hand is replaced in place, and the apply says so', async ({ admin }) => {
    await roster(admin)
    await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: 'Iso Roster', property: 'search_columns', value: 'full_name' } })
    const result = await applyInstanceSettings(file(fold), { by: 'Administrator' })
    expect(result.warnings).toEqual(['Metadata Override Iso Roster search_columns: replaces an override someone made by hand ("full_name")'])
    const stored = await sql`select value from metadata_override where table_name = 'Iso Roster' and property = 'search_columns'`
    expect(stored).toEqual([{ value: 'roster_code' }])
    expect((await applyInstanceSettings(file(fold), { by: 'Administrator' })).changes).toEqual([])
  })

  test('an export carries the overrides a file may set, and leaves out the rest, saying so', async ({ admin }) => {
    await roster(admin)
    await applyInstanceSettings(file(fold), { by: 'Administrator' })
    await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: 'Iso Roster', property: 'sort_column', value: 'full_name' } })
    const [sort] = await sql`select row_id from metadata_override where table_name = 'Iso Roster' and property = 'sort_column'`
    const { file: exported, withheld } = await exportInstanceSettings()
    const rows = (exported.settings['Metadata Override'] as unknown as { table_name: string; property: string }[]).filter((r) => r.table_name === 'Iso Roster')
    expect(rows.map((r) => r.property).sort()).toEqual(['person_column', 'search_columns'])
    expect(withheld).toContain(`Metadata Override.${sort!.row_id}: sort_column is not set by a settings file`)
  })

  test('an override for a Table the instance does not have yet waits for the next apply; the rest applies', async ({ admin }) => {
    await roster(admin)
    const later = { row_id: 'iso-later', table_name: 'Iso Not Loaded Yet', property: 'person_column', value: 'person' }
    const result = await applyInstanceSettings(file([...fold, later]), { by: 'Administrator' })
    expect(result.warnings).toEqual(['Metadata Override Iso Not Loaded Yet person_column: the Table is not here yet; apply the file again once it is'])
    expect((await getMeta('Iso Roster')).person_column).toBe('person')
  })

  // Codex adversarial round 3: an allowed override may not take the row of one outside the allowlist.
  test("an override cannot take another override's row, so it never replaces one the file may not set", async ({ admin }) => {
    await roster(admin)
    await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: 'Iso Roster', column_name: 'full_name', property: 'read_only', value: '1' } })
    const [guarded] = await sql`select row_id from metadata_override where table_name = 'Iso Roster' and property = 'read_only'`
    const label = { row_id: String(guarded!.row_id), table_name: 'Iso Roster', column_name: 'full_name', property: 'label', value: 'Name' }
    await expect(applyInstanceSettings(file([label]), { by: 'Administrator' })).rejects.toThrow(`Metadata Override row ${String(guarded!.row_id)} is already another override (Iso Roster.full_name read_only)`)
    expect(await sql`select property, value from metadata_override where row_id = ${guarded!.row_id}`).toEqual([{ property: 'read_only', value: '1' }])
  })
})
