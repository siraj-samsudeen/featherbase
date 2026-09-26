import { describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { test as base } from './pg-test'
import type { TestClient, CreateUserFn } from 'feather-testing-postgres'
import { taskerClient } from './tasker-client'
import { discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { registerController, unregisterController, type TableController } from '../src/controllers'
import { importCustomizations } from '../src/customizations'
import { getMeta, invalidateMeta } from '../src/meta'
import { runQueryReport } from '../src/query-report'
import { permittedTiers } from '../src/permissions'

const test = base.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(taskerClient(admin)),
  createUser: async ({ createUser }, use) => use(async options => taskerClient(await createUser(options))),
})

describe('PKG-R1/PKG-R3: trusted package lifecycle', () => {
  test('PKG-R6: legacy human deep links redirect to Featherbase while technical roots remain reserved', async ({ api }) => {
    const old = await api.fetch('/admin/Tasker%20Task/one?view=board')
    expect(old.status).toBe(308)
    expect(old.headers.get('location')).toBe('/featherbase/admin/Tasker%20Task/one?view=board')
    const login = await api.fetch('/login?next=%2Ftasker%2F')
    expect(login.status).toBe(308)
    expect(login.headers.get('location')).toBe('/featherbase/login?next=%2Ftasker%2F')
    const technical = await api.fetch('/api/not-a-route')
    expect(technical.status).toBe(401)
    expect(technical.headers.get('location')).toBeNull()
  })

  test('PKG-R1: reserved names fail discovery; failed installation leaves no Tables or activation', async ({ admin }) => {
    const directory = await mkdtemp(resolve('test/.runtime-package-'))
    try {
      await cp(resolve('../..', 'runtime-apps/other'), directory, { recursive: true })
      const file = resolve(directory, 'featherbase.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      for (const name of ['featherbase', 'api', 'assets']) {
        await writeFile(file, JSON.stringify({ ...manifest, name }))
        expect(await discoverPackages([directory])).toEqual([expect.objectContaining({ error: expect.stringContaining('reserved') })])
      }
      await writeFile(file, JSON.stringify({ ...manifest, permissions: [{ table: 'other.task', role: 'Role that does not exist', can_read: true }] }))
      expect(await discoverPackages([directory])).toEqual([])
      await expect(admin.post('/api/install_app', { name: 'other' })).rejects.toMatchObject({ status: 417 })
      expect(await sql`select name from table_def where name = 'other.task'`).toHaveLength(0)
      expect(await sql`select name from installed_app where name = 'other'`).toHaveLength(0)
      expect(await admin.get('/api/app_catalog')).toEqual([])
      await writeFile(file, JSON.stringify(manifest))
      await discoverPackages([directory])
      await admin.post('/api/install_app', { name: 'other' })
      await expect(admin.post('/api/install_app', { name: 'other' })).rejects.toMatchObject({ status: 409 })
      expect(await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'once', quantity: 17 } })).toMatchObject({ validation_runs: '1' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('PKG-R2: customization cannot change identity, storage, binding or hook dispatch', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'runtime-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    for (const property of ['name', 'owner_app', 'physical_schema', 'physical_relation', 'data_source', 'row_key', 'columns']) {
      const row = { row_id: `override-${property}`, table_name: 'other.task', column_name: null, property, value: 'tasker' }
      await expect(admin.post('/api/save_row', { table: 'Metadata Override', row })).rejects.toMatchObject({ status: 417, message: expect.stringContaining('cannot be overridden') })
      await expect(importCustomizations({ property_setters: [row] })).rejects.toMatchObject({ type: 'ValidationError' })
    }
    await admin.post('/api/save_row', { table: 'Metadata Override', row: {
      row_id: 'override-label', table_name: 'other.task', property: 'label', value: 'Counting task',
    } })
    expect(await getMeta('other.task')).toMatchObject({ name: 'other.task', label: 'Counting task', physical_schema: 'other' })
    // A pre-existing unsafe override must not get applied on the next boot.
    await sql`insert into metadata_override (row_id, table_name, property, value) values ('legacy-unsafe', 'other.task', 'name', 'Task')`
    invalidateMeta('other.task')
    await expect(getMeta('other.task')).rejects.toMatchObject({ type: 'ValidationError' })
  })

  test('PKG-R3: raw SQL reports cannot read app relations outside the availability-aware API', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'runtime-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'secret', quantity: 37 } })
    await admin.post('/api/save_row', { table: 'Report', row: {
      row_id: 'Raw app data', ref_table: 'User', report_type: 'Query Report',
      query: "select query_to_xml('select * from other.task', true, false, set_config('role', 'none', true))",
    } })
    for (const enabled of [true, false]) {
      await admin.post('/api/set_app_enabled', { name: 'other', enabled })
      await expect(runQueryReport('Raw app data', {}, 'Administrator')).rejects.toMatchObject({ type: 'ValidationError' })
    }
    expect(await sql`select has_table_privilege('app_client', 'other.task', 'select') as allowed`).toMatchObject([{ allowed: false }])
    await discoverPackages([])
    await loadInstalledApps()
    await expect(runQueryReport('Raw app data', {}, 'Administrator')).rejects.toMatchObject({ type: 'ValidationError' })
  })

  test('PKG-R3: disable waits for the post-commit tail, including a nested save', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'runtime-apps/other')])
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
      await expect(admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'late', quantity: 9 } })).rejects.toMatchObject({ status: 403 })
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
      expect(await admin.get('/api/table/other.task/tail')).toMatchObject({ quantity: '29', validation_runs: '1' })
    } finally {
      release()
      await Promise.allSettled([save, disable])
      unregisterController(controller)
    }
  })

  test('PKG-R2 PKG-H1: two real packages isolate IDs, references, rules and ordinary-user grants', async ({ admin, createUser }) => {
    expect(await discoverPackages(['tasker', 'other'].map(name => resolve('../..', 'runtime-apps', name)))).toEqual([])
    await admin.post('/api/install_app', { name: 'tasker' })
    await admin.post('/api/install_app', { name: 'other' })
    const member = await createUser({ email: 'two-packages@example.com', roles: [] })
    const task = await member.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.task', row: { task_title: 'Only Tasker owns this title', task_state: 'In progress' },
    })
    const id = task.row_id
    await admin.post('/api/save_row', { table: 'other.task', row: { row_id: id, quantity: 37 } })
    expect(await member.get(`/api/table/tasker.task/${id}`)).toMatchObject({ task_title: 'Only Tasker owns this title', task_state: 'In progress' })
    const other = await member.get<Record<string, unknown>>(`/api/table/other.task/${id}`)
    expect(other).toMatchObject({ quantity: '37', validation_runs: '1' })
    expect(other).not.toHaveProperty('task_title')
    await expect(member.post('/api/save_row', { table: 'other.task', row: { ...other, quantity: 18 } })).rejects.toMatchObject({ status: 403 })
    await expect(admin.post('/api/save_row', { table: 'other.task', row: { ...other, quantity: -2 } })).rejects.toMatchObject({ status: 417 })
    await admin.post('/api/table_def', { name: 'Package pointer', id_pattern: 'prompt', columns: [
      { column_name: 'target', column_type: 'Reference', reference_table: 'other.task' },
    ] })
    await admin.post('/api/save_row', { table: 'Package pointer', row: { row_id: 'explicit', target: id } })
    const lone = await member.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Absent from Other' } })
    await expect(admin.post('/api/save_row', { table: 'Package pointer', row: { row_id: 'wrong-owner', target: lone.row_id } })).rejects.toMatchObject({ status: 417 })
    expect(await member.get('/api/table/Comment')).toMatchObject({ data: [] })
    await admin.post('/api/set_app_enabled', { name: 'tasker', enabled: false })
    await expect(member.post('/api/save_row', { table: 'tasker.task', row: { ...task, is_done: true } })).rejects.toMatchObject({ status: 403 })
    await expect(member.get('/api/table/Comment')).rejects.toMatchObject({ status: 403 })
    await expect(member.get('/api/table/User')).rejects.toMatchObject({ status: 403 })
    expect(await admin.post('/api/save_row', { table: 'other.task', row: { ...other, quantity: 23 } })).toMatchObject({ quantity: '23', validation_runs: '2' })
    await admin.post('/api/set_app_enabled', { name: 'tasker', enabled: true })
    expect(await member.get('/api/table/Comment')).toMatchObject({ data: [] })
    expect(await member.post('/api/save_row', { table: 'tasker.task', row: { ...task, is_done: true } })).toMatchObject({ task_state: 'Done', state_before_done: 'In progress' })
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    await expect(admin.post('/api/save_row', { table: 'Package pointer', row: { row_id: 'disabled-target', target: id } })).rejects.toMatchObject({ status: 403 })
  })

  test('PKG-R3: equivalent shared-table grants remain independent across packages', async ({ admin, createUser }) => {
    const other = await mkdtemp(resolve('test/.runtime-shared-grant-'))
    try {
      await cp(resolve('../..', 'runtime-apps/other'), other, { recursive: true })
      const file = resolve(other, 'featherbase.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      manifest.permissions.push(
        { table: 'User', role: 'All', can_read: true },
        { table: 'User', role: 'All', tier: 'restricted', can_read: true },
      )
      await writeFile(file, JSON.stringify(manifest))
      expect(await discoverPackages([resolve('../..', 'runtime-apps/tasker'), other])).toEqual([])
      await admin.post('/api/install_app', { name: 'tasker' })
      await admin.post('/api/install_app', { name: 'other' })
      // Recreate the pre-0092 upgrade state: Tasker created the basic grant,
      // Other adopted it without a ledger entry, and neither grant had an
      // owner. The migration must recover both independent declarations.
      const [adopted] = await sql`
        delete from permission
        where owner_app = 'other' and ref_table = 'User' and tier = 'basic'
        returning row_id`
      await sql`
        update installed_app set perms = perms - ${String(adopted.row_id)}
        where name = 'other'`
      await sql`update permission set owner_app = null where owner_app in ('tasker', 'other')`
      await sql.unsafe(await readFile(resolve('migrations/0092_runtime_permission_owner.sql'), 'utf8'))
      expect(await sql`
        select owner_app, tier from permission
        where ref_table = 'User' and owner_app in ('tasker', 'other')
        order by owner_app, tier`
      ).toEqual([
        { owner_app: 'other', tier: 'basic' },
        { owner_app: 'other', tier: 'restricted' },
        { owner_app: 'tasker', tier: 'basic' },
      ])
      const member = await createUser({ email: 'shared-grants@example.com', roles: [] })
      expect((await member.get<{ data: unknown[] }>('/api/table/User')).data.length).toBeGreaterThan(0)
      expect(await permittedTiers(member.user!, 'User', 'read')).toEqual(new Set(['basic', 'restricted']))

      await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      expect((await member.get<{ data: unknown[] }>('/api/table/User')).data.length).toBeGreaterThan(0)
      expect(await permittedTiers(member.user!, 'User', 'read')).toEqual(new Set(['basic']))
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
      await admin.post('/api/set_app_enabled', { name: 'tasker', enabled: false })
      expect((await member.get<{ data: unknown[] }>('/api/table/User')).data.length).toBeGreaterThan(0)
      expect(await permittedTiers(member.user!, 'User', 'read')).toEqual(new Set(['basic', 'restricted']))
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      await expect(member.get('/api/table/User')).rejects.toMatchObject({ status: 403 })
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  test('disable rejects stale writes, preserves rows, and enable wires validation once', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'runtime-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    const row = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'other.task', row: { row_id: 'same', quantity: 37 },
    })
    expect(row.validation_runs).toBe('1')
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    await expect(admin.post('/api/save_row', {
      table: 'other.task', row: { ...row, quantity: -9 },
    })).rejects.toMatchObject({ status: 403 })
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
    expect(await admin.get('/api/table/other.task/same')).toMatchObject({ quantity: '37' })
    await expect(admin.post('/api/save_row', {
      table: 'other.task', row: { ...row, quantity: -9 },
    })).rejects.toMatchObject({ status: 417, fields: { quantity: 'Must be positive' } })
    expect(await admin.post('/api/save_row', {
      table: 'other.task', row: { ...row, quantity: 11 },
    })).toMatchObject({ validation_runs: '2' })
  })

  test('PKG-R4: ordinary member catalog and client root are separate from management and server files', async ({ api, admin, createUser }) => {
    expect(await discoverPackages([resolve('../..', 'runtime-apps/other')])).toEqual([])
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
    expect(signIn.status).toBe(302)
    expect(signIn.headers.get('location')).toBe('/featherbase/login?next=%2Fother%2F')
    const deepSignIn = await api.fetch('/other/review/item?filter=a%26b&owner=me', {
      headers: { accept: 'text/html' },
    })
    expect(deepSignIn.status).toBe(302)
    expect(deepSignIn.headers.get('location')).toBe(
      '/featherbase/login?next=%2Fother%2Freview%2Fitem%3Ffilter%3Da%2526b%26owner%3Dme',
    )
    const malformed = await api.fetch('/other/%E0%A4%A', { headers: { accept: 'text/html' } })
    expect(malformed.status).toBe(404)
    expect(malformed.headers.get('location')).toBeNull()
    expect(await sql`select row_id from home_page where module = 'Other'`).toEqual([])
    const member = await createUser({ email: 'runtime-reader@example.com', roles: ['All'] })
    await expect(admin.post('/api/uninstall_app', { name: 'other' })).rejects.toMatchObject({ status: 417 })
    expect(await member.get('/api/app_catalog')).toEqual([
      { name: 'other', title: 'Other tasks', href: '/other/' },
    ])
    const signedInRoot = await member.fetch('/other?review=member&note=a%2Fb')
    expect(signedInRoot.status).toBe(308)
    expect(signedInRoot.headers.get('location')).toBe('/other/?review=member&note=a%2Fb')
    await expect(member.get('/api/apps')).rejects.toMatchObject({ status: 403 })
    await expect(member.post('/api/save_row', { table: 'other.task', row: { row_id: 'no', quantity: 3 } }))
      .rejects.toMatchObject({ status: 403 })
    const page = await member.fetch('/other/')
    expect(page.status).toBe(200)
    const rootHtml = await page.text()
    expect(rootHtml).toContain('<h1>Other tasks</h1>')
    expect(rootHtml).toContain('data-testid="runtime-shell"')
    const deepPage = await member.fetch('/other/review/37?filter=a%26b', { headers: { accept: 'text/html' } })
    expect(deepPage.status).toBe(200)
    const deepHtml = await deepPage.text()
    expect(deepHtml).toContain('<base href="/other/">')
    expect(deepHtml).toContain('data-testid="runtime-shell"')
    for (const path of ['server.mjs', 'package.json', 'missing.js', '%2e%2e%2fserver.mjs'])
      expect((await member.fetch(`/other/${path}`)).status).toBe(404)
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    expect(await member.get('/api/app_catalog')).toEqual([])
    const unavailable = await member.fetch('/other/')
    expect(unavailable.status).toBe(404)
    expect(await unavailable.text()).toContain('Disabling an application preserves its data')
  })

  test('PKG-J2: restart without compatible code fails closed, restoring code preserves data', async ({ admin }) => {
    const source = resolve('../..', 'runtime-apps/other')
    await discoverPackages([source])
    await admin.post('/api/install_app', { name: 'other' })
    await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'survivor', quantity: 19 } })
    await discoverPackages([])
    await loadInstalledApps()
    await expect(admin.get('/api/table/other.task/survivor')).rejects.toMatchObject({ status: 403 })
    const status = await admin.get<{ installed: unknown[] }>('/api/apps')
    expect(status.installed).toContainEqual(expect.objectContaining({ name: 'other', enabled: true, available: false, active: false }))
    const directory = await mkdtemp(resolve(tmpdir(), 'featherbase-package-'))
    try {
      await cp(source, directory, { recursive: true })
      const file = resolve(directory, 'featherbase.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      await writeFile(file, JSON.stringify({ ...manifest, apiVersion: 99 }))
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
    expect(row).toMatchObject({ quantity: '19', validation_runs: '1' })
    expect(await admin.post('/api/save_row', { table: 'other.task', row: { ...row, quantity: 23 } }))
      .toMatchObject({ validation_runs: '2' })
  })

  test('PKG-R4: runtime entry HTML composes one authorized host switcher', async ({ admin }) => {
    expect(await discoverPackages(['tasker', 'other'].map(name => resolve('../..', 'runtime-apps', name)))).toEqual([])
    await admin.post('/api/install_app', { name: 'tasker' })
    await admin.post('/api/install_app', { name: 'other' })

    const page = await admin.fetch('/tasker/review/37?filter=a%26b', { headers: { accept: 'text/html' } })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('data-featherbase-runtime-shell')
    expect(html).toContain('data-testid="runtime-shell"')
    expect(html).toContain('aria-label="Featherbase Home"')
    expect(html).toContain('<option value="/featherbase/admin">Featherbase Home</option>')
    expect(html).toContain('<option value="/tasker/" selected>Tasker</option>')
    expect(html).toContain('<option value="/other/">Other tasks</option>')
    expect(html).toContain('/featherbase/runtime-shell.js')
    const secondary = await admin.fetch('/tasker/help/index.html', { headers: { accept: 'text/html' } })
    expect(await secondary.text()).toBe('<!doctype html><html><head><script src="./help.js" defer></script></head><body><h1>Tasker help</h1></body></html>\n')
    expect((await admin.fetch('/tasker/help/help.js')).status).toBe(200)
  })

  test('PKG-R4: runtime catalog and document omit an unauthorized app', async ({ admin, createUser }) => {
    const restricted = await mkdtemp(resolve('test/.runtime-restricted-shell-'))
    try {
      await cp(resolve('../..', 'runtime-apps/other'), restricted, { recursive: true })
      const file = resolve(restricted, 'featherbase.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      manifest.permissions = manifest.permissions.map((permission: Record<string, unknown>) => ({ ...permission, role: 'System Manager' }))
      await writeFile(file, JSON.stringify(manifest))
      await discoverPackages([resolve('../..', 'runtime-apps/tasker'), restricted])
      await admin.post('/api/install_app', { name: 'tasker' })
      await admin.post('/api/install_app', { name: 'other' })
      const member = await createUser({ email: 'runtime-shell-no-manager@example.com', roles: [] })
      expect(await member.get('/api/app_catalog')).toEqual([{ name: 'tasker', title: 'Tasker', href: '/tasker/' }])
      const html = await (await member.fetch('/tasker/')).text()
      expect(html).toContain('<option value="/tasker/" selected>Tasker</option>')
      expect(html).not.toContain('Other tasks')
      expect((await member.fetch('/other/')).status).toBe(404)
    } finally {
      await rm(restricted, { recursive: true, force: true })
    }
  })

  test('changed Tasker package upgrades from its exact shipped predecessor', async ({ admin }) => {
    const predecessorTasker = resolve('../..', 'runtime-apps/fixtures/tasker-v2.1')
    const currentTasker = resolve('../..', 'runtime-apps/tasker')
    expect(await discoverPackages([predecessorTasker])).toEqual([])
    await admin.post('/api/install_app', { name: 'tasker' })
    expect(await discoverPackages([predecessorTasker, currentTasker])).toEqual([])
    await loadInstalledApps()
    const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'tasker', version: '2.2.0' })
    await admin.post('/api/upgrade_app', { name: 'tasker', version: '2.2.0', planId: plan.planId })
    await admin.post('/api/activate_app_upgrade', { name: 'tasker', version: '2.2.0' })
    expect(await admin.get('/api/app_catalog')).toContainEqual({ name: 'tasker', title: 'Tasker', href: '/tasker/' })
  })
})
