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
  '0141_any_table_link.sql', '0142_everyone_roles.sql', '0143_access_auditor_role.sql',
  '0144_access_request.sql', '0145_archived_tables.sql', '0146_one_motherduck_token.sql',
  '0147_row_retirement.ts', '0148_deletion_record.sql', '0149_roster_first_sign_in.sql',
  '0150_operation_permissions.ts', '0151_change_proposal.sql', '0152_submission_status.ts',
  '0153_table_views.sql', '0154_table_scope.sql', '0155_glossary_picture.sql', '0156_permission_not_retired.sql', '0157_link_roster_job.sql', '0158_job_hand_back.sql']
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
    // A connection-variable source, as an instance holds one before #969.
    await scratch.db`insert into featherbase.data_source (row_id, engine, url_env, default_schema, access, read_scaling_token)
      values ('via-variable', 'duckdb', 'MOTHERDUCK_URL', 'gold.main', 'read_only', true),
             ('ticked-other', 'duckdb', 'OTHER_WAREHOUSE', null, 'read_only', true),
             ('local-file', 'duckdb', 'LOCAL_DUCK_FILE', null, 'read_only', false),
             ('pg-rw', 'postgres', 'PG_URL', null, 'read_write', false)`
    await scratch.db`insert into featherbase.table_def (name, data_source, external_schema) values ('Via Variable Sales', 'via-variable', 'marts.sales')`
    await scratch.db`update featherbase.data_source set access = 'read_write', databases = '[{"name":"fixture","address":"md:fixture","owner":"This account","account":"someone"}]' where row_id = 'migration-fixture'`
    await scratch.db`insert into featherbase.data_source_catalog (data_source, database, tables)
      values ('migration-fixture', 'fixture', '[{"name":"people"}]')`
    await scratch.db`insert into featherbase.table_copy (target_table, data_source, database, source_schema, source_table, key_column, last_run_id)
      values ('Person', 'migration-fixture', 'fixture', 'main', 'people', 'row_id', 'historical-run')`
    await scratch.db`insert into featherbase.import_log (row_id, ref_table, run_id) values ('migration-import', 'Person', 'historical-run')`
    await scratch.db`insert into featherbase.version (row_id, ref_table, ref_name, data)
      values ('migration-version', 'Person', 'Administrator', '{"fixture":true}')`
    // Simple protocol: a prepared `select *` refuses to outlive a change of its columns.
    const snapshot = async () => ({
      source: await scratch.db`select * from featherbase.data_source where row_id = 'migration-fixture'`.simple(),
      catalog: await scratch.db`select * from featherbase.data_source_catalog`.simple(),
      copy: await scratch.db`select * from featherbase.table_copy`.simple(),
      log: await scratch.db`select * from featherbase.import_log where row_id = 'migration-import'`.simple(),
      version: await scratch.db`select * from featherbase.version where row_id = 'migration-version'`.simple(),
      native: await scratch.db`select row_id, full_name from featherbase.person where row_id = 'Administrator'`.simple(),
    })
    const before = await snapshot()
    expect(await scratch.migrate.pendingMigrations()).toEqual(['0006_readable_labels.sql', ...pendingAfterLabels])
    expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stderr: '' })
    // #969: everything but the source row survives; the token table is gone.
    const after = await snapshot()
    // #859: the upgrade also adds three empty retirement columns; every value stays.
    // #1022: and the lifecycle column changes its name, keeping its value.
    const held = (snap: Record<string, readonly Record<string, unknown>[]>) => Object.fromEntries(Object.entries(snap).map(([k, rows]) =>
      [k, rows.map(({ retired_at, retired_by, retired_reason, status, submission_status, ...row }) => {
        expect([retired_at ?? null, retired_by ?? null, retired_reason ?? null]).toEqual([null, null, null])
        return { ...row, lifecycle: status ?? submission_status }
      })]))
    expect(held({ ...after, source: [] } as never)).toEqual(held({ ...before, source: [] } as never))
    expect(after.source).toEqual([expect.objectContaining({ engine: 'motherduck', access: 'read_only', databases: [{ name: 'fixture', owner: 'This account' }] })])
    expect(after.source[0]).not.toHaveProperty('token_last_four')
    expect(after.source[0]).not.toHaveProperty('read_scaling_token')
    expect(await scratch.db`select to_regclass('featherbase.data_source_secret') as secret`).toEqual([{ secret: null }])
    expect(await scratch.db`select row_id, engine, url_env, access, default_schema from featherbase.data_source
      where row_id <> 'migration-fixture' order by row_id`).toEqual(expect.arrayContaining([
      { row_id: 'local-file', engine: 'duckdb', url_env: 'LOCAL_DUCK_FILE', access: 'read_only', default_schema: null },
      { row_id: 'pg-rw', engine: 'postgres', url_env: 'PG_URL', access: 'read_write', default_schema: null },
      { row_id: 'ticked-other', engine: 'motherduck', url_env: null, access: 'read_only', default_schema: null },
      { row_id: 'via-variable', engine: 'motherduck', url_env: null, access: 'read_only', default_schema: 'gold.main' },
    ]))
    // Its databases come from its default schema and its connected tables.
    expect(await scratch.db`select row_id, databases from featherbase.data_source where row_id in ('via-variable', 'ticked-other') order by row_id`).toEqual([
      { row_id: 'ticked-other', databases: null },
      { row_id: 'via-variable', databases: [{ name: 'gold' }, { name: 'marts' }] },
    ])
    expect(await ledger(scratch)).toEqual([...allMigrations, ...Object.keys(branchHistory)].sort())
    await expectCurrent(scratch)
    expect(await scratch.db`select column_name, read_only from featherbase.column_def
      where parent = 'Data Source' and column_name in ('token_last_four', 'read_scaling_token', 'databases') order by column_name`).toEqual([
      { column_name: 'databases', read_only: false },
    ])
  } finally {
    await scratch.close()
  }
}, 120_000)
