import { describe, expect } from 'vitest'
import { join, resolve } from 'node:path'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { test as base } from './pg-test'
import { committedTest } from './pg-test-shared'
import type { TestClient, CreateUserFn } from 'feather-testing-postgres'
import { admitTasker, taskerClient } from './tasker-client'
import { artifactDigest, discoverPackages, findScopeProvider, shippedUpgrades } from '../src/runtime-packages'
import { loadInstalledApps, uninstallApp } from '../src/apps'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { registerController, unregisterController, type TableController } from '../src/controllers'
import { importCustomizations } from '../src/customizations'
import { getMeta, invalidateMeta } from '../src/meta'
import { app } from '../src/index'
import { expectRefused, expectStatus } from './fixtures'

const test = base.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(taskerClient(admin)),
  createUser: async ({ createUser }, use) => use(async options => taskerClient(await createUser(options))),
})

describe('Rejected runtime artifacts never become applications', () => {
  type PackageFiles = { root: string; manifest: Record<string, any>; npm: Record<string, any> }
  type Rejection = { name: string; error: string; change: (files: PackageFiles) => void | Promise<void> }
  const provider = { name: 'places', tables: ['other.task'] }
  const actions = { version: 2, tables: ['other.task'], operations: {
    count: { policy: { kind: 'table' }, authorization: { kind: 'generic' } },
  } }
  const serverExports = (body: string) => async ({ root }: PackageFiles) => {
    await writeFile(resolve(root, 'server.mjs'), `export const platformVersion = '2026-10'\n${body}\n`)
  }
  const rejected: Rejection[] = [
    ...['name', 'version'].map((field): Rejection => ({
      name: `npm identity lacks ${field}`, error: 'Expected npm package name and version',
      change: ({ npm }) => { delete npm[field] },
    })),
    { name: 'absolute manifest path', error: 'Package paths must be relative',
      change: ({ root, npm }) => { npm.featherbase = resolve(root, 'featherbase.json') } },
    { name: 'manifest path points at its root', error: 'Package path escapes its declared root',
      change: ({ npm }) => { npm.featherbase = '.' } },
    { name: 'escaping manifest path', error: 'Package path escapes its declared root',
      change: async ({ root, npm }) => {
        await cp(resolve(root, 'featherbase.json'), resolve(root, '../outside.json'))
        npm.featherbase = '../outside.json'
      } },
    { name: 'artifact contains a symlink', error: 'Package artifact must not contain symbolic links',
      change: async ({ root }) => { await symlink('server.mjs', resolve(root, 'linked.mjs')) } },
    { name: 'duplicate Table declaration', error: 'Duplicate Tables or unknown entryTable',
      change: ({ manifest }) => { manifest.tables.push(structuredClone(manifest.tables[0])) } },
    { name: 'entry Table is absent', error: 'Duplicate Tables or unknown entryTable',
      change: ({ manifest }) => { manifest.entryTable = 'other.absent' } },
    ...[
      ['unqualified Table', { name: 'Task' }],
      ['foreign Table', { name: 'someone.task' }],
      ['missing Table label', { label: null }],
      ['system Table', { system: true }],
      ['external storage', { data_source: 'remote' }],
    ].map(([name, fields]): Rejection => ({
      name: String(name), error: 'Package Tables require qualified ownership, label and local storage',
      change: ({ manifest }) => {
        Object.assign(manifest.tables[0], fields)
        // Keep entryTable valid so the ownership/storage guard is reached.
        manifest.entryTable = manifest.tables[0].name
      },
    })),
    { name: 'client is a file', error: 'Client root is not a directory',
      change: ({ manifest }) => { manifest.client = 'server.mjs' } },
    { name: 'absolute client path', error: 'Package paths must be relative',
      change: ({ root, manifest }) => { manifest.client = resolve(root, 'client') } },
    { name: 'escaping client path', error: 'Package path escapes its declared root',
      change: ({ manifest }) => { manifest.client = '..' } },
    { name: 'provider has no server', error: 'A scope provider requires a server module',
      change: ({ manifest }) => { manifest.scopeProvider = provider; delete manifest.server } },
    { name: 'provider reads an unmarked Table', error: 'A scope provider reads only Tables marked decides_scope',
      change: ({ manifest }) => { manifest.scopeProvider = provider } },
    { name: 'provider reads a Table containing Sub-tables', error: 'A scope provider cannot read Tables with Sub-tables',
      change: ({ manifest }) => {
        manifest.scopeProvider = provider
        manifest.tables[0].decides_scope = true
        manifest.tables.push({ ...structuredClone(manifest.tables[0]), name: 'other.line', kind: 'sub_table' })
        manifest.tables[0].columns.push({ column_name: 'lines', column_type: 'Sub-table', row_table: 'other.line' })
      } },
    { name: 'provider handler is absent', error: 'Package handlers and authorization callbacks must match declared names',
      change: ({ manifest }) => {
        manifest.scopeProvider = provider
        manifest.tables[0].decides_scope = true
      } },
    { name: 'operations have no server', error: 'Declared operations require a server module',
      change: ({ manifest }) => { manifest.actions = actions; delete manifest.server } },
    { name: 'reads have no server', error: 'Declared operations require a server module',
      change: ({ manifest }) => { manifest.reads = { ...actions, version: 1 }; delete manifest.server } },
    { name: 'shared action Table lacks a permission', error: 'Shared action Tables require declared permissions; other apps are not allowed',
      change: ({ manifest }) => { manifest.actions = { ...actions, tables: ['Comment'] } } },
    { name: 'action names another app despite a permission', error: 'Shared action Tables require declared permissions; other apps are not allowed',
      change: ({ manifest }) => {
        manifest.actions = { ...actions, tables: ['tasker.task'] }
        manifest.permissions.push({ table: 'tasker.task', role: 'All', operations: { read: '*' } })
      } },
    { name: 'absolute server path', error: 'Package paths must be relative',
      change: ({ root, manifest }) => { manifest.server = resolve(root, 'server.mjs') } },
    { name: 'escaping server path', error: 'Package path escapes its declared root',
      change: ({ manifest }) => { manifest.server = '..' } },
    { name: 'uncompiled server module', error: 'Server module must be compiled JavaScript',
      change: async ({ root, manifest }) => {
        await cp(resolve(root, 'server.mjs'), resolve(root, 'server.ts'))
        manifest.server = 'server.ts'
      } },
    { name: 'handlers are an array', error: 'Expected named package functions', change: serverExports('export const actions = []') },
    { name: 'handlers are a scalar', error: 'Expected named package functions', change: serverExports('export const actions = 37') },
    { name: 'undeclared handler', error: 'Package handlers and authorization callbacks must match declared names',
      change: serverExports('export const actions = { count() {} }') },
    { name: 'declared handler is absent', error: 'Package handlers and authorization callbacks must match declared names',
      change: ({ manifest }) => { manifest.actions = actions } },
    { name: 'declared handler is not callable', error: 'Package handlers and authorization callbacks must match declared names',
      change: async (files) => {
        files.manifest.actions = actions
        await serverExports('export const actions = { count: 37 }')(files)
      } },
    { name: 'handler uses the wrong declared name', error: 'Package handlers and authorization callbacks must match declared names',
      change: async (files) => {
        files.manifest.actions = actions
        await serverExports('export const actions = { different() {} }')(files)
      } },
    { name: 'validator targets a foreign Table', error: 'Validators must target owned Tables',
      change: serverExports("export const validators = { 'tasker.task'() {} }") },
    { name: 'validator is not callable', error: 'Validators must target owned Tables',
      change: serverExports("export const validators = { 'other.task': 37 }") },
    { name: 'destructive guard targets a foreign Table', error: 'Destructive guards must target owned Tables',
      change: serverExports("export const destructiveGuards = { 'tasker.task'() {} }") },
    { name: 'destructive guard is not callable', error: 'Destructive guards must target owned Tables',
      change: serverExports("export const destructiveGuards = { 'other.task': 37 }") },
  ]

  test.for(rejected)('$name is refused before registration', async ({ change, error }, { admin }) => {
    const directory = await mkdtemp(resolve('test/.runtime-rejected-'))
    const root = resolve(directory, 'package')
    try {
      await cp(resolve('../..', 'test-apps/other'), root, { recursive: true })
      const manifest = JSON.parse(await readFile(resolve(root, 'featherbase.json'), 'utf8'))
      const npm = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
      await change({ root, manifest, npm })
      await writeFile(resolve(root, 'featherbase.json'), JSON.stringify(manifest))
      await writeFile(resolve(root, 'package.json'), JSON.stringify(npm))
      expect(await discoverPackages([root])).toEqual([{ path: root, error }])
      const status = await admin.get<{ available: string[]; installed: unknown[]; versions: unknown[]; actions: unknown[]; failures: unknown[] }>('/api/apps')
      expect(status.available).not.toContain('other')
      expect(status.installed).toEqual([])
      expect(status.versions).toEqual([])
      expect(status.actions).toEqual([])
      // HTTP diagnostics deliberately hide operator paths and module details.
      expect(status.failures).toEqual([{ error: 'A configured artifact failed validation. Restore a compatible immutable package and inspect the server discovery log' }])
      await expect(admin.post('/api/install_app', { name: 'other' })).rejects.toMatchObject({
        status: 417, type: 'ValidationError', message: '417 ValidationError: Unknown app: other', fields: { name: 'Not registered' },
      })
      expect(await admin.get('/api/app_catalog')).toEqual([])
      expect(await findScopeProvider()).toBeUndefined()
      expect(await sql`select name from installed_app where name = 'other'`).toEqual([])
      expect(await sql`select name from table_def where name = 'other.task'`).toEqual([])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('identical artifacts on multiple paths register one installable version', async ({ admin }) => {
    const directory = await mkdtemp(resolve('test/.runtime-duplicates-'))
    try {
      const first = resolve(directory, 'first')
      const second = resolve(directory, 'second')
      for (const root of [first, second]) await cp(resolve('../..', 'test-apps/other'), root, { recursive: true })
      expect(await discoverPackages([first, second, first])).toEqual([])
      const status = await admin.get<{ versions: { name: string; version: string; digest: string }[] }>('/api/apps')
      expect(status.versions).toEqual([{ name: 'other', version: '0.0.1', digest: expect.stringMatching(/^[a-f0-9]{64}$/) }])
      await admin.post('/api/install_app', { name: 'other' })
      expect(await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'once', quantity: 13 } }))
        .toMatchObject({ validation_runs: 1 })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('conflicting artifacts quarantine every copy of the version', async ({ admin }) => {
    const directory = await mkdtemp(resolve('test/.runtime-conflicts-'))
    try {
      const roots = ['first', 'changed', 'third'].map(name => resolve(directory, name))
      for (const root of roots) await cp(resolve('../..', 'test-apps/other'), root, { recursive: true })
      await writeFile(resolve(roots[1], 'extra.txt'), 'different immutable artifact')
      expect(await discoverPackages(roots)).toEqual(roots.slice(1).map(path => ({
        path, error: 'Duplicate different artifacts for one package version',
      })))
      const status = await admin.get<{ available: string[]; versions: unknown[]; installed: unknown[]; actions: unknown[] }>('/api/apps')
      expect(status.available).not.toContain('other')
      expect(status.versions).toEqual([])
      expect(status.installed).toEqual([])
      expect(status.actions).toEqual([])
      await expect(admin.post('/api/install_app', { name: 'other' })).rejects.toMatchObject({
        status: 417, type: 'ValidationError', message: '417 ValidationError: Unknown app: other', fields: { name: 'Not registered' },
      })
      expect(await findScopeProvider()).toBeUndefined()
      expect(await sql`select name from table_def where name = 'other.task'`).toEqual([])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test.for([
    { name: 'changed', error: 'Package artifact changed; restore immutable files and restart before previewing again' },
    { name: 'missing', error: 'Package artifact is missing; restore the exact version and restart' },
    { name: 'symlinked', error: 'Package artifact must not contain symbolic links' },
  ])('a $name discovered artifact cannot be installed', async ({ name, error }, { admin }) => {
    const root = await mkdtemp(resolve('test/.runtime-immutable-'))
    try {
      await cp(resolve('../..', 'test-apps/other'), root, { recursive: true })
      expect(await discoverPackages([root])).toEqual([])
      if (name === 'changed') await writeFile(resolve(root, 'extra.txt'), 'post-discovery change')
      else if (name === 'missing') await rm(root, { recursive: true })
      else await symlink('server.mjs', resolve(root, 'linked.mjs'))
      await expect(admin.post('/api/install_app', { name: 'other' })).rejects.toMatchObject({
        status: 417, type: 'ValidationError', message: `417 ValidationError: ${error}`,
      })
      expect(await sql`select name from installed_app where name = 'other'`).toEqual([])
      expect(await sql`select name from table_def where name = 'other.task'`).toEqual([])
      expect(await admin.get('/api/app_catalog')).toEqual([])
      expect(await findScopeProvider()).toBeUndefined()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

describe('PKG-R1/PKG-R3: trusted package lifecycle', () => {
  test('shipped upgrades choose 1.10 over 1.9 regardless of artifact discovery order', async ({ admin }) => {
    const directory = await mkdtemp(resolve('test/.runtime-newest-'))
    try {
      const installed = resolve(directory, 'installed')
      await cp(resolve('../..', 'test-apps/other'), installed, { recursive: true })
      expect(await discoverPackages([installed])).toEqual([])
      await admin.post('/api/install_app', { name: 'other' })
      const versions = ['1.9.0', '1.10.0']
      const roots = versions.map(version => resolve(directory, version))
      const migrations = versions.map((version, index) => ({
        id: `release_${index + 1}`, fromVersion: index === 0 ? '0.0.1' : versions[index - 1],
        toVersion: version, operations: [],
      }))
      for (const [index, root] of roots.entries()) {
        await cp(installed, root, { recursive: true })
        const npm = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
        const manifest = JSON.parse(await readFile(resolve(root, 'featherbase.json'), 'utf8'))
        await writeFile(resolve(root, 'package.json'), JSON.stringify({ ...npm, version: versions[index] }))
        await writeFile(resolve(root, 'featherbase.json'), JSON.stringify({ ...manifest, migrations: migrations.slice(0, index + 1) }))
      }
      const rows = await sql`select name, package_version, migration_ledger from installed_app where name = 'other'`
      const expected = [{ name: 'other', from: '0.0.1', to: '1.10.0', ownsClient: true, migrations }]
      expect(await shippedUpgrades(rows, roots)).toEqual(expected)
      expect(await shippedUpgrades(rows, [...roots].reverse())).toEqual(expected)
      expect(await sql`select package_version, migration_ledger from installed_app where name = 'other'`)
        .toEqual([{ package_version: '0.0.1', migration_ledger: [] }])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('PKG-R6: legacy human deep links redirect to Featherbase while technical roots remain reserved', async ({ api }) => {
    const old = await api.fetch('/admin/Tasker%20Task/one?view=board')
    await expectStatus(old, 308)
    expect(old.headers.get('location')).toBe('/featherbase/admin/Tasker%20Task/one?view=board')
    const login = await api.fetch('/login?next=%2Ftasker%2F')
    await expectStatus(login, 308)
    expect(login.headers.get('location')).toBe('/featherbase/login?next=%2Ftasker%2F')
    const technical = await api.fetch('/api/not-a-route')
    await expectStatus(technical, 401)
    expect(technical.headers.get('location')).toBeNull()
  })

  test('PKG-R1: reserved names fail discovery; failed installation leaves no Tables or activation', async ({ admin }) => {
    const directory = await mkdtemp(resolve('test/.runtime-package-'))
    try {
      await cp(resolve('../..', 'test-apps/other'), directory, { recursive: true })
      const file = resolve(directory, 'featherbase.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      for (const name of ['featherbase', 'api', 'assets']) {
        await writeFile(file, JSON.stringify({ ...manifest, name }))
        expect(await discoverPackages([directory])).toEqual([expect.objectContaining({ error: expect.stringContaining('reserved') })])
      }
      await writeFile(file, JSON.stringify({ ...manifest, permissions: [{ table: 'other.task', role: 'Role that does not exist', operations: { read: '*' } }] }))
      expect(await discoverPackages([directory])).toEqual([])
      await expectRefused(admin.post('/api/install_app', { name: 'other' }), 417)
      expect(await sql`select name from table_def where name = 'other.task'`).toHaveLength(0)
      expect(await sql`select name from installed_app where name = 'other'`).toHaveLength(0)
      expect(await admin.get('/api/app_catalog')).toEqual([])
      await writeFile(file, JSON.stringify(manifest))
      await discoverPackages([directory])
      await admin.post('/api/install_app', { name: 'other' })
      await expectRefused(admin.post('/api/install_app', { name: 'other' }), 409)
      expect(await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'once', quantity: 17 } })).toMatchObject({ validation_runs: 1 })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('PKG-R2: customization cannot change identity, storage, binding or hook dispatch', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    for (const property of ['name', 'owner_app', 'physical_schema', 'physical_relation', 'data_source', 'row_key', 'columns']) {
      const row = { row_id: `override-${property}`, table_name: 'other.task', column_name: null, property, value: 'tasker' }
      await expectRefused(admin.post('/api/table/Metadata%20Override', row), 417, 'cannot be overridden')
      await expect(importCustomizations({ property_setters: [row] })).rejects.toMatchObject({ type: 'ValidationError' })
    }
    await admin.post('/api/table/Metadata%20Override', {
      row_id: 'override-label', table_name: 'other.task', property: 'label', value: 'Counting task',
    })
    expect(await getMeta('other.task')).toMatchObject({ name: 'other.task', label: 'Counting task', physical_schema: 'other' })
    // A pre-existing unsafe override must not get applied on the next boot.
    await sql`insert into metadata_override (row_id, table_name, property, value) values ('legacy-unsafe', 'other.task', 'name', 'Task')`
    invalidateMeta('other.task')
    await expect(getMeta('other.task')).rejects.toMatchObject({ type: 'ValidationError' })
  })

  test('PKG-R3: no database role but the owner can read app relations outside the availability-aware API', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    for (const enabled of [true, false]) {
      await admin.post('/api/set_app_enabled', { name: 'other', enabled })
      expect(await sql`select count(*)::int as grants from pg_class c, aclexplode(c.relacl) a where c.oid = 'other.task'::regclass and a.grantee <> c.relowner`).toEqual([{ grants: 0 }])
    }
  })

  // This race requires independent requests/connections, not the shared
  // sandbox dispatcher: disable must reach its lock while save is paused.
  committedTest('PKG-R3: disable waits for the post-commit tail, including a nested save', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const controller: TableController = { table: 'other.task', hooks: { after_commit: async ctx => {
      if (ctx.row.row_id !== 'parent') return
      entered()
      await gate
      await saveDoc('other.task', { row_id: 'tail', quantity: 29 })
    } } }
    registerController(controller)
    const save = admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'parent', quantity: 41 } })
    let disable: Promise<unknown> | undefined
    try {
      await started
      disable = admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      await expect.poll(async () => {
        const [row] = await sql`select count(*)::int as waiting from pg_locks where locktype = 'advisory' and classid = 296 and objid = 1 and not granted`
        return row.waiting
      }).toBe(1)
      release()
      await save
      await disable
      await expectRefused(admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'late', quantity: 9 } }), 403)
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
      expect(await admin.get('/api/table/other.task/tail')).toMatchObject({ quantity: 29, validation_runs: 1 })
    } finally {
      release()
      await Promise.allSettled([save, disable])
      unregisterController(controller)
      await uninstallApp('other')
    }
  })

  test('PKG-R2 PKG-H1: two real packages isolate IDs, references, rules and ordinary-user grants', async ({ admin, createUser }) => {
    expect(await discoverPackages([resolve('../..', 'example-apps/tasker'), resolve('../..', 'test-apps/other')])).toEqual([])
    await admin.post('/api/install_app', { name: 'tasker' })
    await admin.post('/api/install_app', { name: 'other' })
    const member = await createUser({ email: 'two-packages@example.com', roles: ['Tasker Member'] })
    const task = await member.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.task', row: { task_title: 'Only Tasker owns this title', task_state: 'In progress' },
    })
    const id = task.row_id
    await admin.post('/api/save_row', { table: 'other.task', row: { row_id: id, quantity: 37 } })
    expect(await member.get(`/api/table/tasker.task/${id}`)).toMatchObject({ task_title: 'Only Tasker owns this title', task_state: 'In progress' })
    const other = await member.get<Record<string, unknown>>(`/api/table/other.task/${id}`)
    expect(other).toMatchObject({ quantity: 37, validation_runs: 1 })
    expect(other).not.toHaveProperty('task_title')
    await expectRefused(member.post('/api/save_row', { table: 'other.task', row: { ...other, quantity: 18 } }), 403)
    await expectRefused(admin.post('/api/save_row', { table: 'other.task', row: { ...other, quantity: -2 } }), 417)
    await admin.post('/api/table_def', { name: 'Package pointer', id_pattern: 'prompt', columns: [
      { column_name: 'target', column_type: 'Reference', reference_table: 'other.task' },
    ] })
    await admin.post('/api/save_row', { table: 'Package pointer', row: { row_id: 'explicit', target: id } })
    const lone = await member.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Absent from Other' } })
    await expectRefused(admin.post('/api/save_row', { table: 'Package pointer', row: { row_id: 'wrong-owner', target: lone.row_id } }), 417)
    expect(await member.get('/api/table/Comment')).toMatchObject({ data: [] })
    await admin.post('/api/set_app_enabled', { name: 'tasker', enabled: false })
    await expectRefused(member.post('/api/save_row', { table: 'tasker.task', row: { ...task, is_done: true } }), 403)
    await expectRefused(member.get('/api/table/Comment'), 403)
    await expectRefused(member.get('/api/table/Person'), 403)
    expect(await admin.post('/api/save_row', { table: 'other.task', row: { ...other, quantity: 23 } })).toMatchObject({ quantity: 23, validation_runs: 2 })
    await admin.post('/api/set_app_enabled', { name: 'tasker', enabled: true })
    expect(await member.get('/api/table/Comment')).toMatchObject({ data: [] })
    expect(await member.post('/api/save_row', { table: 'tasker.task', row: { ...task, is_done: true } })).toMatchObject({ task_state: 'Done', state_before_done: 'In progress' })
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    await expectRefused(admin.post('/api/save_row', { table: 'Package pointer', row: { row_id: 'disabled-target', target: id } }), 403)
  })

  test('PKG-R3: equivalent shared-table grants remain independent across packages', async ({ admin, createUser }) => {
    const other = await mkdtemp(resolve('test/.runtime-shared-grant-'))
    try {
      await cp(resolve('../..', 'test-apps/other'), other, { recursive: true })
      const file = resolve(other, 'featherbase.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      manifest.permissions.push(
        // #437: a shared core Table both packages grant on (Tasker's Comment grant).
        { table: 'Comment', role: 'Tasker Member', operations: { read: ['content'] } },
      )
      await writeFile(file, JSON.stringify(manifest))
      expect(await discoverPackages([resolve('../..', 'example-apps/tasker'), other])).toEqual([])
      await admin.post('/api/install_app', { name: 'tasker' })
      await admin.post('/api/install_app', { name: 'other' })
      // Each package owns its own declaration of the shared grant.
      expect(await sql`
        select owner_app from permission
        where ref_table = 'Comment' and operation = 'read' and owner_app in ('tasker', 'other')
        order by owner_app`
      ).toEqual([
        { owner_app: 'other' },
        { owner_app: 'tasker' },
      ])
      const member = await createUser({ email: 'shared-grants@example.com', roles: ['Tasker Member'] })
      expect((await member.get<{ data: unknown[] }>('/api/table/Comment')).data).toBeInstanceOf(Array)
      expect(await member.get('/api/table/Comment?fields=%5B%22ref_name%22%5D')).toMatchObject({ data: [] })

      await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      expect((await member.get<{ data: unknown[] }>('/api/table/Comment')).data).toBeInstanceOf(Array)
      expect(await member.get('/api/table/Comment?fields=%5B%22ref_name%22%5D')).toMatchObject({ data: [] })
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
      await admin.post('/api/set_app_enabled', { name: 'tasker', enabled: false })
      expect((await member.get<{ data: unknown[] }>('/api/table/Comment')).data).toBeInstanceOf(Array)
      await expectRefused(member.get('/api/table/Comment?fields=%5B%22ref_name%22%5D'), 417)
      expect(await member.get('/api/table/Comment?fields=%5B%22content%22%5D')).toMatchObject({ data: [] })
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      await expectRefused(member.get('/api/table/Comment'), 403)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  test('disable rejects stale writes, preserves rows, and enable wires validation once', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    const row = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'other.task', row: { row_id: 'same', quantity: 37 },
    })
    expect(row.validation_runs).toBe(1)
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    await expect(admin.post('/api/save_row', {
      table: 'other.task', row: { ...row, quantity: -9 },
    })).rejects.toMatchObject({ status: 403 })
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
    expect(await admin.get('/api/table/other.task/same')).toMatchObject({ quantity: 37 })
    await expect(admin.post('/api/save_row', {
      table: 'other.task', row: { ...row, quantity: -9 },
    })).rejects.toMatchObject({ status: 417, fields: { quantity: 'Must be positive' } })
    expect(await admin.post('/api/save_row', {
      table: 'other.task', row: { ...row, quantity: 11 },
    })).toMatchObject({ validation_runs: 2 })
  })

  test('PKG-R4: ordinary member catalog and client root are separate from management and server files', async ({ api, admin, createUser }) => {
    expect(await discoverPackages([resolve('../..', 'test-apps/other')])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    for (const [request, location] of [
      ['/other', '/other/'],
      ['/other?', '/other/'],
      ['/other?review=deep-link&note=37%20cartons%2F83&review=again',
        '/other/?review=deep-link&note=37%20cartons%2F83&review=again'],
      ['/other?malformed=%E0%A4%A', '/other/?malformed=%E0%A4%A'],
    ]) {
      const normalized = await api.fetch(request)
      expect(normalized.status, request).toBe(308)
      expect(normalized.headers.get('location'), request).toBe(location)
    }
    for (const unsafe of ['/api?next=%2Fother', '/other%2F?review=deep-link', '/other\\evil?review=deep-link']) {
      const refused = await api.fetch(unsafe)
      expect(refused.headers.get('location'), unsafe).toBeNull()
    }
    const signIn = await api.fetch('/other/', { headers: { accept: 'text/html' } })
    await expectStatus(signIn, 302)
    expect(signIn.headers.get('location')).toBe('/featherbase/login?next=%2Fother%2F')
    const deepSignIn = await api.fetch('/other/review/item?filter=a%26b&owner=me', {
      headers: { accept: 'text/html' },
    })
    await expectStatus(deepSignIn, 302)
    expect(deepSignIn.headers.get('location')).toBe(
      '/featherbase/login?next=%2Fother%2Freview%2Fitem%3Ffilter%3Da%2526b%26owner%3Dme',
    )
    const malformed = await api.fetch('/other/%E0%A4%A', { headers: { accept: 'text/html' } })
    await expectStatus(malformed, 404)
    expect(malformed.headers.get('location')).toBeNull()
    expect(await sql`select row_id from home_page where module = 'Other'`).toEqual([])
    const member = await createUser({ email: 'runtime-reader@example.com', roles: ['All'] })
    await expectRefused(admin.post('/api/uninstall_app', { name: 'other' }), 417)
    expect(await member.get('/api/app_catalog')).toEqual([
      { name: 'other', title: 'Other tasks', href: '/other/' },
    ])
    const signedInRoot = await member.fetch('/other?review=member&note=a%2Fb')
    await expectStatus(signedInRoot, 308)
    expect(signedInRoot.headers.get('location')).toBe('/other/?review=member&note=a%2Fb')
    await expectRefused(member.get('/api/apps'), 403)
    await expect(member.post('/api/save_row', { table: 'other.task', row: { row_id: 'no', quantity: 3 } }))
      .rejects.toMatchObject({ status: 403 })
    const page = await member.fetch('/other/')
    await expectStatus(page, 200)
    const rootHtml = await page.text()
    expect(rootHtml).toContain('<h1>Other tasks</h1>')
    expect(rootHtml).toContain('<featherbase-bar data-app="other" data-title="Other tasks"></featherbase-bar>')
    const deepPage = await member.fetch('/other/review/37?filter=a%26b', { headers: { accept: 'text/html' } })
    await expectStatus(deepPage, 200)
    const deepHtml = await deepPage.text()
    expect(deepHtml).not.toContain('<base ')
    expect(deepHtml).toContain('<script type="module" src="/other/main.js">')
    expect(deepHtml).toContain('<img src=/other/preview.png srcset="/other/small-preview.png 1x, /other/nested/large-preview.png 2x" style="background-image: url(/other/hero.png)"')
    expect(deepHtml).toContain("<source srcset='/other/preview.webp 400w, /shared/preview.webp 800w'>")
    expect(deepHtml).toContain('<object data=/other/diagram.svg>')
    expect(deepHtml).toContain('background-image: url("/other/wide-preview.png")')
    expect(deepHtml).toContain('mask-image: url(#preview-mask)')
    expect(deepHtml).toContain('<a href="#task=1">Selected task</a>')
    expect(deepHtml).toContain('<a href="?owner=me">My tasks</a>')
    expect(deepHtml).toContain('<featherbase-bar data-app="other" data-title="Other tasks"></featherbase-bar>')
    for (const path of ['server.mjs', 'package.json', 'missing.js', '%2e%2e%2fserver.mjs'])
      await expectStatus(await member.fetch(`/other/${path}`), 404)
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    expect(await member.get('/api/app_catalog')).toEqual([])
    const unavailable = await member.fetch('/other/')
    await expectStatus(unavailable, 404)
    expect(await unavailable.text()).toContain('Disabling an application preserves its data')
  })

  test('PKG-J2: restart without compatible code fails closed, restoring code preserves data', async ({ admin }) => {
    const source = resolve('../..', 'test-apps/other')
    await discoverPackages([source])
    await admin.post('/api/install_app', { name: 'other' })
    await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'survivor', quantity: 19 } })
    await discoverPackages([])
    await loadInstalledApps()
    await expectRefused(admin.get('/api/table/other.task/survivor'), 403)
    const status = await admin.get<{ installed: unknown[] }>('/api/apps')
    expect(status.installed).toContainEqual(expect.objectContaining({ name: 'other', enabled: true, available: false, active: false }))
    const directory = await mkdtemp(resolve(tmpdir(), 'featherbase-package-'))
    try {
      await cp(source, directory, { recursive: true })
      const file = resolve(directory, 'featherbase.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      await writeFile(file, JSON.stringify({ ...manifest, platformVersion: '2099-01' }))
      expect(await discoverPackages([directory])).toHaveLength(1)
      await loadInstalledApps()
      await expect(admin.post('/api/set_app_enabled', { name: 'other', enabled: true }))
        .rejects.toMatchObject({ status: 417 })
      await expect(admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'new', quantity: 12 } }))
        .rejects.toMatchObject({ status: 403 })
    } finally { await rm(directory, { recursive: true, force: true }) }
    await discoverPackages([source])
    await loadInstalledApps()
    await loadInstalledApps()
    const row = await admin.get<Record<string, unknown>>('/api/table/other.task/survivor')
    expect(row).toMatchObject({ quantity: 19, validation_runs: 1 })
    expect(await admin.post('/api/save_row', { table: 'other.task', row: { ...row, quantity: 23 } }))
      .toMatchObject({ validation_runs: 2 })
  })

  // #650 (design D3): the shared top bar replaced the runtime shell's header
  // and its app switcher; the bar names only the app it stands on.
  test("PKG-R4: an app's entry document carries the shared bar's host, named by the app's title", async ({ admin }) => {
    expect(await discoverPackages([resolve('../..', 'example-apps/tasker'), resolve('../..', 'test-apps/other')])).toEqual([])
    await admin.post('/api/install_app', { name: 'tasker' })
    await admitTasker(admin)
    await admin.post('/api/install_app', { name: 'other' })

    const page = await admin.fetch('/tasker/review/37?filter=a%26b', { headers: { accept: 'text/html' } })
    await expectStatus(page, 200)
    const html = await page.text()
    expect(html).toContain('<featherbase-bar data-app="tasker" data-title="Tasker"></featherbase-bar>')
    expect(html).toContain('<script type="module" src="/featherbase/bar.js"></script>')
    expect(html).not.toContain('Other tasks')
    const secondary = await admin.fetch('/tasker/help/index.html', { headers: { accept: 'text/html' } })
    expect(await secondary.text()).toBe('<!doctype html><html><head><script src="./help.js" defer></script></head><body><h1>Tasker help</h1></body></html>\n')
    await expectStatus(await admin.fetch('/tasker/help/help.js'), 200)
  })

  test("PKG-R4: the retired runtime shell's stylesheet and script are no longer served", async ({ admin }) => {
    // Not found, or (where a built web app is present) its page fallback:
    // never a stylesheet or a script.
    for (const path of ['/featherbase/runtime-shell.css', '/featherbase/runtime-shell.js']) {
      const res = await admin.fetch(path)
      expect([path, res.status === 404 || !/css|javascript/.test(res.headers.get('content-type') ?? '')]).toEqual([path, true])
    }
  })

  test('PKG-R4: runtime catalog and document omit an unauthorized app', async ({ admin, createUser }) => {
    const restricted = await mkdtemp(resolve('test/.runtime-restricted-shell-'))
    try {
      await cp(resolve('../..', 'test-apps/other'), restricted, { recursive: true })
      const file = resolve(restricted, 'featherbase.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      manifest.permissions = manifest.permissions.map((permission: Record<string, unknown>) => ({ ...permission, role: 'System Manager' }))
      await writeFile(file, JSON.stringify(manifest))
      await discoverPackages([resolve('../..', 'example-apps/tasker'), restricted])
      await admin.post('/api/install_app', { name: 'tasker' })
      await admin.post('/api/install_app', { name: 'other' })
      const member = await createUser({ email: 'runtime-shell-no-manager@example.com', roles: ['Tasker Member'] })
      expect(await member.get('/api/app_catalog')).toEqual([{ name: 'tasker', title: 'Tasker', href: '/tasker/' }])
      const html = await (await member.fetch('/tasker/')).text()
      expect(html).toContain('<featherbase-bar data-app="tasker" data-title="Tasker"></featherbase-bar>')
      expect(html).not.toContain('Other tasks')
      // #955: no page of the app, only word that an admin has been told.
      const refused = await member.fetch('/other/')
      await expectStatus(refused, 403)
      expect(await refused.text()).toContain("You don't have access to Other tasks yet")
    } finally {
      await rm(restricted, { recursive: true, force: true })
    }
  })

  // #1008: a System Manager can tell an app is installed when they lack its
  // role, and why. Everyone else, and what opens an app, stays as it was.
  test('#1008: the closed apps list names what a System Manager lacks, and is theirs alone', async ({ admin, createUser }) => {
    await discoverPackages([resolve('../..', 'example-apps/tasker')])
    await admin.post('/api/install_app', { name: 'tasker' })
    const manager = await createUser({ email: 'closed-apps-manager@example.com', roles: ['System Manager'] })
    expect(await manager.get('/api/app_catalog/closed')).toEqual([{ name: 'tasker', title: 'Tasker', roles: ['Tasker Member'] }])
    expect(await manager.get('/api/app_catalog')).toEqual([])
    const holder = await createUser({ email: 'closed-apps-holder@example.com', roles: ['System Manager', 'Tasker Member'] })
    expect(await holder.get('/api/app_catalog/closed')).toEqual([])
    const member = await createUser({ email: 'closed-apps-member@example.com', roles: [] })
    await expectRefused(member.get('/api/app_catalog/closed'), 403)
  })

  // #437: a new version may withdraw a grant its installed version declared.
  // Two synthetic copies of Tasker: the installed one also lets everyone read
  // Person; the next version, one migration on, does not.
  const currentTasker = resolve('../..', 'test-apps/fixtures/tasker-v2.3')
  const everyoneReadsPerson = () => sql`select 1 from permission where owner_app = 'tasker' and role = 'All' and ref_table = 'Person'`
  async function taskerGrants() {
    const [app] = await sql`select perms from installed_app where name = 'tasker'`
    return sql`select distinct ref_table from permission where row_id in ${sql(app.perms as string[])} order by 1`
  }
  async function editJson(file: string, change: (value: Record<string, any>) => void) {
    const value = JSON.parse(await readFile(file, 'utf8'))
    change(value)
    await writeFile(file, JSON.stringify(value))
  }

  test('an upgrade withdraws a grant the installed version declared, and records the withdrawal', async ({ admin }) => {
    const root = await mkdtemp(resolve('test/.tasker-withdraw-'))
    const installed = resolve(root, 'installed')
    const next = resolve(root, 'next')
    try {
      for (const to of [installed, next])
        await cp(currentTasker, to, { recursive: true, filter: file => !file.split('/').includes('node_modules') })
      const { version: from } = JSON.parse(await readFile(resolve(installed, 'package.json'), 'utf8')) as { version: string }
      const to = '99.0.0'
      await editJson(resolve(installed, 'featherbase.json'), m => { m.permissions.push({ table: 'Person', role: 'All', operations: { read: '*' } }) })
      await editJson(resolve(next, 'featherbase.json'), m => { m.migrations.push({ id: 'withdraw_person_read_probe', fromVersion: from, toVersion: to, operations: [] }) })
      await editJson(resolve(next, 'package.json'), p => { p.version = to })

      expect(await discoverPackages([installed])).toEqual([])
      await admin.post('/api/install_app', { name: 'tasker' })
      // A client of the installed version saves a task before the upgrade.
      const saved = await admin.fetch('/api/save_row', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `tasker@${from}` },
        body: JSON.stringify({ table: 'tasker.task', row: { task_title: 'Kept across the upgrade' } }) })
      await expectStatus(saved, 201)
      const { row_id: task } = await saved.json() as { row_id: string }
      expect(await discoverPackages([installed, next])).toEqual([])
      await loadInstalledApps()
      expect(await admin.get('/api/runtime_app_versions')).toEqual([`tasker@${from}`])
      expect(await everyoneReadsPerson()).toHaveLength(1)

      const plan = await admin.post<{ planId: string; permissions: unknown[] }>('/api/preview_app_upgrade', { name: 'tasker', version: to })
      expect(plan.permissions).toEqual([{ withdraw: { table: 'Person', role: 'All', operations: { read: '*' } } }])
      await admin.post('/api/upgrade_app', { name: 'tasker', version: to, planId: plan.planId })
      await admin.post('/api/activate_app_upgrade', { name: 'tasker', version: to })
      expect(await admin.get('/api/runtime_app_versions')).toEqual([`tasker@${to}`])
      expect(await everyoneReadsPerson()).toHaveLength(0)
      expect(await taskerGrants()).toEqual([{ ref_table: 'Comment' }, { ref_table: 'tasker.project' }, { ref_table: 'tasker.task' }])
      const kept = await admin.fetch(`/api/table/tasker.task/${task}`, { headers: { 'X-Featherbase-App-Version': `tasker@${to}` } })
      expect(await kept.json()).toMatchObject({ task_title: 'Kept across the upgrade' })
      // The withdrawal is on the record.
      expect(await sql`select operation from activity_log where operation like ${`app_grant_withdrawn tasker@${to}: All on Person%`}`).toHaveLength(1)
      const [row] = await sql`select migration_ledger from installed_app where name = 'tasker'`
      expect((row.migration_ledger as { id: string }[]).map(m => m.id).at(-1)).toBe('withdraw_person_read_probe')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('an upgrade will not withdraw a grant someone else\'s deeper grant depends on', async ({ admin }) => {
    const root = await mkdtemp(resolve('test/.tasker-withdraw-held-'))
    const installed = resolve(root, 'installed')
    const next = resolve(root, 'next')
    try {
      for (const to of [installed, next])
        await cp(currentTasker, to, { recursive: true, filter: file => !file.split('/').includes('node_modules') })
      const { version: from } = JSON.parse(await readFile(resolve(installed, 'package.json'), 'utf8')) as { version: string }
      const to = '99.0.0'
      await editJson(resolve(installed, 'featherbase.json'), m => { m.permissions.push({ table: 'Person', role: 'All', operations: { read: '*' } }) })
      await editJson(resolve(next, 'featherbase.json'), m => { m.migrations.push({ id: 'withdraw_person_read_probe', fromVersion: from, toVersion: to, operations: [] }) })
      await editJson(resolve(next, 'package.json'), p => { p.version = to })
      expect(await discoverPackages([installed])).toEqual([])
      await admin.post('/api/install_app', { name: 'tasker' })
      const [base] = await sql`select row_id from permission where owner_app = 'tasker' and role = 'All' and ref_table = 'Person' and operation = 'read'`
      await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Manual Detail' } })
      await sql`insert into permission (row_id, ref_table, role, operation, scope_mode, column_rule, requires_permission)
        values ('manual-detail', 'Person', 'Manual Detail', 'read', 'all', 'every', ${String(base.row_id)})`
      expect(await discoverPackages([installed, next])).toEqual([])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'tasker', version: to })
      await expect(admin.post('/api/upgrade_app', { name: 'tasker', version: to, planId: plan.planId }))
        .rejects.toMatchObject({ status: 417, message: expect.stringMatching(/Deeper access of Manual Detail depends on the grant to All on Person/) })
      expect(await sql`select 1 from permission where row_id = 'manual-detail'`).toHaveLength(1)
      expect(await everyoneReadsPerson()).toHaveLength(1)
      expect(await sql`select package_version from installed_app where name = 'tasker'`).toEqual([{ package_version: from }])
      // The same when it depends on one of the app's line-item grants under that grant.
      await sql`insert into permission (row_id, ref_table, role, operation, scope_mode, column_rule, parent_permission, owner_app)
        values ('app-line', 'Comment', 'All', 'read', 'all', 'every', ${String(base.row_id)}, 'tasker')`
      await sql`update permission set requires_permission = 'app-line' where row_id = 'manual-detail'`
      await expect(admin.post('/api/upgrade_app', { name: 'tasker', version: to, planId: plan.planId }))
        .rejects.toMatchObject({ status: 417, message: expect.stringMatching(/Deeper access of Manual Detail/) })
      expect(await sql`select 1 from permission where row_id in ('manual-detail', 'app-line')`).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// #551 (ADR 0011, design E9): an app states the platform version it was built
// for, dated by month. The manifest and the compiled server module both say it.
describe('An app states the platform version it was built for', () => {
  async function appBuiltFor(manifestFields: Record<string, unknown>, serverVersion: string, serverLine = `export const platformVersion = '${serverVersion}'`) {
    const directory = await mkdtemp(resolve('test/.platform-version-'))
    await cp(resolve('../..', 'test-apps/other'), directory, { recursive: true })
    const file = resolve(directory, 'featherbase.json')
    const { platformVersion: _builtFor, ...manifest } = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...manifest, ...manifestFields }))
    const server = resolve(directory, 'server.mjs')
    const body = (await readFile(server, 'utf8')).split('\n').slice(1).join('\n')
    await writeFile(server, `${serverLine}\n${body}`)
    return directory
  }

  test('an app built for 2026-10 installs', async ({ admin }) => {
    const directory = await appBuiltFor({ platformVersion: '2026-10' }, '2026-10')
    try {
      expect(await discoverPackages([directory])).toEqual([])
      await admin.post('/api/install_app', { name: 'other' })
      expect(await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'built-for', quantity: 3 } }))
        .toMatchObject({ validation_runs: 1 })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('an unknown platform version is refused, naming both versions', async () => {
    const directory = await appBuiltFor({ platformVersion: '2027-01' }, '2027-01')
    try {
      const [failure] = await discoverPackages([directory])
      expect(failure.error).toContain('2027-01')
      expect(failure.error).toContain('2026-10')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('an app still declaring the retired apiVersion is refused', async () => {
    const directory = await appBuiltFor({ apiVersion: 1 }, '', 'export const apiVersion = 1')
    try {
      expect(await discoverPackages([directory])).toHaveLength(1)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('a server module built for another platform version is refused', async () => {
    const directory = await appBuiltFor({ platformVersion: '2026-10' }, '2025-01')
    try {
      const [failure] = await discoverPackages([directory])
      expect(failure.error).toContain('2025-01')
      expect(failure.error).toContain('2026-10')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

describe('Removing an app isn’t offered yet', () => {
  test('removing an app that has its own code is refused, pointing to disable, and nothing is removed', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'keep-me', quantity: 43 } })
    await expect(admin.post('/api/uninstall_app', { name: 'other' }))
      .rejects.toMatchObject({ status: 417, message: expect.stringContaining('Use disable') })
    expect(await sql`select name from installed_app where name = 'other'`).toEqual([{ name: 'other' }])
    expect(await sql`select name from table_def where name = 'other.task'`).toEqual([{ name: 'other.task' }])
    expect(await admin.get('/api/table/other.task/keep-me')).toMatchObject({ quantity: 43 })
  })
})

describe("Dashboards reach an app's data only while it is on", () => {
  test('while the app is on, a member who can read its table gets a count and a chart, and is refused once that read is taken away', async ({ admin, createUser }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'counted-1', quantity: 5 } })
    await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'counted-2', quantity: 5 } })
    const reader = await createUser({ email: 'dashboard-reader@example.com', roles: ['All'] })
    expect(await reader.post('/api/dashboard/count', { table: 'other.task' })).toEqual({ count: 2 })
    expect(await reader.post('/api/dashboard/chart', { table: 'other.task', group_by: 'quantity' }))
      .toEqual({ data: [{ label: '5', value: 2 }] })
    // Every member holds 'All', which the app's manifest lets read; take that
    // read away and the same member can no longer count or chart the table.
    await sql`delete from permission where ref_table = 'other.task' and role = 'All' and operation = 'read'`
    await expectRefused(reader.post('/api/dashboard/count', { table: 'other.task' }), 403)
    await expectRefused(reader.post('/api/dashboard/chart', { table: 'other.task', group_by: 'quantity' }), 403)
  })

  test('a generic dashboard count or chart over a turned-off app’s table is refused, and its rows stay', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'counted', quantity: 37 } })
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    await expectRefused(admin.post('/api/dashboard/count', { table: 'other.task' }), 403)
    await expectRefused(admin.post('/api/dashboard/chart', { table: 'other.task', group_by: 'quantity' }), 403)
    expect(await sql`select quantity from other.task where row_id = 'counted'`).toEqual([{ quantity: 37 }])
  })
})

describe('Only administrators manage apps', () => {
  test('an ordinary member can neither install, turn off, nor preview an upgrade of an app', async ({ admin, createUser }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    const member = await createUser({ email: 'not-a-manager@example.com', roles: ['All'] })
    await expectRefused(member.post('/api/install_app', { name: 'other' }), 403)
    expect(await sql`select name from installed_app where name = 'other'`).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    await expectRefused(member.post('/api/set_app_enabled', { name: 'other', enabled: false }), 403)
    await expectRefused(member.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' }), 403)
    await expectRefused(member.get('/api/apps'), 403)
    expect(await sql`select enabled from installed_app where name = 'other'`).toEqual([{ enabled: true }])
  })
})

// trusted-runtime-packages "An app can be delivered without rebuilding core":
// the core app below was loaded (built) before Tasker's package exists
// anywhere it can find it. The built package — exactly the files its
// package.json ships — is staged afterwards in a fresh directory apart from
// its source, discovered and installed, and opens inside the host shell
// through the generic app root: no core route is added, none names Tasker.
describe('An app owns its own screen', () => {
  test('a built Tasker staged after core loads opens in the host shell with no core rebuild or Tasker route', async ({ admin, createUser }) => {
    const routesBefore = app.routes.map((r) => `${r.method} ${r.path}`)
    expect(routesBefore.filter((r) => /tasker/i.test(r))).toEqual([])
    const source = resolve('../..', 'example-apps/tasker')
    const staged = join(await mkdtemp(resolve('test/.runtime-delivered-')), 'package')
    try {
      const shipped = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8')) as { files: string[] }
      for (const entry of ['package.json', ...shipped.files]) await cp(resolve(source, entry), resolve(staged, entry), { recursive: true })
      expect(await discoverPackages([staged])).toEqual([])
      await admin.post('/api/install_app', { name: 'tasker' })
      const member = await createUser({ email: 'delivered-member@example.com', roles: ['Tasker Member'] })
      expect(await member.get('/api/app_catalog')).toContainEqual({ name: 'tasker', title: 'Tasker', href: '/tasker/' })

      const page = await member.fetch('/tasker/', { headers: { accept: 'text/html' } })
      await expectStatus(page, 200)
      const html = await page.text()
      expect(html).toContain('<featherbase-bar data-app="tasker" data-title="Tasker"></featherbase-bar>')
      // The client's own entry script is served from the staged package.
      const entry = /<script type="module"[^>]*src="(\/tasker\/[^"]+\.js)"/.exec(html)?.[1]
      expect(entry).toBeDefined()
      const script = await member.fetch(entry!)
      await expectStatus(script, 200)
      expect(script.headers.get('content-type')).toBe('text/javascript')
      const assetPath = entry!.slice('/tasker/'.length)
      expect(Buffer.from(await script.arrayBuffer()).equals(await readFile(resolve(staged, 'dist/client', assetPath)))).toBe(true)

      expect(app.routes.map((r) => `${r.method} ${r.path}`)).toEqual(routesBefore)
    } finally {
      await rm(resolve(staged, '..'), { recursive: true, force: true })
    }
  })
})

// #380 task 4.4: an app declares the tabs its staff move between on a phone,
// with the declaration's own version, and the catalog hands them to the
// shared top bar as links under the app's own root.
describe('An app declares its phone tabs', () => {
  async function otherWith(fields: Record<string, unknown>) {
    const directory = await mkdtemp(resolve('test/.app-tabs-'))
    await cp(resolve('../..', 'test-apps/other'), directory, { recursive: true })
    const file = resolve(directory, 'featherbase.json')
    await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), ...fields }))
    return directory
  }
  const TABS = { version: 1, items: [
    { label: 'Today', icon: 'home', path: '' },
    { label: 'Targets', icon: 'target', path: 'targets' },
    { label: 'Checks', icon: 'checklist', path: 'checks/open' },
  ] }

  test('the catalog carries the declared tabs as links under the app, in order', async ({ admin }) => {
    const directory = await otherWith({ tabs: TABS })
    try {
      expect(await discoverPackages([directory])).toEqual([])
      await admin.post('/api/install_app', { name: 'other' })
      expect(await admin.get('/api/app_catalog')).toEqual([{ name: 'other', title: 'Other tasks', href: '/other/', tabs: [
        { label: 'Today', icon: 'home', href: '/other/' },
        { label: 'Targets', icon: 'target', href: '/other/targets' },
        { label: 'Checks', icon: 'checklist', href: '/other/checks/open' },
      ] }])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('#737 command destinations follow available app roots and declared tabs', async ({ admin, createUser }) => {
    const directory = await otherWith({ tabs: TABS })
    try {
      expect(await discoverPackages([directory])).toEqual([])
      await admin.post('/api/install_app', { name: 'other' })
      type Inventory = { pages: { href: string; label: string }[]; tables: { row_id: string }[] }
      const inventory = await admin.get<Inventory>('/api/command_destinations')
      expect(inventory.pages.filter((p) => p.href.startsWith('/other/')).map((p) => p.href).sort())
        .toEqual(['/other/', '/other/checks/open', '/other/targets'])
      expect(inventory.tables.map((t) => t.row_id)).toContain('other.task')

      // An app-only reader never acquires Admin simply by asking for its
      // inventory, even though the app's own catalogue is open to them.
      const appOnly = await createUser({ roles: [] })
      expect(await appOnly.get('/api/app_catalog')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'other' })]))
      await expectStatus(await appOnly.fetch('/api/command_destinations'), 403)

      await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      const disabled = await admin.get<Inventory>('/api/command_destinations')
      expect(disabled.pages.some((p) => p.href.startsWith('/other/'))).toBe(false)
      expect(disabled.tables.map((t) => t.row_id)).not.toContain('other.task')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('a member who cannot open the app gets neither its catalog entry, its tabs nor its pages', async ({ admin, createUser }) => {
    const directory = await otherWith({ tabs: TABS })
    try {
      const file = resolve(directory, 'featherbase.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      manifest.permissions = manifest.permissions.map((permission: Record<string, unknown>) => ({ ...permission, role: 'System Manager' }))
      await writeFile(file, JSON.stringify(manifest))
      expect(await discoverPackages([directory])).toEqual([])
      await admin.post('/api/install_app', { name: 'other' })
      const member = await createUser({ email: 'app-tabs-no-read@example.com', roles: [] })
      expect(await member.get('/api/app_catalog')).toEqual([])
      // #955: no page of the app, only word that an admin has been told.
      const refused = await member.fetch('/other/targets', { headers: { accept: 'text/html' } })
      await expectStatus(refused, 403)
      expect(await refused.text()).not.toContain('<featherbase-bar')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test("a tab's deep address serves the app's page with the bar, at the device's width", async ({ admin }) => {
    const directory = await otherWith({ tabs: TABS })
    try {
      await mkdir(resolve(directory, 'client/targets'))
      expect(await discoverPackages([directory])).toEqual([])
      await admin.post('/api/install_app', { name: 'other' })
      const res = await admin.fetch('/other/targets', { headers: { accept: 'text/html' } })
      await expectStatus(res, 200)
      const html = await res.text()
      expect(html).toContain('<featherbase-bar data-app="other" data-title="Other tasks"></featherbase-bar>')
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
      for (const asset of ['targets', 'missing.js']) {
        await expectStatus(await admin.fetch(`/other/${asset}`), 404)
      }
      await expectStatus(await admin.fetch('/other/%E0%A4%A', { headers: { accept: 'text/html' } }), 404)
      // A broken deployed entry must not expose a directory or answer as a working page.
      await rm(resolve(directory, 'client/index.html'))
      await mkdir(resolve(directory, 'client/index.html'))
      await expectStatus(await admin.fetch('/other/', { headers: { accept: 'text/html' } }), 404)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('an app that declares no tabs gets none', async ({ admin }) => {
    expect(await discoverPackages([resolve('../..', 'test-apps/other')])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    expect(await admin.get('/api/app_catalog')).toEqual([{ name: 'other', title: 'Other tasks', href: '/other/' }])
    const inventory = await admin.get<{ pages: { href: string; label: string; kind: string }[] }>('/api/command_destinations')
    expect(inventory.pages.filter((page) => page.href.startsWith('/other/')))
      .toEqual([{ label: 'Other tasks', href: '/other/', kind: 'App' }])
  })

  test('a tab list the bar cannot draw safely is refused when the app is found', async () => {
    const item = (over: Record<string, unknown>) => ({ label: 'Tab', icon: 'list', path: 'tab', ...over })
    const refused: [string, unknown][] = [
      ['one tab', { version: 1, items: [item({})] }],
      ['six tabs', { version: 1, items: ['a', 'b', 'c', 'd', 'e', 'f'].map((path) => item({ path })) }],
      ['an unknown version', { ...TABS, version: 2 }],
      ['no version', { items: TABS.items }],
      ['an icon outside the set', { version: 1, items: [item({ path: 'a' }), item({ path: 'b', icon: 'skull' })] }],
      ['an empty label', { version: 1, items: [item({ path: 'a' }), item({ path: 'b', label: ' ' })] }],
      ['a label too long for the bar', { version: 1, items: [item({ path: 'a' }), item({ path: 'b', label: 'Thirteen char' })] }],
      ['two tabs opening one path', { version: 1, items: [item({}), item({ label: 'Again' })] }],
      ['an invisible label', { version: 1, items: [item({ path: 'a' }), item({ path: 'b', label: '\u200b' })] }],
      ['a label with a direction override', { version: 1, items: [item({ path: 'a' }), item({ path: 'b', label: 'Tab\u202e' })] }],
      ['an extra field', { version: 1, items: [item({ path: 'a' }), item({ path: 'b', badge: 3 })] }],
      ...['/admin', '../admin', 'a/../../admin', 'https://elsewhere.example', '//elsewhere.example', 'a?b', 'a#b', 'A', 'a//b', 'a/', '/', 'a\nb', 'a\\b', '%2e%2e', 'a b', 'javascript:alert(1)'].map(
        (path): [string, unknown] => [`the path ${path}`, { version: 1, items: [item({ path: 'ok' }), item({ path })] }]),
    ]
    for (const [what, tabs] of refused) {
      const directory = await otherWith({ tabs })
      try {
        expect(await discoverPackages([directory]), what).toEqual([expect.objectContaining({ error: expect.stringContaining('"tabs"') })])
      } finally { await rm(directory, { recursive: true, force: true }) }
    }
  })
})

// #941 (design D1): an app names its accent, one of the platform's set, and
// the served document carries it so Shop Floor's accent tokens apply.
describe('An app names its accent', () => {
  async function otherWith(fields: Record<string, unknown>) {
    const directory = await mkdtemp(resolve('test/.app-accent-'))
    await cp(resolve('../..', 'test-apps/other'), directory, { recursive: true })
    const file = resolve(directory, 'featherbase.json')
    await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), ...fields }))
    return directory
  }

  // The app is still found, so the System Manager who installs it is told why
  // it is refused rather than that it is unknown.
  test('installing an app that names an accent the platform does not provide is refused, naming the ones it does', async ({ admin }) => {
    const directory = await otherWith({ accent: 'purple' })
    try {
      expect(await discoverPackages([directory])).toEqual([])
      await expect(admin.post('/api/install_app', { name: 'other' })).rejects.toMatchObject({
        status: 417, type: 'ValidationError', message: "417 ValidationError: App other names the accent 'purple'; Featherbase provides: blue, green",
      })
      expect((await admin.get<{ name: string }[]>('/api/app_catalog')).map((entry) => entry.name)).not.toContain('other')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test("the app's page carries its accent", async ({ admin }) => {
    const directory = await otherWith({ accent: 'green' })
    try {
      expect(await discoverPackages([directory])).toEqual([])
      await admin.post('/api/install_app', { name: 'other' })
      const html = await (await admin.fetch('/other/', { headers: { accept: 'text/html' } })).text()
      expect(html).toContain('<html lang="en" data-featherbase-accent="green">')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

test('the digest check before a release fingerprints an app as the server does (#1044)', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'digest-'))
  await mkdir(join(folder, 'dist'))
  await writeFile(join(folder, 'package.json'), '{"name":"é"}')
  await writeFile(join(folder, 'dist', 'b.js'), 'two')
  await writeFile(join(folder, 'dist', 'a.js'), 'one')
  // @ts-expect-error a plain script outside this package's types
  const tool = await import('../../../tools/check-app-digests.mjs')
  expect(await tool.artifactDigest(folder)).toBe(await artifactDigest(folder))
})
