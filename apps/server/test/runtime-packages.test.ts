import { describe, expect } from 'vitest'
import { join, resolve } from 'node:path'
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
import { permittedTiers } from '../src/permissions'
import { app } from '../src/index'

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
      await cp(resolve('../..', 'test-apps/other'), directory, { recursive: true })
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
      expect(await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'once', quantity: 17 } })).toMatchObject({ validation_runs: 1 })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('PKG-R2: customization cannot change identity, storage, binding or hook dispatch', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
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

  test('PKG-R3: no database role but the owner can read app relations outside the availability-aware API', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    for (const enabled of [true, false]) {
      await admin.post('/api/set_app_enabled', { name: 'other', enabled })
      expect(await sql`select count(*)::int as grants from pg_class c, aclexplode(c.relacl) a where c.oid = 'other.task'::regclass and a.grantee <> c.relowner`).toEqual([{ grants: 0 }])
    }
  })

  test('PKG-R3: disable waits for the post-commit tail, including a nested save', async ({ admin }) => {
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
      await expect(admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'late', quantity: 9 } })).rejects.toMatchObject({ status: 403 })
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
      expect(await admin.get('/api/table/other.task/tail')).toMatchObject({ quantity: 29, validation_runs: 1 })
    } finally {
      release()
      await Promise.allSettled([save, disable])
      unregisterController(controller)
    }
  })

  test('PKG-R2 PKG-H1: two real packages isolate IDs, references, rules and ordinary-user grants', async ({ admin, createUser }) => {
    expect(await discoverPackages([resolve('../..', 'example-apps/tasker'), resolve('../..', 'test-apps/other')])).toEqual([])
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
    expect(other).toMatchObject({ quantity: 37, validation_runs: 1 })
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
    await expect(member.get('/api/table/Person')).rejects.toMatchObject({ status: 403 })
    expect(await admin.post('/api/save_row', { table: 'other.task', row: { ...other, quantity: 23 } })).toMatchObject({ quantity: 23, validation_runs: 2 })
    await admin.post('/api/set_app_enabled', { name: 'tasker', enabled: true })
    expect(await member.get('/api/table/Comment')).toMatchObject({ data: [] })
    expect(await member.post('/api/save_row', { table: 'tasker.task', row: { ...task, is_done: true } })).toMatchObject({ task_state: 'Done', state_before_done: 'In progress' })
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    await expect(admin.post('/api/save_row', { table: 'Package pointer', row: { row_id: 'disabled-target', target: id } })).rejects.toMatchObject({ status: 403 })
  })

  test('PKG-R3: equivalent shared-table grants remain independent across packages', async ({ admin, createUser }) => {
    const other = await mkdtemp(resolve('test/.runtime-shared-grant-'))
    try {
      await cp(resolve('../..', 'test-apps/other'), other, { recursive: true })
      const file = resolve(other, 'featherbase.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      manifest.permissions.push(
        // #437: a shared core Table both packages grant on (Tasker's Comment grant).
        { table: 'Comment', role: 'All', can_read: true },
        { table: 'Comment', role: 'All', tier: 'restricted', can_read: true },
      )
      await writeFile(file, JSON.stringify(manifest))
      expect(await discoverPackages([resolve('../..', 'example-apps/tasker'), other])).toEqual([])
      await admin.post('/api/install_app', { name: 'tasker' })
      await admin.post('/api/install_app', { name: 'other' })
      // Each package owns its own declaration of the shared grant.
      expect(await sql`
        select owner_app, tier from permission
        where ref_table = 'Comment' and owner_app in ('tasker', 'other')
        order by owner_app, tier`
      ).toEqual([
        { owner_app: 'other', tier: 'basic' },
        { owner_app: 'other', tier: 'restricted' },
        { owner_app: 'tasker', tier: 'basic' },
      ])
      const member = await createUser({ email: 'shared-grants@example.com', roles: [] })
      expect((await member.get<{ data: unknown[] }>('/api/table/Comment')).data).toBeInstanceOf(Array)
      expect(await permittedTiers(member.user!, 'Comment', 'read')).toEqual(new Set(['basic', 'restricted']))

      await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      expect((await member.get<{ data: unknown[] }>('/api/table/Comment')).data).toBeInstanceOf(Array)
      expect(await permittedTiers(member.user!, 'Comment', 'read')).toEqual(new Set(['basic']))
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
      await admin.post('/api/set_app_enabled', { name: 'tasker', enabled: false })
      expect((await member.get<{ data: unknown[] }>('/api/table/Comment')).data).toBeInstanceOf(Array)
      expect(await permittedTiers(member.user!, 'Comment', 'read')).toEqual(new Set(['basic', 'restricted']))
      await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
      await expect(member.get('/api/table/Comment')).rejects.toMatchObject({ status: 403 })
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
    expect(rootHtml).toContain('<featherbase-bar data-app="other" data-title="Other tasks"></featherbase-bar>')
    const deepPage = await member.fetch('/other/review/37?filter=a%26b', { headers: { accept: 'text/html' } })
    expect(deepPage.status).toBe(200)
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
      expect((await member.fetch(`/other/${path}`)).status).toBe(404)
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    expect(await member.get('/api/app_catalog')).toEqual([])
    const unavailable = await member.fetch('/other/')
    expect(unavailable.status).toBe(404)
    expect(await unavailable.text()).toContain('Disabling an application preserves its data')
  })

  test('PKG-J2: restart without compatible code fails closed, restoring code preserves data', async ({ admin }) => {
    const source = resolve('../..', 'test-apps/other')
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
    await admin.post('/api/install_app', { name: 'other' })

    const page = await admin.fetch('/tasker/review/37?filter=a%26b', { headers: { accept: 'text/html' } })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('<featherbase-bar data-app="tasker" data-title="Tasker"></featherbase-bar>')
    expect(html).toContain('<script type="module" src="/featherbase/bar.js"></script>')
    expect(html).not.toContain('Other tasks')
    const secondary = await admin.fetch('/tasker/help/index.html', { headers: { accept: 'text/html' } })
    expect(await secondary.text()).toBe('<!doctype html><html><head><script src="./help.js" defer></script></head><body><h1>Tasker help</h1></body></html>\n')
    expect((await admin.fetch('/tasker/help/help.js')).status).toBe(200)
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
      const member = await createUser({ email: 'runtime-shell-no-manager@example.com', roles: [] })
      expect(await member.get('/api/app_catalog')).toEqual([{ name: 'tasker', title: 'Tasker', href: '/tasker/' }])
      const html = await (await member.fetch('/tasker/')).text()
      expect(html).toContain('<featherbase-bar data-app="tasker" data-title="Tasker"></featherbase-bar>')
      expect(html).not.toContain('Other tasks')
      expect((await member.fetch('/other/')).status).toBe(404)
    } finally {
      await rm(restricted, { recursive: true, force: true })
    }
  })

  // #437: a new version may withdraw a grant its installed version declared.
  // Two synthetic copies of Tasker: the installed one also lets everyone read
  // Person; the next version, one migration on, does not.
  const currentTasker = resolve('../..', 'example-apps/tasker')
  const everyoneReadsPerson = () => sql`select 1 from permission where owner_app = 'tasker' and role = 'All' and ref_table = 'Person'`
  async function taskerGrants() {
    const [app] = await sql`select perms from installed_app where name = 'tasker'`
    return sql`select ref_table from permission where row_id in ${sql(app.perms as string[])} order by 1`
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
      await editJson(resolve(installed, 'featherbase.json'), m => { m.permissions.push({ table: 'Person', role: 'All', can_read: true }) })
      await editJson(resolve(next, 'featherbase.json'), m => { m.migrations.push({ id: 'withdraw_person_read_probe', fromVersion: from, toVersion: to, operations: [] }) })
      await editJson(resolve(next, 'package.json'), p => { p.version = to })

      expect(await discoverPackages([installed])).toEqual([])
      await admin.post('/api/install_app', { name: 'tasker' })
      // A client of the installed version saves a task before the upgrade.
      const saved = await admin.fetch('/api/save_row', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `tasker@${from}` },
        body: JSON.stringify({ table: 'tasker.task', row: { task_title: 'Kept across the upgrade' } }) })
      expect(saved.status).toBe(201)
      const { row_id: task } = await saved.json() as { row_id: string }
      expect(await discoverPackages([installed, next])).toEqual([])
      await loadInstalledApps()
      expect(await admin.get('/api/runtime_app_versions')).toEqual([`tasker@${from}`])
      expect(await everyoneReadsPerson()).toHaveLength(1)

      const plan = await admin.post<{ planId: string; permissions: unknown[] }>('/api/preview_app_upgrade', { name: 'tasker', version: to })
      expect(plan.permissions).toEqual([{ withdraw: { table: 'Person', role: 'All', can_read: true } }])
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
    await sql`update permission set can_read = false where ref_table = 'other.task' and role = 'All'`
    await expect(reader.post('/api/dashboard/count', { table: 'other.task' })).rejects.toMatchObject({ status: 403 })
    await expect(reader.post('/api/dashboard/chart', { table: 'other.task', group_by: 'quantity' })).rejects.toMatchObject({ status: 403 })
  })

  test('a generic dashboard count or chart over a turned-off app’s table is refused, and its rows stay', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'counted', quantity: 37 } })
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    await expect(admin.post('/api/dashboard/count', { table: 'other.task' })).rejects.toMatchObject({ status: 403 })
    await expect(admin.post('/api/dashboard/chart', { table: 'other.task', group_by: 'quantity' })).rejects.toMatchObject({ status: 403 })
    expect(await sql`select quantity from other.task where row_id = 'counted'`).toEqual([{ quantity: 37 }])
  })
})

describe('Only administrators manage apps', () => {
  test('an ordinary member can neither install, turn off, nor preview an upgrade of an app', async ({ admin, createUser }) => {
    await discoverPackages([resolve('../..', 'test-apps/other')])
    const member = await createUser({ email: 'not-a-manager@example.com', roles: ['All'] })
    await expect(member.post('/api/install_app', { name: 'other' })).rejects.toMatchObject({ status: 403 })
    expect(await sql`select name from installed_app where name = 'other'`).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    await expect(member.post('/api/set_app_enabled', { name: 'other', enabled: false })).rejects.toMatchObject({ status: 403 })
    await expect(member.post('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })).rejects.toMatchObject({ status: 403 })
    await expect(member.get('/api/apps')).rejects.toMatchObject({ status: 403 })
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
      const member = await createUser({ email: 'delivered-member@example.com', roles: [] })
      expect(await member.get('/api/app_catalog')).toContainEqual({ name: 'tasker', title: 'Tasker', href: '/tasker/' })

      const page = await member.fetch('/tasker/', { headers: { accept: 'text/html' } })
      expect(page.status).toBe(200)
      const html = await page.text()
      expect(html).toContain('<featherbase-bar data-app="tasker" data-title="Tasker"></featherbase-bar>')
      // The client's own entry script is served from the staged package.
      const entry = /<script type="module"[^>]*src="(\/tasker\/[^"]+\.js)"/.exec(html)?.[1]
      expect(entry).toBeDefined()
      const script = await member.fetch(entry!)
      expect(script.status).toBe(200)
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
      expect((await member.fetch('/other/targets', { headers: { accept: 'text/html' } })).status).toBe(404)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test("a tab's deep address serves the app's page with the bar, at the device's width", async ({ admin }) => {
    const directory = await otherWith({ tabs: TABS })
    try {
      expect(await discoverPackages([directory])).toEqual([])
      await admin.post('/api/install_app', { name: 'other' })
      const res = await admin.fetch('/other/targets', { headers: { accept: 'text/html' } })
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('<featherbase-bar data-app="other" data-title="Other tasks"></featherbase-bar>')
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('an app that declares no tabs gets none', async ({ admin }) => {
    expect(await discoverPackages([resolve('../..', 'test-apps/other')])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    expect(await admin.get('/api/app_catalog')).toEqual([{ name: 'other', title: 'Other tasks', href: '/other/' }])
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
