import { expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { choiceLabel } from 'shared'
import { test } from './pg-test'
import { expectRefused, expectStatus, makeTable, patchDoc } from './fixtures'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { reapplyCustomFields } from '../src/custom-fields'
import { renderPrintHtml } from '../src/print'
import { getWebFormConfig } from '../src/webform'
import { discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { applyMigrations, migrationSchema } from '../src/runtime-migrations'

const labels = { raw_value: 'Readable value' }

test('HTTP metadata preserves authored Choice display labels', async ({ admin }) => {
  const table = await makeTable(admin, {
    name: 'Readable Choices',
    columns: [{ column_name: 'policy', column_type: 'Choice', choices: 'raw_value\nother_value', choice_labels: labels }],
  })
  const meta = await admin.get<{ columns: Record<string, unknown>[] }>(table.metaUrl)
  expect(meta.columns.find(c => c.column_name === 'policy')?.choice_labels).toEqual(labels)
})

test('HTTP generated labels recognize identifier acronyms', async ({ admin }) => {
  const table = await makeTable(admin, {
    name: 'Readable Defaults',
    columns: ['client_id', 'service_url', 'api_key', 'sql_query', 'json_settings', { column_name: 'authored_id', column_type: 'Data', label: 'Authored id' }],
  })
  const meta = await admin.get<{ columns: { label: string }[] }>(table.metaUrl)
  expect(meta.columns.map(c => c.label)).toEqual(['Client ID', 'Service URL', 'API Key', 'SQL Query', 'JSON Settings', 'Authored id'])
})

test('HTTP Choice values remain canonical', async ({ admin }) => {
  const table = await makeTable(admin, {
    name: 'Readable Stored Choices',
    columns: [{ column_name: 'policy', column_type: 'Choice', choices: 'raw_value\nother_value', choice_labels: labels }],
  })
  const row = await admin.post<{ row_id: string }>('/api/save_row', { table: table.name, row: { policy: 'raw_value' } })
  expect(await admin.get(table.rowUrl(row.row_id))).toMatchObject({ policy: 'raw_value' })
  const listed = await admin.get<{ data: Record<string, unknown>[] }>(table.listUrl({ filters: [['policy', '=', 'raw_value']] }))
  expect(listed.data).toHaveLength(1)
  await expectRefused(admin.post('/api/save_row', { table: table.name, row: { policy: 'Readable value' } }), 417)
})

test('HTTP definition update round-trips Choice labels', async ({ admin }) => {
  const table = await makeTable(admin, {
    name: 'Readable Definition',
    columns: [{ column_name: 'policy', column_type: 'Choice', choices: 'raw_value', choice_labels: labels }],
  })
  const definition = await admin.get<Record<string, unknown>>(table.metaUrl)
  const response = await admin.fetch(table.defUrl, { method: 'PUT', body: JSON.stringify(definition) })
  await expectStatus(response, 200)
  const meta = await admin.get<{ columns: Record<string, unknown>[] }>(table.metaUrl)
  expect(meta.columns[0].choice_labels).toEqual(labels)
})

test('HTTP customizations preserve Choice display labels', async ({ admin }) => {
  const table = await makeTable(admin, { name: 'Readable Customizations', columns: ['title'] })
  const custom = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Custom Field', row: {
    row_id: 'readable-policy', dt: table.name, column_name: 'policy', column_type: 'Choice', choices: 'raw_value', choice_labels: labels,
  } })
  const exportUrl = `/api/export_customizations/${encodeURIComponent(table.name)}`
  const bundle = await admin.get<{ custom_fields: Record<string, unknown>[] }>(exportUrl)
  expect(bundle.custom_fields[0].choice_labels).toEqual(labels)
  await admin.delete(`/api/table/Custom%20Field/${encodeURIComponent(custom.row_id)}`)
  await admin.post('/api/import_customizations', bundle)
  const meta = await admin.get<{ columns: Record<string, unknown>[] }>(table.metaUrl)
  expect(meta.columns.find(c => c.column_name === 'policy')).toMatchObject({ label: 'Policy', choice_labels: labels })
})

test('HTTP custom field updates refresh the authored mapping', async ({ admin }) => {
  const table = await makeTable(admin, { name: 'Readable Custom Update', columns: ['title'] })
  const custom = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'Custom Field', row: {
    row_id: 'readable-update', dt: table.name, column_name: 'api_policy', column_type: 'Choice', choices: 'raw_value', choice_labels: labels,
  } })
  await patchDoc(admin, `/api/table/Custom%20Field/${custom.row_id}`, { updated_at: custom.updated_at, choice_labels: { raw_value: 'Updated wording' } })
  const meta = await admin.get<{ columns: Record<string, unknown>[] }>(table.metaUrl)
  expect(meta.columns.find(c => c.column_name === 'api_policy')).toMatchObject({ label: 'API Policy', choice_labels: { raw_value: 'Updated wording' } })
  const current = await admin.get<{ updated_at: string }>(`/api/table/Custom%20Field/${custom.row_id}`)
  await expect(patchDoc(admin, `/api/table/Custom%20Field/${custom.row_id}`, {
    updated_at: current.updated_at, choice_labels: { raw_value: 42 },
  })).rejects.toMatchObject({ status: 417, type: 'ValidationError' })
  await sql`delete from column_def where parent = ${table.name} and column_name = 'api_policy'`
  invalidateMeta(table.name)
  await reapplyCustomFields()
  const reapplied = await admin.get<{ columns: Record<string, unknown>[] }>(table.metaUrl)
  expect(reapplied.columns.find(c => c.column_name === 'api_policy')?.choice_labels).toEqual({ raw_value: 'Updated wording' })
})

test('HTTP custom fields reject malformed Choice label maps', async ({ admin }) => {
  const table = await makeTable(admin, { name: 'Readable Invalid Labels', columns: ['title'] })
  for (const choice_labels of [{ raw_value: 42 }, ['Readable value'], 'Readable value']) {
    await expect(admin.post('/api/save_row', { table: 'Custom Field', row: {
      row_id: 'readable-invalid', dt: table.name, column_name: 'policy', column_type: 'Choice', choices: 'raw_value', choice_labels,
    } })).rejects.toMatchObject({ status: 417, type: 'ValidationError' })
  }
})

test('Choice presentation resolves exact own keys only', () => {
  expect(choiceLabel('raw_value', labels)).toBe('Readable value')
  expect(choiceLabel('unknown_value', labels)).toBe('unknown_value')
  expect(choiceLabel('constructor', labels)).toBe('constructor')
  expect(choiceLabel('toString', labels)).toBe('toString')
  expect(choiceLabel('__proto__', labels)).toBe('__proto__')
  expect(choiceLabel('raw_value', Object.create(labels))).toBe('raw_value')
  expect(choiceLabel('RAW_VALUE', labels)).toBe('RAW_VALUE')
  expect(choiceLabel('raw_value', null)).toBe('raw_value')
})

test('Choice presentation preserves legacy translations', () => {
  const translations: Record<string, string> = { raw_value: 'Legacy translation', 'Readable value': 'New translation' }
  expect(choiceLabel('raw_value', labels, text => translations[text] ?? text)).toBe('Legacy translation')
  expect(choiceLabel('raw_value', labels, text => text === 'Readable value' ? 'New translation' : text)).toBe('New translation')
})

test('public form metadata carries authored Choice labels', async ({ admin }) => {
  const table = await makeTable(admin, { name: 'Readable Public', columns: [{ column_name: 'policy', column_type: 'Choice', choices: 'raw_value', choice_labels: labels }] })
  await admin.post('/api/save_row', { table: 'Web Form', row: { row_id: 'readable-public', title: 'Readable', route: 'readable-public', ref_table: table.name, web_fields: ['policy'], published: true } })
  expect((await getWebFormConfig('readable-public')).columns[0]).toMatchObject({ choice_labels: labels })
})

test('server print uses authored scalar Choice labels', async ({ admin }) => {
  const table = await makeTable(admin, { name: 'Readable Print', columns: [{ column_name: 'policy', column_type: 'Choice', choices: 'raw_value', choice_labels: { raw_value: 'Readable <value>' } }] })
  const row = await admin.post<{ row_id: string }>('/api/save_row', { table: table.name, row: { policy: 'raw_value' } })
  const html = await renderPrintHtml(table.name, row.row_id, 'Administrator', 'standard', 'none')
  expect(html).toContain('<dd>Readable &lt;value&gt;</dd>')
})

test('runtime package snapshots retain Choice display metadata', async ({ admin }) => {
  const directory = await mkdtemp(resolve('test/.readable-package-'))
  try {
    await cp(resolve('../..', 'test-apps/other'), directory, { recursive: true })
    const manifestPath = resolve(directory, 'featherbase.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.tables[0].columns.push({ column_name: 'policy', column_type: 'Choice', choices: 'raw_value', choice_labels: labels })
    await writeFile(manifestPath, JSON.stringify(manifest))
    await discoverPackages([directory])
    await admin.post('/api/install_app', { name: 'other' })
    const [installed] = await sql`select manifest from installed_app where name = 'other'`
    expect(installed.manifest.tables[0].columns.find((c: { column_name: string }) => c.column_name === 'policy').choice_labels).toEqual(labels)
    const step = migrationSchema.parse({ id: 'readable_policy', fromVersion: '1.0.0', toVersion: '2.0.0', operations: [{
      kind: 'alterColumn', table: 'other.task', column: 'policy', from: { choice_labels: labels }, to: { choice_labels: { raw_value: 'Revised wording' } },
    }] })
    expect(await applyMigrations([step], 'other')).toEqual([])
    expect(await sql`select choice_labels from column_def where parent = 'other.task' and column_name = 'policy'`).toEqual([{ choice_labels: { raw_value: 'Revised wording' } }])
  } finally {
    await discoverPackages([])
    await loadInstalledApps()
    await rm(directory, { recursive: true, force: true })
  }
})

const migration = readFileSync(new URL('../migrations/0006_readable_labels.sql', import.meta.url), 'utf8')

test('readable-label migration preserves installed wording', async ({ admin }) => {
  await sql`update column_def set label = column_name where parent = 'Sign In Method' and column_name <> 'identifier_system'`
  await sql`update column_def set label = 'Our client key' where parent = 'Sign In Method' and column_name = 'client_id'`
  await sql`update column_def set custom = true where parent = 'Sign In Method' and column_name = 'settings'`
  await admin.post('/api/table/Metadata%20Override', {
    row_id: 'readable-override', table_name: 'Sign In Method', column_name: 'kind', property: 'label', value: 'Our kind',
  })
  await admin.post('/api/save_row', { table: 'Translation', row: {
    row_id: 'readable-translation', language: 'fr', source_text: 'service_url', translated_text: 'Service traduit',
  } })
  const sinkBefore = await sql`select column_name, label, choice_labels from column_def where parent = 'Email Sink' order by column_name`
  await sql.unsafe(migration)
  invalidateMeta()
  const meta = await admin.get<{ columns: { column_name: string; label: string }[] }>('/api/table/Sign%20In%20Method:meta')
  const byName = Object.fromEntries(meta.columns.map(c => [c.column_name, c.label]))
  expect(byName).toMatchObject({ client_id: 'Our client key', service_url: 'service_url', kind: 'Our kind', settings: 'settings', new_person: 'New Person Policy', self_link: 'Allow Self-Linking', identifier_system: 'Identifier system' })
  expect(await sql`select column_name, label, choice_labels from column_def where parent = 'Email Sink' order by column_name`).toEqual(sinkBefore)
  const before = await sql`select parent, column_name, label, choice_labels from column_def order by parent, column_name`
  await sql.unsafe(migration)
  expect(await sql`select parent, column_name, label, choice_labels from column_def order by parent, column_name`).toEqual(before)
})

test('readable-label migration recognizes the MotherDuck platform list without overwriting authored choices', async () => {
  const choices = 'postgres\nmysql\nduckdb\nmotherduck\ncsv-folder'
  for (const fixture of [
    { choices, custom: false, labels: null },
    { choices, custom: false, labels: { motherduck: 'Our warehouse' } },
    { choices, custom: false, labels: {} },
    { choices, custom: true, labels: null },
    { choices: choices + '\nour_engine', custom: false, labels: null },
  ]) {
    await sql`update column_def set label = 'Our engine caption', choices = ${fixture.choices}, custom = ${fixture.custom},
      choice_labels = ${fixture.labels === null ? null : sql.json(fixture.labels)}
      where parent = 'Data Source' and column_name = 'engine'`
    await sql.unsafe(migration)
    const [column] = await sql`select label, choices, choice_labels from column_def where parent = 'Data Source' and column_name = 'engine'`
    expect(column.label).toBe('Our engine caption')
    expect(column.choices).toBe(fixture.choices)
    expect(column.choice_labels).toEqual(fixture.labels ?? (fixture.custom || fixture.choices !== choices ? null : {
      postgres: 'PostgreSQL', mysql: 'MySQL', duckdb: 'DuckDB', motherduck: 'MotherDuck', 'csv-folder': 'CSV folder',
    }))
  }
})

test('readable-label migration requires exact old platform choices', async ({ admin }) => {
  await sql`update column_def set choice_labels = null where parent in ('Sign In Method', 'Data Source', 'Table', 'Email Rule', 'Server Script', 'Webhook')`
  // Exercise the pre-MotherDuck choices explicitly: the fully migrated test
  // database now has the five-engine list added after readable labels.
  await sql`update column_def set choices = E'postgres\nmysql\nduckdb\ncsv-folder'
    where parent = 'Data Source' and column_name = 'engine'`
  await sql`update column_def set choices = E'refuse\ncreate_if_email_domain_allowed\ncreate'
    where parent = 'Sign In Method' and column_name = 'new_person'`
  // #1021 added view to Table kind after readable labels.
  await sql`update column_def set choices = E'table\nsub_table\nsettings' where parent = 'Table' and column_name = 'kind'`
  await sql`update column_def set choices = 'changed' where parent = 'Data Source' and column_name = 'access'`
  await sql`update column_def set choice_labels = ${sql.json({ password: 'Our password' })} where parent = 'Sign In Method' and column_name = 'kind'`
  const app = await makeTable(admin, { name: 'Readable App Data', columns: [{ column_name: 'kind', column_type: 'Choice', choices: 'password\ngoogle\ndelegated_password', label: 'kind' }] })
  await sql.unsafe(migration)
  const mappings = await sql`select parent, column_name, choice_labels from column_def where choice_labels is not null`
  expect(mappings).toEqual(expect.arrayContaining([
    expect.objectContaining({ parent: 'Sign In Method', column_name: 'kind', choice_labels: { password: 'Our password' } }),
    expect.objectContaining({ parent: 'Sign In Method', column_name: 'new_person', choice_labels: { refuse: 'Do not create a person', create_if_email_domain_allowed: 'Create if email domain is allowed', create: 'Create a person' } }),
    expect.objectContaining({ parent: 'Data Source', column_name: 'engine', choice_labels: { postgres: 'PostgreSQL', mysql: 'MySQL', duckdb: 'DuckDB', 'csv-folder': 'CSV folder' } }),
  ]))
  expect(await sql`select choice_labels from column_def where parent = 'Data Source' and column_name = 'access'`).toEqual([{ choice_labels: null }])
  expect(await sql`select label, choice_labels from column_def where parent = ${app.name}`).toEqual([{ label: 'kind', choice_labels: null }])
  for (const [parent, column] of [['Email Rule', 'event'], ['Server Script', 'event'], ['Table', 'kind'], ['Webhook', 'webhook_event']]) {
    expect(mappings.find(c => c.parent === parent && c.column_name === column)?.choice_labels).toBeTruthy()
  }
})
