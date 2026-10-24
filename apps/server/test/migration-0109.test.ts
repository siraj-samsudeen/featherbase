// Migration 0109 (#380 stage 3): one colour palette, so Person's palette column,
// its column_def row and any Metadata Override on it go; the theme gains
// `device` as its default, and the old default `light` (stored for everyone who
// never chose) becomes `device`.
//
// The suite's database is already migrated, so each test first puts back what
// 0109 removes (the column as 0062 made it, its definition, an override, and
// the theme column's old choices) and only then runs the migration.
import { readFileSync } from 'node:fs'
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { makePerson } from './fixtures'

const MIGRATION = readFileSync(new URL('../migrations/0109_one_palette_theme_follows_device.sql', import.meta.url), 'utf8')

async function personColumns(): Promise<string[]> {
  const rows = await sql`select column_name from information_schema.columns where table_schema = 'featherbase' and table_name = 'person'`
  return rows.map((r) => String(r.column_name))
}

/** Person as it stood before 0109: a palette column with its definition, and a light/dark theme. */
async function before0109() {
  await sql`alter table person add column if not exists palette text`
  await sql`insert into column_def (parent, position, column_name, label, column_type, choices, default_value)
    values ('Person', 999, 'palette', 'Palette', 'Choice', ${'classic\nivory\ngraphite\nindigo'}, 'classic')`
  await sql`insert into metadata_override (row_id, table_name, column_name, property, value)
    values ('mo-palette-0109', 'Person', 'palette', 'label', 'Colour palette')`
  await sql`update column_def set choices = ${'light\ndark'}, default_value = 'light' where parent = 'Person' and column_name = 'theme'`
  invalidateMeta()
}

describe('0109: one palette, and the theme follows the device by default', () => {
  test('drops the palette column, its definition and its override; the theme offers device as its default', async ({ admin }) => {
    await before0109()
    expect(await personColumns()).toContain('palette')
    expect(await sql`select 1 from column_def where parent = 'Person' and column_name = 'palette'`).toHaveLength(1)

    await sql.unsafe(MIGRATION)
    invalidateMeta()

    expect(await personColumns()).not.toContain('palette')
    expect(await sql`select 1 from column_def where parent = 'Person' and column_name = 'palette'`).toHaveLength(0)
    expect(await sql`select 1 from metadata_override where table_name = 'Person' and column_name = 'palette'`).toHaveLength(0)
    const [theme] = await sql`select choices, default_value from column_def where parent = 'Person' and column_name = 'theme'`
    expect(theme).toEqual({ choices: 'light\ndark\ndevice', default_value: 'device' })
    const meta = await admin.get<{ columns: { column_name: string }[] }>('/api/table/Person:meta')
    expect(meta.columns.map((c) => c.column_name)).not.toContain('palette')
  })

  test('the old default and no choice follow the device; a dark choice stays dark; a palette value goes with its column', async () => {
    await before0109()
    const light = await makePerson({ full_name: 'Never Chose' })
    const unset = await makePerson({ full_name: 'Nothing Stored' })
    const dark = await makePerson({ full_name: 'Chose Dark' })
    await sql`update person set theme = 'light', palette = 'ivory' where row_id = ${light}`
    await sql`update person set theme = null where row_id = ${unset}`
    await sql`update person set theme = 'dark', palette = 'indigo' where row_id = ${dark}`

    await sql.unsafe(MIGRATION)

    const rows = await sql`select row_id, theme from person where row_id in ${sql([light, unset, dark])}`
    const theme = Object.fromEntries(rows.map((r) => [r.row_id, r.theme]))
    expect(theme).toEqual({ [light]: 'device', [unset]: 'device', [dark]: 'dark' })
    expect(await personColumns()).not.toContain('palette')
  })

  test('is a no-op the second time', async () => {
    await sql.unsafe(MIGRATION)
    const columns = await personColumns()
    await sql.unsafe(MIGRATION)
    expect(await personColumns()).toEqual(columns)
  })
})
