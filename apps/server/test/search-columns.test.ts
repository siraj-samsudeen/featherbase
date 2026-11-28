// #1346: a Table can name more columns that search matches, besides a row's key
// and title. A match on one never reveals a value the viewer cannot read.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { createUserWithRole, grantRole, makeTable, searchLines } from './fixtures'
import { getMeta } from '../src/meta'
import { updateTable } from '../src/table-engine'
import { renameColumn } from '../src/table-rename'

const hitsIn = async (client: TestClient, query: string, table: string) =>
  ((await searchLines(client, query)).find((l) => (l as { table?: string }).table === table) as { hits: { title: string }[] } | undefined)
    ?.hits.map((h) => h.title) ?? []

describe('#1346: a Table\'s searched columns', () => {
  test('a row is found by a searched column and shows its title; a column not listed is not searched', async ({ admin }) => {
    const table = await makeTable(admin, {
      name: 'Sc Account', id_pattern: 'hash', title_column: 'full_name', search_columns: ['login'],
      columns: ['full_name', 'login', 'note'],
    })
    await admin.post(table.url, { full_name: 'Asha Reader', login: 'asha_reports', note: 'warehouse-only-note' })
    expect(await hitsIn(admin, 'asha_reports', table.name)).toEqual(['Asha Reader'])
    expect(await hitsIn(admin, 'ASHA_REP', table.name)).toEqual(['Asha Reader'])
    expect(await hitsIn(admin, 'warehouse-only-note', table.name)).toEqual([])
  })

  test('a searched column the viewer may not read never matches for them', async ({ admin, createUser }) => {
    const table = await makeTable(admin, {
      name: 'Sc Restricted', id_pattern: 'hash', title_column: 'full_name', search_columns: ['login'],
      columns: ['full_name', { column_name: 'login', column_type: 'Data', tier: 'restricted' }],
    })
    const basic = await createUserWithRole(admin, createUser, { role: 'Sc Basic Role', table: table.name, can_read: true })
    await grantRole(admin, { role: 'Sc Restricted Role', table: table.name, tier: 'restricted', can_read: true })
    const elevated = await createUser({ roles: ['Sc Basic Role', 'Sc Restricted Role'] })
    await admin.post(table.url, { full_name: 'Hidden Login Holder', login: 'sc_hidden_login' })
    expect(await hitsIn(basic, 'sc_hidden_login', table.name)).toEqual([])
    expect(await hitsIn(elevated, 'sc_hidden_login', table.name)).toEqual(['Hidden Login Holder'])
  })

  test('only a real column of the Table can be listed, never a stored secret; an update that leaves it out keeps it', async ({ admin }) => {
    for (const bad of ['no_such_column', 'details_break']) {
      const res = await admin.fetch('/api/table_def', { method: 'POST', body: JSON.stringify({ row_rule: { kind: 'all' },
        name: bad === 'no_such_column' ? 'Sc Bad Unknown' : 'Sc Bad Break', search_columns: [bad],
        columns: [{ column_name: 'label', column_type: 'Data' }, { column_name: 'details_break', column_type: 'Section Break' }],
      }) })
      expect(res.status, bad).toBe(417)
      expect(await res.json(), bad).toMatchObject({ error: { fields: { search_columns: `${bad} is not a column of this Table that search can match` } } })
    }
    // A column named like a stored secret is never searched.
    const secret = await admin.fetch('/api/table_def', { method: 'POST', body: JSON.stringify({ row_rule: { kind: 'all' },
      name: 'Sc Bad secret', search_columns: ['password_hash'], columns: [{ column_name: 'password_hash', column_type: 'Data' }] }) })
    expect(secret.status).toBe(417)
    const table = await makeTable(admin, { name: 'Sc Kept', search_columns: ['login'], columns: ['login', 'label'] })
    await updateTable(table.name, { name: table.name, description: 'changed', columns: [{ column_name: 'login', column_type: 'Data' }, { column_name: 'label', column_type: 'Data' }] })
    expect((await getMeta(table.name)).search_columns).toEqual(['login'])
    await updateTable(table.name, { name: table.name, search_columns: [], columns: [{ column_name: 'login', column_type: 'Data' }, { column_name: 'label', column_type: 'Data' }] })
    expect((await getMeta(table.name)).search_columns ?? null).toBeNull()
  })

  // Codex round 1: an override names search's columns as text, and a renamed column stays searched.
  test('a Metadata Override can name the searched columns, and search keeps answering', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Sc Overridden', id_pattern: 'hash', title_column: 'full_name', columns: ['full_name', 'login'] })
    await admin.post(table.url, { full_name: 'Override Holder', login: 'sc_override_login' })
    expect(await hitsIn(admin, 'sc_override_login', table.name)).toEqual([])
    await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: table.name, property: 'search_columns', value: 'login, no_such_column' } })
    expect((await getMeta(table.name)).search_columns).toEqual(['login'])
    expect(await hitsIn(admin, 'sc_override_login', table.name)).toEqual(['Override Holder'])

    // Codex round 2: an unrelated update never writes the override into the Table,
    // and renaming the column renames it in the override too.
    await updateTable(table.name, { name: table.name, description: 'changed', columns: [{ column_name: 'full_name', column_type: 'Data' }, { column_name: 'login', column_type: 'Data' }] })
    const { sql } = await import('../src/db')
    expect(await sql`select search_columns from table_def where name = ${table.name}`).toEqual([{ search_columns: null }])
    await renameColumn(table.name, 'login', 'warehouse_login')
    expect((await getMeta(table.name)).search_columns).toEqual(['warehouse_login'])
    expect(await hitsIn(admin, 'sc_override_login', table.name)).toEqual(['Override Holder'])
  })

  test('renaming a searched column keeps it searched', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Sc Renamed', id_pattern: 'hash', title_column: 'full_name', search_columns: ['login'], columns: ['full_name', 'login'] })
    await admin.post(table.url, { full_name: 'Renamed Holder', login: 'sc_renamed_login' })
    await renameColumn(table.name, 'login', 'warehouse_login')
    expect((await getMeta(table.name)).search_columns).toEqual(['warehouse_login'])
    expect(await hitsIn(admin, 'sc_renamed_login', table.name)).toEqual(['Renamed Holder'])
  })
})
