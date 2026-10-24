// Migration 0109 (#380 stage 3): one colour palette, so Person's palette column
// and its column_def row go; the theme gains `device` as its default, and the
// old default `light` (stored for everyone who never chose) becomes `device`.
import { readFileSync } from 'node:fs'
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { makePerson } from './fixtures'

const MIGRATION = readFileSync(new URL('../migrations/0109_one_palette_theme_follows_device.sql', import.meta.url), 'utf8')

describe('0109: one palette, and the theme follows the device by default', () => {
  test('the palette column and its definition are gone; the theme offers device as its default', async ({ admin }) => {
    await sql.unsafe(MIGRATION)
    invalidateMeta()
    const columns = await sql`select column_name from information_schema.columns where table_schema = 'featherbase' and table_name = 'person'`
    expect(columns.map((r) => r.column_name)).not.toContain('palette')
    expect(await sql`select 1 from column_def where parent = 'Person' and column_name = 'palette'`).toHaveLength(0)
    const [theme] = await sql`select choices, default_value from column_def where parent = 'Person' and column_name = 'theme'`
    expect(theme).toEqual({ choices: 'light\ndark\ndevice', default_value: 'device' })
    const meta = await admin.get<{ columns: { column_name: string }[] }>('/api/table/Person:meta')
    expect(meta.columns.map((c) => c.column_name)).not.toContain('palette')
  })

  test('the old default and no choice follow the device; a dark choice stays dark', async () => {
    const light = await makePerson({ full_name: 'Never Chose' })
    const unset = await makePerson({ full_name: 'Nothing Stored' })
    const dark = await makePerson({ full_name: 'Chose Dark' })
    await sql`update person set theme = 'light' where row_id = ${light}`
    await sql`update person set theme = null where row_id = ${unset}`
    await sql`update person set theme = 'dark' where row_id = ${dark}`

    await sql.unsafe(MIGRATION)

    const rows = await sql`select row_id, theme from person where row_id in ${sql([light, unset, dark])}`
    const theme = Object.fromEntries(rows.map((r) => [r.row_id, r.theme]))
    expect(theme).toEqual({ [light]: 'device', [unset]: 'device', [dark]: 'dark' })
  })
})
