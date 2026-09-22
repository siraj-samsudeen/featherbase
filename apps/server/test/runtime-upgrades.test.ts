import { expect, describe } from 'vitest'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { sql, withTransaction } from '../src/db'
import { registerController, unregisterController, type TableController } from '../src/controllers'
import { saveDoc } from '../src/document'
import { invalidateMeta } from '../src/meta'
import { makeTaskerV2 } from '../../../tools/tasker-upgrade-fixture.mjs'

async function targetPackage() {
  const directory = await mkdtemp(resolve('test/.upgrade-'))
  await cp(resolve('../..', 'runtime-apps/other'), directory, { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(directory, 'featherbase.json'), 'utf8'))
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  const column = { column_name: 'notes', label: 'Notes', column_type: 'Text' }
  manifest.tables[0].columns.push(column)
  manifest.migrations = [{ id: 'add_notes', fromVersion: pkg.version, toVersion: '2.0.0',
    operations: [{ kind: 'addColumn', table: 'other.task', column }] }]
  await writeFile(resolve(directory, 'package.json'), JSON.stringify({ ...pkg, version: '2.0.0' }))
  await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(manifest))
  return { directory, manifest }
}

describe('runtime upgrades', () => {
  // @spec core_runtime_client_pins_active_identity.identity_bootstrap_fails_closed
  // @spec core_runtime_client_pins_active_identity.indirect_requests_pin_each_app
  test('core identity snapshot is host derived; multiple identities never override availability or version', async ({ admin, createUser }) => {
    const { directory } = await targetPackage()
    try {
      await discoverPackages([resolve('../..', 'runtime-apps/fixtures/tasker-v2'), directory])
      await admin.post('/api/install_app', { name: 'tasker' })
      await admin.post('/api/install_app', { name: 'other' })
      const member = await createUser({ email: 'identity-reader@example.com', roles: [] })
      expect(await member.get('/api/runtime_app_versions')).toEqual(['other@2.0.0', 'tasker@2.0.0'])
      const read = (table: string, header: string) => admin.fetch(`/api/table/${table}`, { headers: { 'X-Featherbase-App-Version': header } })
      for (const table of ['tasker.task', 'other.task']) {
        expect((await read(table, 'other@2.0.0, tasker@2.0.0')).status).toBe(200)
      }
      expect((await read('other.task', 'other@0.0.1, tasker@2.0.0')).status).toBe(409)
      expect((await read('tasker.task', 'other@2.0.0')).status).toBe(409)
      for (const invalid of ['tasker@2.0.0,tasker@0.0.1', 'tasker@2.0.0,tasker@2.0.0', 'other@wat,tasker@2.0.0']) {
        expect((await read('tasker.task', invalid)).status).toBe(417)
      }
      await admin.post('/api/set_app_enabled', { name: 'tasker', enabled: false })
      expect(await member.get('/api/runtime_app_versions')).toEqual(['other@2.0.0'])
      expect((await read('tasker.task', 'tasker@2.0.0')).status).toBe(403)
      await sql`update installed_app set activation_pending = true where name = 'other'`
      expect(await member.get('/api/runtime_app_versions')).toEqual([])
      expect((await read('other.task', 'other@2.0.0')).status).toBe(403)
      await sql`update installed_app set activation_pending = false, package_version = null where name = 'other'`
      expect(await member.get('/api/runtime_app_versions')).toEqual([])
      await discoverPackages([])
      await loadInstalledApps()
      expect(await member.get('/api/runtime_app_versions')).toEqual([])
      expect((await read('other.task', 'other@2.0.0')).status).toBe(403)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  // @spec runtime_upgrade_preserves_owned_work.tasker_description_is_generic_migration
  test('Tasker upgrade preserves complete existing work and matches fresh v2 schema', async ({ admin }) => {
    const source = resolve('../..', 'runtime-apps/fixtures/tasker-v1')
    const directory = await mkdtemp(resolve('test/.tasker-upgrade-'))
    await makeTaskerV2(source, directory)
    async function schema() {
      return {
        columns: await sql`select to_jsonb(c) - 'row_id' - 'created_at' - 'updated_at' as definition
          from column_def c where parent like 'tasker.%' order by parent, position`,
        physical: await sql`select table_name, column_name, data_type, is_nullable, column_default, ordinal_position
          from information_schema.columns where table_schema = 'tasker' order by table_name, ordinal_position`,
      }
    }
    let fresh: Awaited<ReturnType<typeof schema>> | undefined
    try {
      // Savepoint rollback creates an independent fresh-install baseline without
      // deleting application data or relying on the implementation's expectation.
      const rollback = new Error('fresh fixture complete')
      await expect(withTransaction(async () => {
        await discoverPackages([directory])
        await admin.post('/api/install_app', { name: 'tasker' })
        fresh = await schema()
        throw rollback
      })).rejects.toBe(rollback)
      invalidateMeta()
      await discoverPackages([source, resolve('../..', 'runtime-apps/other')])
      await admin.post('/api/install_app', { name: 'tasker' })
      await admin.post('/api/install_app', { name: 'other' })
      const project = await admin.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Stock review — southern region' } })
      const task = await admin.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: {
        task_title: 'Count 37 damaged cartons', project: project.row_id, description: 'Keep this task text', task_state: 'Blocked', urgent: true,
      } })
      await admin.post('/api/save_row', { table: 'other.task', row: { row_id: task.row_id, quantity: 83 } })
      await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: task.row_id, content: 'Warehouse confirms only 11 remain' } })
      await admin.put('/api/user_settings/tasker.preferences', { starred_projects: [project.row_id], detail_mode: 'focus' })
      const before = {
        projects: await sql`select * from tasker.project order by row_id`,
        tasks: await sql`select * from tasker.task order by row_id`,
        other: await sql`select * from other.task order by row_id`,
        comments: await sql`select * from comment where ref_table = 'tasker.task' order by row_id`,
        grants: await sql`select * from permission where owner_app = 'tasker' order by row_id`,
        preferences: await admin.get('/api/user_settings/tasker.preferences'),
      }
      await discoverPackages([source, directory, resolve('../..', 'runtime-apps/other')])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'tasker', version: '2.0.0' })
      await admin.post('/api/upgrade_app', { name: 'tasker', version: '2.0.0', planId: plan.planId })
      expect(await schema()).toEqual(fresh)
      await admin.post('/api/activate_app_upgrade', { name: 'tasker', version: '2.0.0' })
      const afterProjects = await sql`select * from tasker.project order by row_id`
      expect(afterProjects.map(({ description, ...row }) => row)).toEqual(before.projects)
      expect(afterProjects.map(row => row.description)).toEqual([null])
      expect(await sql`select * from tasker.task order by row_id`).toEqual(before.tasks)
      expect(await sql`select * from other.task order by row_id`).toEqual(before.other)
      expect(await sql`select * from comment where ref_table = 'tasker.task' order by row_id`).toEqual(before.comments)
      expect(await sql`select * from permission where owner_app = 'tasker' order by row_id`).toEqual(before.grants)
      expect(await admin.get('/api/user_settings/tasker.preferences')).toEqual(before.preferences)
      for (const description of ['## Count\n\n**37** cartons, not 83.', '', null]) {
        const response = await admin.fetch('/api/save_row', { method: 'POST', headers: {
          'Content-Type': 'application/json', 'X-Featherbase-App-Version': 'tasker@2.0.0',
        }, body: JSON.stringify({ table: 'tasker.project', row: { ...before.projects[0], description } }) })
        expect(response.status).toBe(201)
        // Existing optional Text API normalizes empty input to NULL.
        expect(await response.json()).toMatchObject({ description: description || null })
        const read = await admin.fetch(`/api/table/tasker.project/${project.row_id}`, { headers: { 'X-Featherbase-App-Version': 'tasker@2.0.0' } })
        expect(await read.json()).toMatchObject({ description: description || null })
        before.projects[0] = (await sql`select * from tasker.project where row_id = ${project.row_id}`)[0]
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  // @spec runtime_upgrade_identity
  // @spec runtime_upgrade_reviewed_plan
  // @spec runtime_upgrade_commit_and_activation
  // @spec runtime_upgrade_preserves_owned_work
  // @spec runtime_upgrade_recovery_boundary
  test('preview, commit, restart, activate and retry preserve asymmetric rows and grants', async ({ admin, createUser }) => {
    const source = resolve('../..', 'runtime-apps/other')
    const { directory } = await targetPackage()
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'kept', quantity: 37 } })
      const grants = await sql`select * from permission where owner_app = 'other' order by row_id`
      expect(await discoverPackages([source, directory])).toEqual([])
      await loadInstalledApps()
      const member = await createUser({ email: 'upgrade-reader@example.com', roles: [] })
      await expect(member.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })).rejects.toMatchObject({ status: 403 })
      const plan = await admin.post<{ planId: string; currentVersion: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      expect(plan).toMatchObject({ currentVersion: '0.0.1', targetVersion: '2.0.0', destructive: false, codeOnly: false,
        migrations: [{ id: 'add_notes' }], permissions: [], jobs: [], indexes: [] })
      expect(await admin.get('/api/table/other.task/kept')).toMatchObject({ quantity: '37', validation_runs: '1' })
      await expect(admin.post('/api/upgrade_app', { name: 'other', version: '2.0.0', planId: 'stale' })).rejects.toMatchObject({ status: 409 })
      const body = { name: 'other', version: '2.0.0', planId: plan.planId }
      expect(await admin.post('/api/upgrade_app', body)).toMatchObject({ activationPending: true })
      expect(await admin.post('/api/upgrade_app', body)).toMatchObject({ activationPending: true })
      await expect(admin.get('/api/table/other.task/kept')).rejects.toMatchObject({ status: 403 })
      await discoverPackages([source, directory])
      await loadInstalledApps()
      await expect(admin.post('/api/set_app_enabled', { name: 'other', enabled: true })).rejects.toMatchObject({ status: 409 })
      await admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })
      await admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })
      await expect(admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'late', quantity: 9 } })).rejects.toMatchObject({ status: 409 })
      const response = await admin.fetch('/api/save_row', { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Featherbase-App-Version': 'other@2.0.0',
      }, body: JSON.stringify({ table: 'other.task', row: { row_id: 'new', quantity: 19, notes: '**markdown**' } }) })
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({ quantity: '19', notes: '**markdown**', validation_runs: '1' })
      expect(await sql`select * from permission where owner_app = 'other' order by row_id`).toEqual(grants)
      expect(await sql`select quantity, validation_runs, notes from other.task where row_id = 'kept'`).toEqual([{ quantity: '37', validation_runs: '1', notes: null }])
      await discoverPackages([source])
      await loadInstalledApps()
      await expect(admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })).rejects.toMatchObject({ status: 417 })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  // @spec runtime_upgrade_commit_and_activation.failed_migration_preserves_active_version
  test('second DDL failure rolls back first addition and ledger; retry runs exactly once', async ({ admin }) => {
    const source = resolve('../..', 'runtime-apps/other')
    const { directory, manifest } = await targetPackage()
    const column = { column_name: 'second', label: 'Second', column_type: 'Text' }
    manifest.tables[0].columns.push(column)
    manifest.migrations[0].operations.push({ kind: 'addColumn', table: 'other.task', column })
    await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(manifest))
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await sql`alter table other.task add column second text`
      await discoverPackages([source, directory])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      const body = { name: 'other', version: '2.0.0', planId: plan.planId }
      await expect(admin.post('/api/upgrade_app', body)).rejects.toMatchObject({ status: 417, message: expect.stringContaining('unchanged') })
      expect(await sql`select column_name from information_schema.columns where table_schema = 'other' and table_name = 'task' and column_name = 'notes'`).toEqual([])
      expect(await sql`select column_name from column_def where parent = 'other.task' and column_name in ('notes', 'second')`).toEqual([])
      expect(await sql`select package_version, migration_ledger, activation_pending from installed_app where name = 'other'`).toEqual([
        { package_version: '0.0.1', migration_ledger: [], activation_pending: false },
      ])
      expect(await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'old-hook', quantity: 47 } })).toMatchObject({ validation_runs: '1' })
      await sql`alter table other.task drop column second`
      await admin.post('/api/upgrade_app', body)
      await admin.post('/api/upgrade_app', body)
      expect(await sql`select column_name from column_def where parent = 'other.task' and column_name in ('notes', 'second') order by column_name`).toEqual([{ column_name: 'notes' }, { column_name: 'second' }])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  // @spec runtime_upgrade_identity.upgrade_history_is_a_prefix
  // @spec runtime_upgrade_reviewed_plan.destructive_upgrade_refused
  test('malformed, incompatible, skipped, changed permissions and undeclared destructive changes fail closed', async ({ admin }) => {
    const source = resolve('../..', 'runtime-apps/other')
    const { directory, manifest } = await targetPackage()
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      const edits = [
        { ...manifest, apiVersion: 99 },
        { ...manifest, dependencies: ['absent'] },
        { ...manifest, migrations: [{ ...manifest.migrations[0], operations: [{ kind: 'dropColumn', table: 'other.task', column: 'quantity' }] }] },
        { ...manifest, migrations: [manifest.migrations[0], manifest.migrations[0]] },
      ]
      for (const changed of edits) {
        await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(changed))
        expect(await discoverPackages([source, directory])).toHaveLength(1)
        await loadInstalledApps()
        await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })).rejects.toMatchObject({ status: 417 })
      }
      for (const changed of [
        { ...manifest, migrations: [{ ...manifest.migrations[0], fromVersion: '1.5.0' }] },
        { ...manifest, permissions: [] },
        { ...manifest, tables: manifest.tables.map((t: { columns: unknown[] }) => ({ ...t, columns: t.columns.slice(1) })) },
      ]) {
        await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(changed))
        expect(await discoverPackages([source, directory])).toEqual([])
        await loadInstalledApps()
        await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })).rejects.toMatchObject({ status: 417 })
      }
      expect(await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'still-old', quantity: 31 } })).toMatchObject({ validation_runs: '1' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  // @spec runtime_upgrade_reviewed_plan.reviewed_artifact_changes
  // @spec runtime_upgrade_recovery_boundary
  test('preview digest changes on enablement; missing and edited artifact cannot mutate schema', async ({ admin }) => {
    const source = resolve('../..', 'runtime-apps/other')
    const { directory } = await targetPackage()
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await discoverPackages([source, directory])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      expect(await admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })).toEqual(plan)
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      await expect(admin.post('/api/upgrade_app', { name: 'other', version: '2.0.0', planId: plan.planId })).rejects.toMatchObject({ status: 409 })
      await writeFile(resolve(directory, 'server.mjs'), 'export const apiVersion = 99')
      await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })).rejects.toMatchObject({ status: 417, message: expect.stringContaining('changed') })
      await rm(directory, { recursive: true })
      await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })).rejects.toMatchObject({ status: 417, message: expect.stringContaining('missing') })
      expect(await sql`select package_version from installed_app where name = 'other'`).toEqual([{ package_version: '0.0.1' }])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  // @spec runtime_upgrade_commit_and_activation.upgrade_drains_admitted_work
  test('upgrade waits for admitted post-commit save; queued disable preserves disabled activation', async ({ admin }) => {
    const source = resolve('../..', 'runtime-apps/other')
    const { directory } = await targetPackage()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const controller: TableController = { table: 'other.task', hooks: { after_commit: async ctx => {
      if (ctx.row.row_id !== 'parent') return
      entered()
      await gate
      await saveDoc('other.task', { row_id: 'tail', quantity: 83 })
    } } }
    const work: Promise<unknown>[] = []
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await discoverPackages([source, directory])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      registerController(controller)
      work.push(admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'parent', quantity: 13 } }))
      await started
      work.push(admin.post('/api/upgrade_app', { name: 'other', version: '2.0.0', planId: plan.planId }))
      await expect.poll(async () => (await sql`select count(*)::int as waiting from pg_locks where locktype = 'advisory' and classid = 296 and objid = 1 and not granted`)[0].waiting).toBe(1)
      work.push(admin.post('/api/set_app_enabled', { name: 'other', enabled: false }))
      release()
      await Promise.all(work)
      expect(await sql`select quantity, validation_runs from other.task where row_id = 'tail'`).toEqual([{ quantity: '83', validation_runs: '1' }])
      expect(await admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })).toMatchObject({ enabled: false })
      await expect(admin.get('/api/table/other.task/tail')).rejects.toMatchObject({ status: 403 })
    } finally {
      release()
      await Promise.allSettled(work)
      unregisterController(controller)
      await rm(directory, { recursive: true, force: true })
    }
  })

  // @spec runtime_upgrade_identity
  test('duplicate-different targets and same-version replacement after commit cannot replay success', async ({ admin }) => {
    const source = resolve('../..', 'runtime-apps/other')
    const { directory, manifest } = await targetPackage()
    const duplicate = await mkdtemp(resolve('test/.upgrade-duplicate-'))
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await cp(directory, duplicate, { recursive: true })
      await writeFile(resolve(duplicate, 'featherbase.json'), JSON.stringify({ ...manifest, title: 'Different artifact, same version' }))
      expect(await discoverPackages([source, directory, duplicate])).toHaveLength(1)
      await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })).rejects.toMatchObject({ status: 417 })
      await discoverPackages([source, directory])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      const body = { name: 'other', version: '2.0.0', planId: plan.planId }
      await admin.post('/api/upgrade_app', body)
      const committed = await sql`select * from installed_app where name = 'other'`
      await discoverPackages([source, duplicate])
      await loadInstalledApps()
      await expect(admin.post('/api/upgrade_app', body)).rejects.toMatchObject({ status: 417, message: expect.stringContaining('committed') })
      await expect(admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })).rejects.toMatchObject({ status: 417 })
      expect(await sql`select * from installed_app where name = 'other'`).toEqual(committed)
    } finally { await rm(directory, { recursive: true, force: true }); await rm(duplicate, { recursive: true, force: true }) }
  })

  // @spec runtime_upgrade_identity
  // @spec runtime_upgrade_reviewed_plan
  test('disabled upgrade, checksum drift, downgrade, missing prior and code-only next version', async ({ admin }) => {
    const source = resolve('../..', 'runtime-apps/other')
    const { directory, manifest } = await targetPackage()
    const next = await mkdtemp(resolve('test/.upgrade-next-'))
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      await discoverPackages([directory])
      await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })).rejects.toMatchObject({ status: 417, message: expect.stringContaining('unavailable') })
      await discoverPackages([source, directory])
      const first = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      await admin.post('/api/upgrade_app', { name: 'other', version: '2.0.0', planId: first.planId })
      expect(await admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })).toMatchObject({ enabled: false })
      await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '0.0.1' })).rejects.toMatchObject({ status: 417, message: expect.stringContaining('downgrades') })
      await cp(directory, next, { recursive: true })
      const pkg = JSON.parse(await readFile(resolve(next, 'package.json'), 'utf8'))
      await writeFile(resolve(next, 'package.json'), JSON.stringify({ ...pkg, version: '3.0.0' }))
      const migrations = [...manifest.migrations, { id: 'client_refresh', fromVersion: '2.0.0', toVersion: '3.0.0', operations: [] }]
      await writeFile(resolve(next, 'featherbase.json'), JSON.stringify({ ...manifest, migrations: [{ ...migrations[0], id: 'rewritten_history' }, migrations[1]] }))
      expect(await discoverPackages([source, directory, next])).toEqual([])
      await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '3.0.0' })).rejects.toMatchObject({ status: 417, message: expect.stringContaining('checksum') })
      await writeFile(resolve(next, 'featherbase.json'), JSON.stringify({ ...manifest, migrations }))
      await discoverPackages([source, directory, next])
      const second = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '3.0.0' })
      expect(second).toMatchObject({ codeOnly: true, tables: [], migrations: [{ id: 'client_refresh', operations: [] }] })
      await admin.post('/api/upgrade_app', { name: 'other', version: '3.0.0', planId: second.planId })
      await admin.post('/api/activate_app_upgrade', { name: 'other', version: '3.0.0' })
      expect(await sql`select migration_ledger from installed_app where name = 'other'`).toMatchObject([{ migration_ledger: [{ id: 'add_notes' }, { id: 'client_refresh' }] }])
    } finally { await rm(directory, { recursive: true, force: true }); await rm(next, { recursive: true, force: true }) }
  })
})
