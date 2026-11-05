// These tests commit migrations to disposable scratch databases: migration
// ordering and filename-ledger upgrades cannot be proved inside a sandbox.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, expect, it } from 'vitest'
import { runMain } from './command-io'
import { dropScratchDatabases, scratchDatabase } from './scratch-database'

afterAll(dropScratchDatabases, 60_000)

type Scratch = Awaited<ReturnType<typeof scratchDatabase>>

// Exact origin/main 40f12d52 history, not a current installation with columns
// removed to approximate an upgrade. These files are append-only history.
const mainHistory = {
  '0001_baseline.sql': '9cba28f078c37f574d9872ba23a2a03418cc26543faea41f091026c2d802ee66',
  '0002_administrator_password.ts': 'c56f9955b2005f56170f36966ec7d0e613cfb05abf0d27231e79ede914d23103',
  '0003_mock_google_sign_in.ts': 'bce94004ba44feca1bec157ac272e56086b6d5b456baf68890f626ac4ecc8206',
  '0004_scheduled_job_owner_app.sql': 'ec83a2abb4381c1ddcff6b05f6232a5c18939cac112f0dfa608078d34e6cdd37',
  '0005_sign_in_identity_hosted_domain.sql': '829c8e22a3592b72bcd9c5ce74d5d6d4fc5fd2c75fd2bc8a25fc2721a0a15629',
  '0006_readable_labels.sql': 'df79d5b0de5697b6cccf5497d38ff1318272fb0878d971bad5235616010f82f3',
}
// Keep the old branch filenames in its ledger and the SQL byte-for-byte:
// renumbering pending migrations must also upgrade installations that ran them.
const branchHistory = {
  '0006_motherduck_pasted_token.sql': 'a5c29d09b96563a2c376d312bbac3760742941812e46d46cc9783d32b262b722',
  '0007_table_copy.sql': '8f994066459c10cd48cebcfcd60e79a3d19a88431d1909b81e8a7a03145fcdb1',
  '0007b_table_copy_lifecycle.sql': 'd79014711e5a80d51eec3890bd93f76aec123d7579c7421a2e46b1231eb2e3fc',
}
const additions = ['0007_motherduck_pasted_token.sql', '0008_table_copy.sql', '0009_table_copy_lifecycle.sql']
const laterMain = ['0012_table_settings_storage_identity.sql', '0013_reading_presentation.sql',
  '0014_series_per_table.sql', '0015_metadata_override_editor.sql',
  '0016_master_sync.sql',
  '0138_mandatory_access.sql', '0140_data_source_sentence_labels.sql',
  '0141_any_table_link.sql', '0142_everyone_roles.sql']
const pendingAfterLabels = [...additions, '0010_copy_refresh_schedule.sql', ...laterMain]
const allMigrations = [...Object.keys(mainHistory), ...pendingAfterLabels]
const oldLabels = { postgres: 'PostgreSQL', mysql: 'MySQL', duckdb: 'DuckDB', 'csv-folder': 'CSV folder' }
const engineLabels = {
  ...oldLabels, motherduck: 'MotherDuck',
}
const choices = 'postgres\nmysql\nduckdb\nmotherduck\ncsv-folder'

function historicalSql(file: string, hash: string, fixture = false): string {
  const body = readFileSync(new URL(fixture ? `./migration-fixtures/issue-772/${file}` : `../migrations/${file}`, import.meta.url), 'utf8')
  expect(createHash('sha256').update(body).digest('hex'), file).toBe(hash)
  return body
}

async function installMainHistory(scratch: Scratch, beforeLabels = false) {
  await scratch.migrate.ensureLedger()
  const { withTransaction } = await import('../src/db')
  for (const [file, hash] of Object.entries(mainHistory)) {
    if (beforeLabels && file === '0006_readable_labels.sql') break
    historicalSql(file, hash)
    await withTransaction(() => scratch.migrate.applyMigrationFile(file))
  }
}

const ledger = async (s: Scratch) => (await s.db`select name from featherbase.migration order by name collate "C"`).map(r => r.name)
const engine = (s: Scratch) => s.db`select choices, choice_labels from featherbase.column_def where parent = 'Data Source' and column_name = 'engine'`

async function expectCurrent(scratch: Scratch) {
  expect(await engine(scratch)).toEqual([{ choices, choice_labels: engineLabels }])
  expect(await scratch.db`select conname, confupdtype, confdeltype, convalidated from pg_constraint
    where conrelid = 'featherbase.table_copy'::regclass and contype = 'f' order by conname`).toEqual([
    { conname: 'table_copy_data_source_fkey', confupdtype: 'c', confdeltype: 'c', convalidated: true },
    { conname: 'table_copy_target_fkey', confupdtype: 'c', confdeltype: 'c', convalidated: true },
  ])
  expect(await scratch.migrate.pendingMigrations()).toEqual([])
  expect(await runMain(scratch.migrate.main, [])).toEqual({ code: 0, stdout: `migrations up to date (${allMigrations.length} total)\n`, stderr: '' })
}

it('a fresh install labels the MotherDuck engine choice', async () => {
  const scratch = await scratchDatabase()
  try {
    expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stderr: '' })
    expect(await ledger(scratch)).toEqual(allMigrations)
    await expectCurrent(scratch)
  } finally {
    await scratch.close()
  }
}, 120_000)

it('upgrades the actual main 0006 installation', async () => {
  const scratch = await scratchDatabase()
  try {
    await installMainHistory(scratch)
    expect(await ledger(scratch)).toEqual(Object.keys(mainHistory))
    expect(await engine(scratch)).toEqual([{ choices: 'postgres\nmysql\nduckdb\ncsv-folder', choice_labels: oldLabels }])
    expect(await scratch.db`select to_regclass('featherbase.data_source_secret') as secret,
      to_regclass('featherbase.table_copy') as copy`).toEqual([{ secret: null, copy: null }])
    expect(await scratch.migrate.pendingMigrations()).toEqual(pendingAfterLabels)
    expect(await runMain(scratch.migrate.main, [])).toEqual({ code: 0, stderr: '',
      stdout: pendingAfterLabels.map(f => `applied ${f}\n`).join('') + `migrations up to date (${allMigrations.length} total)\n` })
    expect(await ledger(scratch)).toEqual(allMigrations)
    await expectCurrent(scratch)
  } finally {
    await scratch.close()
  }
}, 120_000)

it.each([
  { name: 'authored map', labels: { ...oldLabels, postgres: 'Our PostgreSQL' }, custom: false },
  { name: 'empty authored map', labels: {}, custom: false },
  { name: 'partial authored map', labels: { motherduck: 'Our warehouse' }, custom: false },
  { name: 'extended authored map', labels: { ...oldLabels, extra: 'Our engine' }, custom: false },
  { name: 'custom platform-looking map', labels: oldLabels, custom: true },
  { name: 'null custom map', labels: null, custom: true },
  { name: 'null authored map', labels: null, custom: false },
  { name: 'existing MotherDuck map', labels: engineLabels, custom: false },
])('preserves the $name during the engine upgrade', async ({ labels, custom }) => {
  const scratch = await scratchDatabase()
  try {
    await installMainHistory(scratch)
    await scratch.db`update featherbase.column_def set label = 'Our engine caption', custom = ${custom},
      choice_labels = ${labels === null ? null : scratch.db.json(labels)}
      where parent = 'Data Source' and column_name = 'engine'`
    expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stderr: '' })
    expect(await scratch.db`select label, choice_labels from featherbase.column_def
      where parent = 'Data Source' and column_name = 'engine'`).toEqual([{ label: 'Our engine caption', choice_labels: labels }])
  } finally {
    await scratch.close()
  }
}, 120_000)

it('upgrades the historical branch ledger without replacing its data', async () => {
  const scratch = await scratchDatabase()
  try {
    await installMainHistory(scratch, true)
    for (const [file, hash] of Object.entries(branchHistory)) {
      const body = historicalSql(file, hash, true)
      await scratch.db.begin(async tx => {
        await tx.unsafe(body)
        await tx`insert into featherbase.migration (name) values (${file})`
      })
    }
    await scratch.db`insert into featherbase.data_source (row_id, engine, token_last_four, databases)
      values ('migration-fixture', 'motherduck', 'TEST', '[{"name":"fixture"}]')`
    await scratch.db`insert into featherbase.data_source_secret (data_source, token_ciphertext)
      values ('migration-fixture', 'synthetic-fixture-not-a-token')`
    await scratch.db`insert into featherbase.data_source_catalog (data_source, database, tables)
      values ('migration-fixture', 'fixture', '[{"name":"people"}]')`
    await scratch.db`insert into featherbase.table_copy (target_table, data_source, database, source_schema, source_table, key_column, last_run_id)
      values ('Person', 'migration-fixture', 'fixture', 'main', 'people', 'row_id', 'historical-run')`
    await scratch.db`insert into featherbase.import_log (row_id, ref_table, run_id) values ('migration-import', 'Person', 'historical-run')`
    await scratch.db`insert into featherbase.version (row_id, ref_table, ref_name, data)
      values ('migration-version', 'Person', 'Administrator', '{"fixture":true}')`
    const snapshot = async () => ({
      source: await scratch.db`select * from featherbase.data_source where row_id = 'migration-fixture'`,
      secret: await scratch.db`select * from featherbase.data_source_secret`,
      catalog: await scratch.db`select * from featherbase.data_source_catalog`,
      copy: await scratch.db`select * from featherbase.table_copy`,
      log: await scratch.db`select * from featherbase.import_log where row_id = 'migration-import'`,
      version: await scratch.db`select * from featherbase.version where row_id = 'migration-version'`,
      native: await scratch.db`select row_id, full_name from featherbase.person where row_id = 'Administrator'`,
    })
    const before = await snapshot()
    expect(await scratch.migrate.pendingMigrations()).toEqual(['0006_readable_labels.sql', ...pendingAfterLabels])
    expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stderr: '' })
    expect(await snapshot()).toEqual(before)
    expect(await ledger(scratch)).toEqual([...allMigrations, ...Object.keys(branchHistory)].sort())
    await expectCurrent(scratch)
    expect(await scratch.db`select column_name, count(*)::int as count from featherbase.column_def
      where parent = 'Data Source' and column_name in ('token_last_four', 'databases') group by column_name order by column_name`).toEqual([
      { column_name: 'databases', count: 1 }, { column_name: 'token_last_four', count: 1 },
    ])
  } finally {
    await scratch.close()
  }
}, 120_000)
