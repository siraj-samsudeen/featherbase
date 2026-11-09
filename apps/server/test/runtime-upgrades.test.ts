import { expect, describe } from 'vitest'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from './pg-test'
import { committedTest } from './pg-test-shared'
import { discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { sql, withTransaction } from '../src/db'
import { registerController, unregisterController, type TableController } from '../src/controllers'
import { saveDoc } from '../src/document'
import { invalidateMeta } from '../src/meta'
import { makeTaskerV2 } from '../../../tools/tasker-upgrade-fixture.mjs'
import { expectRefused, expectStatus } from './fixtures'

async function targetPackage() {
  const directory = await mkdtemp(resolve('test/.upgrade-'))
  await cp(resolve('../..', 'test-apps/other'), directory, { recursive: true })
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
  // #941 (ADR 0019): an accent outside the platform's set is refused on the
  // way in by an upgrade too, not only by an install.
  test('upgrading to a version that names an accent the platform does not provide is refused', async ({ admin }) => {
    const source = resolve('../..', 'test-apps/other')
    const { directory, manifest } = await targetPackage()
    await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify({ ...manifest, accent: 'purple' }))
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await discoverPackages([source, directory])
      await loadInstalledApps()
      await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })).rejects.toMatchObject({
        status: 417, message: "417 ValidationError: App other names the accent 'purple'; Featherbase provides: blue, green",
      })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('an upgrade adds mandatory privacy without rewriting existing rows', async ({ admin, createUser }) => {
    const source = resolve('../..', 'test-apps/other')
    const { directory, manifest } = await targetPackage()
    const policy = { version: 1, roles: ['System Manager'], shared_column: 'shared' }
    const shared = { column_name: 'shared', column_type: 'Check', default_value: '0' }
    manifest.tables[0].columns.push(shared)
    manifest.migrations[0].operations.push({ kind: 'addColumn', table: 'other.task', column: shared })
    manifest.tables[0].access_policy = policy
    manifest.migrations[0].operations.push({ kind: 'addAccessPolicy', table: 'other.task', policy })
    await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(manifest))
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      const owner = await createUser({ roles: ['System Manager'] })
      await owner.post('/api/save_row', { table: 'other.task', row: { row_id: 'private-after-upgrade', quantity: 37 } })
      const [before] = await sql`select * from other.task where row_id = 'private-after-upgrade'`
      await discoverPackages([source, directory])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      await admin.post('/api/upgrade_app', { name: 'other', version: '2.0.0', planId: plan.planId })
      await discoverPackages([source, directory])
      await loadInstalledApps()
      await admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })
      const [after] = await sql`select * from other.task where row_id = 'private-after-upgrade'`
      expect(after).toMatchObject(before)
      expect((await sql`select access_policy from table_def where name = 'other.task'`)[0].access_policy).toEqual(policy)
      const headers = { 'X-Featherbase-App-Version': 'other@2.0.0' }
      const visible = await owner.fetch('/api/table/other.task/private-after-upgrade', { headers })
      await expectStatus(visible, 200)
      expect(await visible.json()).toMatchObject({ quantity: 37 })
      await expectStatus(await admin.fetch('/api/table/other.task/private-after-upgrade', { headers }), 403)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('core identity snapshot is host derived; multiple identities never override availability or version', async ({ admin, createUser }) => {
    const { directory } = await targetPackage()
    try {
      await discoverPackages([resolve('../..', 'test-apps/fixtures/tasker-v2'), directory])
      await admin.post('/api/install_app', { name: 'tasker' })
      await admin.post('/api/install_app', { name: 'other' })
      const member = await createUser({ email: 'identity-reader@example.com', roles: [] })
      expect(await member.get('/api/runtime_app_versions')).toEqual(['other@2.0.0', 'tasker@2.0.0'])
      const read = (table: string, header: string) => admin.fetch(`/api/table/${table}`, { headers: { 'X-Featherbase-App-Version': header } })
      for (const table of ['tasker.task', 'other.task']) {
        await expectStatus(await read(table, 'other@2.0.0, tasker@2.0.0'), 200)
      }
      await expectStatus(await read('other.task', 'other@0.0.1, tasker@2.0.0'), 409)
      await expectStatus(await read('tasker.task', 'other@2.0.0'), 409)
      for (const invalid of ['tasker@2.0.0,tasker@0.0.1', 'tasker@2.0.0,tasker@2.0.0', 'other@wat,tasker@2.0.0']) {
        await expectStatus(await read('tasker.task', invalid), 417)
      }
      await admin.post('/api/set_app_enabled', { name: 'tasker', enabled: false })
      expect(await member.get('/api/runtime_app_versions')).toEqual(['other@2.0.0'])
      await expectStatus(await read('tasker.task', 'tasker@2.0.0'), 403)
      await sql`update installed_app set activation_pending = true where name = 'other'`
      expect(await member.get('/api/runtime_app_versions')).toEqual([])
      await expectStatus(await read('other.task', 'other@2.0.0'), 403)
      await sql`update installed_app set activation_pending = false, package_version = null where name = 'other'`
      expect(await member.get('/api/runtime_app_versions')).toEqual([])
      await discoverPackages([])
      await loadInstalledApps()
      expect(await member.get('/api/runtime_app_versions')).toEqual([])
      await expectStatus(await read('other.task', 'other@2.0.0'), 403)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('Tasker upgrade preserves complete existing work and matches fresh v2 schema', async ({ admin }) => {
    const source = resolve('../..', 'test-apps/fixtures/tasker-v1')
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
      await discoverPackages([source, resolve('../..', 'test-apps/other')])
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
        // Wildcard selections refresh to include new Columns; authority and provenance stay fixed.
        grants: await sql`select to_jsonb(p) - 'updated_at' as grant from permission p where owner_app = 'tasker' order by row_id`,
        preferences: await admin.get('/api/user_settings/tasker.preferences'),
      }
      await discoverPackages([source, directory, resolve('../..', 'test-apps/other')])
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
      expect(await sql`select to_jsonb(p) - 'updated_at' as grant from permission p where owner_app = 'tasker' order by row_id`).toEqual(before.grants)
      expect(await admin.get('/api/user_settings/tasker.preferences')).toEqual(before.preferences)
      for (const description of ['## Count\n\n**37** cartons, not 83.', '', null]) {
        const response = await admin.fetch('/api/save_row', { method: 'POST', headers: {
          'Content-Type': 'application/json', 'X-Featherbase-App-Version': 'tasker@2.0.0',
        }, body: JSON.stringify({ table: 'tasker.project', row: { ...before.projects[0], description } }) })
        await expectStatus(response, 201)
        // Existing optional Text API normalizes empty input to NULL.
        expect(await response.json()).toMatchObject({ description: description || null })
        const read = await admin.fetch(`/api/table/tasker.project/${project.row_id}`, { headers: { 'X-Featherbase-App-Version': 'tasker@2.0.0' } })
        expect(await read.json()).toMatchObject({ description: description || null })
        before.projects[0] = (await sql`select * from tasker.project where row_id = ${project.row_id}`)[0]
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('preview, commit, restart, activate and retry preserve asymmetric rows and grants', async ({ admin, createUser }) => {
    const source = resolve('../..', 'test-apps/other')
    const { directory } = await targetPackage()
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'kept', quantity: 37 } })
      const grants = await sql`select to_jsonb(p) - 'updated_at' as grant from permission p where owner_app = 'other' order by row_id`
      expect(await discoverPackages([source, directory])).toEqual([])
      await loadInstalledApps()
      const member = await createUser({ email: 'upgrade-reader@example.com', roles: [] })
      await expectRefused(member.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }), 403)
      const plan = await admin.post<{ planId: string; currentVersion: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      expect(plan).toMatchObject({ currentVersion: '0.0.1', targetVersion: '2.0.0', destructive: false, codeOnly: false,
        migrations: [{ id: 'add_notes' }], permissions: [], jobs: [], indexes: [] })
      expect(await admin.get('/api/table/other.task/kept')).toMatchObject({ quantity: 37, validation_runs: 1 })
      await expectRefused(admin.post('/api/upgrade_app', { name: 'other', version: '2.0.0', planId: 'stale' }), 409)
      const body = { name: 'other', version: '2.0.0', planId: plan.planId }
      expect(await admin.post('/api/upgrade_app', body)).toMatchObject({ activationPending: true })
      expect(await admin.post('/api/upgrade_app', body)).toMatchObject({ activationPending: true })
      await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }))
        .rejects.toMatchObject({ status: 409, message: expect.stringContaining('Activate the committed upgrade') })
      await expectRefused(admin.get('/api/table/other.task/kept'), 403)
      await discoverPackages([source, directory])
      await loadInstalledApps()
      await expectRefused(admin.post('/api/set_app_enabled', { name: 'other', enabled: true }), 409)
      await admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })
      await admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })
      await expectRefused(admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'late', quantity: 9 } }), 409)
      // A colleague's tab still running the previous version: refused on save and on read, told to reload.
      const stale = (path: string, init: RequestInit = {}) => member.fetch(path, { ...init, headers: {
        'Content-Type': 'application/json', 'X-Featherbase-App-Version': 'other@0.0.1', ...init.headers,
      } })
      const reloadAsked = { error: { type: 'ConflictError', message: 'App other was upgraded. Reload its current client and retry with the installed application version' } }
      const staleSave = await stale('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'other.task', row: { row_id: 'stale', quantity: 5 } }) })
      await expectStatus(staleSave, 409)
      expect(await staleSave.json()).toMatchObject(reloadAsked)
      const staleRead = await stale('/api/table/other.task/kept')
      await expectStatus(staleRead, 409)
      expect(await staleRead.json()).toMatchObject(reloadAsked)
      expect(await sql`select 1 from other.task where row_id = 'stale'`).toEqual([])
      const response = await admin.fetch('/api/save_row', { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Featherbase-App-Version': 'other@2.0.0',
      }, body: JSON.stringify({ table: 'other.task', row: { row_id: 'new', quantity: 19, notes: '**markdown**' } }) })
      await expectStatus(response, 201)
      expect(await response.json()).toMatchObject({ quantity: 19, notes: '**markdown**', validation_runs: 1 })
      expect(await sql`select to_jsonb(p) - 'updated_at' as grant from permission p where owner_app = 'other' order by row_id`).toEqual(grants)
      expect(await sql`select quantity, validation_runs, notes from other.task where row_id = 'kept'`).toEqual([{ quantity: 37, validation_runs: 1, notes: null }])
      await discoverPackages([source])
      await loadInstalledApps()
      await expectRefused(admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' }), 417)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('second DDL failure rolls back first addition and ledger; retry runs exactly once', async ({ admin }) => {
    const source = resolve('../..', 'test-apps/other')
    const { directory, manifest } = await targetPackage()
    const column = { column_name: 'second', label: 'Second', column_type: 'Text' }
    manifest.tables[0].columns.push(column)
    manifest.migrations[0].operations.push({ kind: 'addColumn', table: 'other.task', column })
    await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(manifest))
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await discoverPackages([source, directory])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      // #651: the preview runs the steps, so the collision arrives after it.
      await sql`alter table other.task add column second text`
      const body = { name: 'other', version: '2.0.0', planId: plan.planId }
      await expectRefused(admin.post('/api/upgrade_app', body), 417, 'unchanged')
      expect(await sql`select column_name from information_schema.columns where table_schema = 'other' and table_name = 'task' and column_name = 'notes'`).toEqual([])
      expect(await sql`select column_name from column_def where parent = 'other.task' and column_name in ('notes', 'second')`).toEqual([])
      expect(await sql`select package_version, migration_ledger, activation_pending from installed_app where name = 'other'`).toEqual([
        { package_version: '0.0.1', migration_ledger: [], activation_pending: false },
      ])
      expect(await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'old-hook', quantity: 47 } })).toMatchObject({ validation_runs: 1 })
      await sql`alter table other.task drop column second`
      await admin.post('/api/upgrade_app', body)
      await admin.post('/api/upgrade_app', body)
      expect(await sql`select column_name from column_def where parent = 'other.task' and column_name in ('notes', 'second') order by column_name`).toEqual([{ column_name: 'notes' }, { column_name: 'second' }])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('malformed, incompatible, skipped, changed permissions and undeclared destructive changes fail closed', async ({ admin }) => {
    const source = resolve('../..', 'test-apps/other')
    const { directory, manifest } = await targetPackage()
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      const edits = [
        { ...manifest, platformVersion: '2099-01' },
        { ...manifest, dependencies: ['absent'] },
        { ...manifest, migrations: [{ ...manifest.migrations[0], operations: [{ kind: 'dropColumn', table: 'other.task', column: 'quantity' }] }] },
        { ...manifest, migrations: [manifest.migrations[0], manifest.migrations[0]] },
      ]
      for (const changed of edits) {
        await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(changed))
        expect(await discoverPackages([source, directory])).toHaveLength(1)
        await loadInstalledApps()
        await expectRefused(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }), 417)
      }
      for (const changed of [
        { ...manifest, migrations: [{ ...manifest.migrations[0], fromVersion: '1.5.0' }] },
        // #437: withdrawing a grant is allowed; adding one never is.
        { ...manifest, permissions: [...manifest.permissions, { table: 'Comment', role: 'All', operations: { read: '*' } }] },
        { ...manifest, tables: manifest.tables.map((t: { columns: unknown[] }) => ({ ...t, columns: t.columns.slice(1) })) },
      ]) {
        await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(changed))
        expect(await discoverPackages([source, directory])).toEqual([])
        await loadInstalledApps()
        await expectRefused(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }), 417)
      }
      expect(await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'still-old', quantity: 31 } })).toMatchObject({ validation_runs: 1 })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('preview digest changes on enablement; missing and edited artifact cannot mutate schema', async ({ admin }) => {
    const source = resolve('../..', 'test-apps/other')
    const { directory } = await targetPackage()
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await discoverPackages([source, directory])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      expect(await admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })).toEqual(plan)
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      await expectRefused(admin.post('/api/upgrade_app', { name: 'other', version: '2.0.0', planId: plan.planId }), 409)
      await writeFile(resolve(directory, 'server.mjs'), "export const platformVersion = '2099-01'")
      await expectRefused(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }), 417, 'changed')
      await rm(directory, { recursive: true })
      await expectRefused(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }), 417, 'missing')
      expect(await sql`select package_version from installed_app where name = 'other'`).toEqual([{ package_version: '0.0.1' }])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  committedTest('upgrade waits for admitted post-commit save; queued disable preserves disabled activation', async ({ admin }) => {
    const source = resolve('../..', 'test-apps/other')
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
      expect(await sql`select quantity, validation_runs from other.task where row_id = 'tail'`).toEqual([{ quantity: 83, validation_runs: 1 }])
      expect(await admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })).toMatchObject({ enabled: false })
      await expectRefused(admin.get('/api/table/other.task/tail'), 403)
    } finally {
      release()
      await Promise.allSettled(work)
      unregisterController(controller)
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('duplicate-different targets and same-version replacement after commit cannot replay success', async ({ admin }) => {
    const source = resolve('../..', 'test-apps/other')
    const { directory, manifest } = await targetPackage()
    const duplicate = await mkdtemp(resolve('test/.upgrade-duplicate-'))
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await cp(directory, duplicate, { recursive: true })
      await writeFile(resolve(duplicate, 'featherbase.json'), JSON.stringify({ ...manifest, title: 'Different artifact, same version' }))
      expect(await discoverPackages([source, directory, duplicate])).toHaveLength(1)
      await expectRefused(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }), 417)
      await discoverPackages([source, directory])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      const body = { name: 'other', version: '2.0.0', planId: plan.planId }
      await admin.post('/api/upgrade_app', body)
      const committed = await sql`select * from installed_app where name = 'other'`
      await discoverPackages([source, duplicate])
      await loadInstalledApps()
      await expectRefused(admin.post('/api/upgrade_app', body), 417, 'committed')
      await expectRefused(admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' }), 417)
      expect(await sql`select * from installed_app where name = 'other'`).toEqual(committed)
    } finally { await rm(directory, { recursive: true, force: true }); await rm(duplicate, { recursive: true, force: true }) }
  })

  test('disabled upgrade, checksum drift, downgrade, missing prior and code-only next version', async ({ admin }) => {
    const source = resolve('../..', 'test-apps/other')
    const { directory, manifest } = await targetPackage()
    const next = await mkdtemp(resolve('test/.upgrade-next-'))
    try {
      await discoverPackages([source])
      await admin.post('/api/install_app', { name: 'other' })
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      await discoverPackages([directory])
      await expectRefused(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }), 417, 'unavailable')
      await discoverPackages([source, directory])
      const first = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
      await admin.post('/api/upgrade_app', { name: 'other', version: '2.0.0', planId: first.planId })
      expect(await admin.post('/api/activate_app_upgrade', { name: 'other', version: '2.0.0' })).toMatchObject({ enabled: false })
      await expectRefused(admin.post('/api/preview_app_upgrade', { name: 'other', version: '0.0.1' }), 417, 'downgrades')
      await cp(directory, next, { recursive: true })
      const pkg = JSON.parse(await readFile(resolve(next, 'package.json'), 'utf8'))
      await writeFile(resolve(next, 'package.json'), JSON.stringify({ ...pkg, version: '3.0.0' }))
      const migrations = [...manifest.migrations, { id: 'client_refresh', fromVersion: '2.0.0', toVersion: '3.0.0', operations: [] }]
      await writeFile(resolve(next, 'featherbase.json'), JSON.stringify({ ...manifest, migrations: [{ ...migrations[0], id: 'rewritten_history' }, migrations[1]] }))
      expect(await discoverPackages([source, directory, next])).toEqual([])
      await expectRefused(admin.post('/api/preview_app_upgrade', { name: 'other', version: '3.0.0' }), 417, 'checksum')
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

describe('An upgrade never goes backward', () => {
  test('upgrade preview requires an installed app whose recorded artifact matches', async ({ admin }) => {
    const source = resolve('../..', 'test-apps/other')
    const { directory } = await targetPackage()
    try {
      await discoverPackages([source])
      await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }))
        .rejects.toMatchObject({ status: 417, message: expect.stringContaining('installed runtime application') })
      await admin.post('/api/install_app', { name: 'other' })
      await discoverPackages([source, directory])
      const [identity] = await sql`select artifact_digest from installed_app where name = 'other'`
      await sql`update installed_app set artifact_digest = 'mismatched' where name = 'other'`
      await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }))
        .rejects.toMatchObject({ status: 417, message: expect.stringContaining('recorded identity') })
      await expect(admin.post('/api/set_app_enabled', { name: 'other', enabled: true }))
        .rejects.toMatchObject({ status: 417, message: expect.stringContaining('exact installed artifact') })
      expect(await sql`select package_version, activation_pending from installed_app where name = 'other'`)
        .toEqual([{ package_version: '0.0.1', activation_pending: false }])
      await sql`update installed_app set artifact_digest = ${identity.artifact_digest} where name = 'other'`
      expect(await admin.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }))
        .toMatchObject({ currentVersion: '0.0.1', targetVersion: '2.0.0' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('previewing an upgrade to the version already installed is refused and changes nothing', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    const [{ package_version: installed }] = await sql`select package_version from installed_app where name = 'other'`
    await expect(admin.post('/api/preview_app_upgrade', { name: 'other', version: installed }))
      .rejects.toMatchObject({ status: 417, message: expect.stringContaining('newer') })
    expect(await sql`select package_version, activation_pending from installed_app where name = 'other'`)
      .toEqual([{ package_version: installed, activation_pending: false }])
  })
})

describe('explicit_runtime_policy_upgrade', () => {
  test('a policy written into the installed version, without a new version, makes the app unavailable until the exact artifact returns', async ({ admin }) => {
    const copy = await mkdtemp(resolve('test/.relabel-'))
    const header = { 'X-Featherbase-App-Version': 'tasker@2.0.0' }
    try {
      await cp(resolve('../..', 'test-apps/fixtures/tasker-v2'), copy, { recursive: true })
      expect(await discoverPackages([copy])).toEqual([])
      await admin.post('/api/install_app', { name: 'tasker' })
      await expectStatus(await admin.fetch('/api/table/tasker.task', { headers: header }), 200)
      const file = resolve(copy, 'featherbase.json')
      const original = await readFile(file, 'utf8')
      const manifest = JSON.parse(original)
      const policy = { policy: { kind: 'table' }, authorization: { kind: 'generic' } }
      manifest.actions = { version: 2, operations: { promote: policy, delete_accidental: policy }, tables: manifest.actions.tables }
      await writeFile(file, JSON.stringify(manifest))
      await discoverPackages([copy])
      await loadInstalledApps()
      await expectStatus(await admin.fetch('/api/table/tasker.task', { headers: header }), 403)
      const promote = await admin.fetch('/api/app_actions/tasker/promote', { method: 'POST',
        headers: { ...header, 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'relabelled', payload: { row_id: 'x', updated_at: 'y' } }) })
      await expectStatus(promote, 403)
      expect((await admin.get<{ installed: unknown[] }>('/api/apps')).installed)
        .toContainEqual(expect.objectContaining({ name: 'tasker', available: false, active: false }))
      await writeFile(file, original)
      await discoverPackages([copy])
      await loadInstalledApps()
      await expectStatus(await admin.fetch('/api/table/tasker.task', { headers: header }), 200)
    } finally { await rm(copy, { recursive: true, force: true }) }
  })
})
