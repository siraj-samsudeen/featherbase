import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { describe, expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { committedTest } from './pg-test-shared'
import { discoverPackages, availableRuntimeVersions, runPackageAction } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { sql } from '../src/db'
import { app } from '../src/index'
import { registerController, unregisterController, type TableController } from '../src/controllers'
import { callerDocuments } from '../src/runtime-actions'
import { expectRefused, expectStatus, makeTable } from './fixtures'

const directory = resolve('../..', 'test-apps/action-proof')
const action = '/api/app_actions/actionproof/'
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': 'actionproof@1.1.0,actionproof2@1.1.0' },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

describe('declared transactional runtime actions', () => {
  test('the exported package action API refuses Guest before running the handler', async ({ admin }) => {
    expect(await discoverPackages([directory])).toEqual([])
    await admin.post('/api/install_app', { name: 'actionproof' })
    await expect(runPackageAction('actionproof', 'probe', {
      idempotencyKey: 'guest-write',
      payload: { operation: 'create', table: 'actionproof.destination', values: { title: 'Must not exist' } },
    }, 'Guest')).rejects.toMatchObject({
      type: 'AuthenticationError', message: 'Sign in to run an application action', fields: undefined,
    })
    expect(await sql`select row_id from actionproof.destination`).toEqual([])
    expect(await sql`select * from runtime_action_result`).toEqual([])
  })

  test('an action request without payload is a validation error, not a handler failure', async ({ admin }) => {
    expect(await discoverPackages([directory])).toEqual([])
    await admin.post('/api/install_app', { name: 'actionproof' })
    await expect(admin.post(action + 'transform', { idempotencyKey: 'missing-payload' })).rejects.toMatchObject({
      status: 417, type: 'ValidationError', message: '417 ValidationError: Expected { idempotencyKey, payload }', fields: undefined,
    })
    expect(await sql`select row_id from actionproof.destination`).toEqual([])
    expect(await sql`select * from runtime_action_result`).toEqual([])
  })

  test('asymmetric multi-row writes commit once, replay after restart, and reject payload reuse', async ({ admin }) => {
    expect(await discoverPackages([directory])).toEqual([])
    await admin.post('/api/install_app', { name: 'actionproof' })
    const source = await admin.post<any>('/api/save_row', { table: 'actionproof.work', row: { row_id: 'source', title: '37 units' } })
    const request = { idempotencyKey: 'one', payload: { source: 'source', updatedAt: source.updated_at } }
    const first = await admin.post<any>(action + 'transform', request)
    expect(first.result).toMatchObject({ marker: 37, source: 'source' })
    expect(await admin.post(action + 'transform', request)).toEqual(first)
    expect(await admin.post(action + 'transform', { ...request, payload: { updatedAt: source.updated_at, source: 'source' } })).toEqual(first)
    await discoverPackages([directory]); await loadInstalledApps()
    expect(await admin.post(action + 'transform', request)).toEqual(first)
    expect(await sql`select title from actionproof.destination`).toEqual([{ title: '37 units / destination' }])
    expect(await sql`select destination from actionproof.work`).toEqual([{ destination: first.result.destination }])
    expect(await sql`select content from comment where ref_table = 'actionproof.work'`).toEqual([{ content: 'Moved with 37 units, not 17' }])
    expect(await sql`select row_id from version where ref_table = 'actionproof.work'`).toHaveLength(1)
    await expectRefused(admin.post(action + 'transform', { ...request, payload: { ...request.payload, fail: true } }), 409)
    await admin.post('/api/set_app_enabled', { name: 'actionproof', enabled: false })
    await expectRefused(admin.post(action + 'transform', request), 403)
  })

  test('handler failure and stale revisions leave no destination, discussion, version or result', async ({ admin, createUser }) => {
    await discoverPackages([directory]); await admin.post('/api/install_app', { name: 'actionproof' })
    const member = await createUser({ email: 'action-owner@example.com', roles: [] })
    const outsider = await createUser({ email: 'action-outsider@example.com', roles: [] })
    const source = await member.post<any>('/api/save_row', { table: 'actionproof.work', row: { row_id: 'owned', title: '17 different units' } })
    const request = { idempotencyKey: 'retryable', payload: { source: 'owned', updatedAt: source.updated_at, fail: true } }
    await expectRefused(outsider.post(action + 'transform', request), 403)
    await expectRefused(member.post(action + 'transform', request), 500)
    await expectRefused(member.post(action + 'transform', { ...request, payload: {} }), 417)
    await expectRefused(member.post(action + 'transform', { ...request, payload: { ...request.payload, updatedAt: '2001-01-01T00:00:00Z' } }), 409)
    expect(await sql`select row_id from actionproof.destination`).toHaveLength(0)
    expect(await sql`select destination from actionproof.work`).toEqual([{ destination: null }])
    expect(await sql`select row_id from version where ref_table = 'actionproof.work'`).toHaveLength(0)
    expect(await sql`select row_id from comment where ref_table = 'actionproof.work'`).toHaveLength(0)
    expect(await sql`select * from runtime_action_result`).toHaveLength(0)
    await member.post(action + 'transform', { ...request, payload: { ...request.payload, fail: false } })
  })

  test('guard reports retained history and refuses stale deletion; successful deletion replays', async ({ admin }) => {
    await discoverPackages([directory]); await admin.post('/api/install_app', { name: 'actionproof' })
    const source = await admin.post<any>('/api/save_row', { table: 'actionproof.work', row: { row_id: 'accident', title: 'Discard me' } })
    const request = { idempotencyKey: 'delete', payload: { source: 'accident', updatedAt: source.updated_at } }
    await expectRefused(admin.post(action + 'discard', { ...request, payload: { ...request.payload, updatedAt: '2000-01-01' } }), 409)
    const deleted = await admin.post(action + 'discard', request)
    expect(deleted).toEqual({ result: { deleted: true, source: 'accident' } })
    expect(await admin.post(action + 'discard', request)).toEqual(deleted)
    await expectRefused(admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'actionproof.work', ref_name: 'accident', content: 'Too late' } }), 404)
    const retained = await admin.post<any>('/api/save_row', { table: 'actionproof.work', row: { row_id: 'retained', title: 'Keep me' } })
    await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'actionproof.work', ref_name: 'retained', content: 'Keep this discussion' } })
    const guard = { idempotencyKey: 'guard', payload: { source: 'retained', updatedAt: retained.updated_at } }
    await expectRefused(admin.post(action + 'discard', guard), 417)
    expect(await admin.post(action + 'discard', { ...guard, payload: { ...guard.payload, explain: true } })).toEqual({ result: { deleted: false, counts: { comments: 1, versions: 0, references: 0, files: 0, shares: 0 } } })
  })

  committedTest('effects wait for result commit, never run on rollback/replay, and disable waits through a failed effect', async ({ admin: unpinnedAdmin }) => {
    const admin = pinned(unpinnedAdmin)
    await discoverPackages([directory]); await admin.post('/api/install_app', { name: 'actionproof' })
    const source = await admin.post<any>('/api/save_row', { table: 'actionproof.work', row: { row_id: 'tail', title: '41 units' } })
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    let effects = 0
    const controller: TableController = { table: 'actionproof.destination', hooks: { after_commit: async () => {
      effects++
      expect(await sql`select * from runtime_action_result where idempotency_key = 'effect'`).toHaveLength(1)
      entered(); await gate
      throw new Error('Expected best-effort effect failure')
    } } }
    registerController(controller)
    const request = { idempotencyKey: 'effect', payload: { source: 'tail', updatedAt: source.updated_at } }
    let write: Promise<unknown> | undefined
    let disable: Promise<unknown> | undefined
    try {
      await expectRefused(admin.post(action + 'transform', { ...request, payload: { ...request.payload, fail: true } }), 500)
      expect(effects).toBe(0)
      write = admin.post(action + 'transform', request)
      await started
      disable = admin.post('/api/set_app_enabled', { name: 'actionproof', enabled: false })
      await expect.poll(async () => Number((await sql`select count(*) as n from pg_locks where locktype = 'advisory' and classid = 296 and objid = 1 and not granted`)[0].n)).toBe(1)
      release()
      const result = await write
      await disable
      await expectRefused(admin.post(action + 'transform', request), 403)
      await admin.post('/api/set_app_enabled', { name: 'actionproof', enabled: true })
      expect(await admin.post(action + 'transform', request)).toEqual(result)
      expect(effects).toBe(1)
    } finally {
      release(); await Promise.allSettled([write, disable]); unregisterController(controller)
    }
  })

  test('authentication, closed declarations, private APIs and missing-code restarts reject', async ({ admin }) => {
    await discoverPackages([directory]); await admin.post('/api/install_app', { name: 'actionproof' })
    const request = { idempotencyKey: 'probe', payload: { operation: 'shape' } }
    await expectStatus(await app.request(action + 'probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }), 401)
    await expectRefused(admin.post(action + 'constructor', request), 404)
    expect(await admin.post(action + 'probe', request)).toEqual({ result: ['authorization', 'baseTables', 'changeProposals', 'documents', 'mail', 'payload', 'people', 'reject', 'roles', 'secrets', 'settings', 'user', 'userName'] })
    expect(await admin.post(action + 'probe', { idempotencyKey: 'roles', payload: { operation: 'roles' } })).toEqual({ result: expect.arrayContaining(['System Manager']) })
    for (const table of ['Permission', 'runtime_action_result', 'other.task']) {
      await expectRefused(admin.post(action + 'probe', { idempotencyKey: table, payload: { operation: 'create', table, values: { row_id: 'forbidden' } } }), 417)
    }
    await expectRefused(admin.post(action + 'probe', { ...request, user: 'Administrator' }), 417)
    const manager = await admin.get<any>('/api/apps')
    expect(manager.actions).toContainEqual({ app: 'actionproof', actions: ['transform', 'discard', 'probe'] })
    expect(await sql`select count(*)::int as grants from pg_class c, aclexplode(c.relacl) a where c.oid = 'featherbase.runtime_action_result'::regclass and a.grantee <> c.relowner`).toEqual([{ grants: 0 }])
    await discoverPackages([]); await loadInstalledApps()
    await expectRefused(admin.post(action + 'probe', request), 403)
  })

  // #912: an administrator lets an app read named instance Tables, as the caller, never write them.
  test('linked_tables: read as the caller, never written, and nothing without the listing', async ({ admin, createUser }) => {
    await discoverPackages([directory]); await admin.post('/api/install_app', { name: 'actionproof' })
    await admin.post('/api/table_def', { name: 'Linked Probe', columns: [{ column_name: 'label', column_type: 'Data' }] })
    const row = await admin.post<any>('/api/save_row', { table: 'Linked Probe', row: { label: 'visible' } })
    const probe = (client: TestClient, operation: string, extra: object) => client.post<any>(action + 'probe', { idempotencyKey: randomUUID(), payload: { operation, table: 'Linked Probe', ...extra } })
    await expectRefused(probe(admin, 'list', { values: { fields: ['label'] } }), 417)
    let setting = await admin.post<any>('/api/save_row', { table: 'App Setting', row: { row_id: 'actionproof.linked_tables', value: 'not json' } })
    await expectRefused(probe(admin, 'list', { values: { fields: ['label'] } }), 417)
    setting = await admin.post<any>('/api/save_row', { table: 'App Setting', row: { row_id: 'actionproof.linked_tables', updated_at: setting.updated_at, value: JSON.stringify({ table: 'Linked Probe' }) } })
    await expectRefused(probe(admin, 'list', { values: { fields: ['label'] } }), 417)
    await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'actionproof.linked_tables', updated_at: setting.updated_at, value: JSON.stringify(['Linked Probe']) } })
    expect((await probe(admin, 'list', { values: { fields: ['label'] } })).result).toEqual([{ label: 'visible' }])
    expect((await probe(admin, 'get', { source: row.row_id })).result).toMatchObject({ label: 'visible' })
    expect((await probe(admin, 'activity', { source: row.row_id })).result).toMatchObject({ comments: [] })
    // A read error other than permission still surfaces.
    await expect(probe(admin, 'list', { values: { fields: ['no_such_column'] } })).rejects.toMatchObject({ status: expect.any(Number) })
    await expectRefused(probe(admin, 'create', { values: { label: 'written' } }), 417)
    await expectRefused(probe(admin, 'deletionState', { source: row.row_id }), 417)
    await expectRefused(probe(admin, 'update', { values: { row_id: row.row_id, updated_at: row.updated_at, label: 'changed' } }), 417)
    // A caller without read permission on the linked Table reads nothing.
    const plain = await createUser({ email: 'linked-reader@example.com' })
    expect((await probe(plain, 'list', { values: { fields: ['label'] } })).result).toEqual([])
  })

  test('two packages isolate the same local action and key; incomplete declarations never load', async ({ admin }) => {
    const second = await mkdtemp(resolve('test/.runtime-actions-'))
    try {
      await cp(directory, second, { recursive: true })
      for (const file of ['featherbase.json', 'server.mjs'])
        await writeFile(resolve(second, file), (await readFile(resolve(second, file), 'utf8')).replaceAll('actionproof', 'actionproof2'))
      expect(await discoverPackages([directory, second])).toEqual([])
      for (const name of ['actionproof', 'actionproof2']) {
        await admin.post('/api/install_app', { name })
        const source = await admin.post<any>('/api/save_row', { table: `${name}.work`, row: { row_id: 'same', title: name === 'actionproof' ? '17' : '53' } })
        await admin.post(`/api/app_actions/${name}/transform`, { idempotencyKey: 'same', payload: { source: 'same', updatedAt: source.updated_at } })
      }
      expect(await sql`select title from actionproof.destination`).toEqual([{ title: '17 / destination' }])
      expect(await sql`select title from actionproof2.destination`).toEqual([{ title: '53 / destination' }])
      const manifestPath = resolve(second, 'featherbase.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      for (const actions of [{ ...manifest.actions, version: 3 }, { ...manifest.actions, names: ['transform'] }, { ...manifest.actions, names: ['transform', 'discard', 'probe', 'absent'] }, { ...manifest.actions, tables: ['Undeclared Shared'] }]) {
        await writeFile(manifestPath, JSON.stringify({ ...manifest, actions }))
        expect(await discoverPackages([second])).toHaveLength(1)
      }
    } finally { await rm(second, { recursive: true, force: true }) }
  })

  test('finalized references, retained update counts, related queries and helper overlap cannot evade authority', async ({ admin, createUser }) => {
    await discoverPackages([directory]); await admin.post('/api/install_app', { name: 'actionproof' })
    const owner = await createUser({ email: 'reference-owner@example.com', roles: [] })
    const other = await createUser({ email: 'reference-other@example.com', roles: [] })
    const source = await owner.post<any>('/api/save_row', { table: 'actionproof.work', row: { row_id: 'scope', title: 'Public input' } })
    const hidden = await other.post<any>('/api/save_row', { table: 'actionproof.destination', row: { title: 'Private destination' } })
    const controller: TableController = { table: 'actionproof.work', hooks: { before_validate: ctx => { ctx.row.destination = hidden.row_id } } }
    registerController(controller)
    try {
      await expectRefused(owner.post(action + 'probe', { idempotencyKey: 'scoped', payload: { operation: 'update', table: 'actionproof.work', values: { row_id: source.row_id, updated_at: source.updated_at, title: 'Forbidden after hook' } } }), 403)
      expect(await sql`select title, destination from actionproof.work where row_id = 'scope'`).toEqual([{ title: 'Public input', destination: null }])
      expect(await sql`select row_id from version where ref_table = 'actionproof.work'`).toHaveLength(0)
    } finally { unregisterController(controller) }
    await expectRefused(owner.post(action + 'probe', { idempotencyKey: 'parallel', payload: { operation: 'parallel', source: source.row_id } }), 417)
    const changed = await owner.post<any>('/api/save_row', { table: 'actionproof.work', row: { ...source, title: 'Retain the edit' } })
    const activity = await owner.post<any>(action + 'probe', { idempotencyKey: 'activity', payload: { operation: 'activity', table: 'actionproof.work', source: source.row_id } })
    expect(activity.result.versions[0].data.changed).toEqual([['title', 'Public input', 'Retain the edit']])
    expect(await owner.post(action + 'discard', { idempotencyKey: 'has-history', payload: { source: source.row_id, updatedAt: changed.updated_at, explain: true } })).toEqual({ result: { deleted: false, counts: { comments: 0, versions: 1, references: 0, files: 0, shares: 0 } } })
    // Neither a system Table declaration nor its ordinary read grant makes
    // global Comment queries a document-authorized activity API.
    await expectRefused(owner.post(action + 'probe', { idempotencyKey: 'global-comments', payload: { operation: 'list', table: 'Comment' } }), 417)
    await expectRefused(owner.post(action + 'probe', { idempotencyKey: 'related', payload: { operation: 'list', table: 'actionproof.work', values: { filters: [['destination', 'related', { table: 'actionproof.destination' }]] } } }), 417)
  })

  test('escaped helpers, unawaited writes, swallowed failures and non-JSON results fail without partial commits', async ({ admin }) => {
    await discoverPackages([directory]); await admin.post('/api/install_app', { name: 'actionproof' })
    for (const operation of ['unawaited', 'swallow', 'nonjson']) {
      await expectRefused(admin.post(action + 'probe', { idempotencyKey: operation, payload: { operation } }), 417)
      expect(await sql`select row_id from actionproof.destination`).toHaveLength(0)
      expect(await sql`select * from runtime_action_result`).toHaveLength(0)
    }
    expect(await admin.post(action + 'probe', { idempotencyKey: 'escape', payload: { operation: 'escape' } })).toEqual({ result: true })
    const artifact = availableRuntimeVersions().find(pkg => pkg.name === 'actionproof')!
    const module = await import(/* @vite-ignore */ `${pathToFileURL(resolve(directory, 'server.mjs')).href}?artifact=${artifact.digest}`)
    await expect(module.escapedDocuments.create('actionproof.destination', { title: 'Too late' })).rejects.toMatchObject({ type: 'ValidationError' })
    expect(await sql`select row_id from actionproof.destination`).toHaveLength(0)
  })

  test('document helpers refuse invalid row values, targets and missing revisions without partial results', async ({ admin }) => {
    await discoverPackages([directory]); await admin.post('/api/install_app', { name: 'actionproof' })
    const source = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', {
      table: 'actionproof.work', row: { row_id: 'guarded', title: 'preserve 37 units' },
    })
    const cases = [
      { operation: 'get', table: 'actionproof.work', source: '', message: 'A row ID is required' },
      { operation: 'get', table: 'actionproof.work', source: 17, message: 'A row ID is required' },
      { operation: 'create', table: 'actionproof.destination', values: [], message: 'Expected row values' },
      { operation: 'create', table: 'actionproof.destination', values: 41, message: 'Expected row values' },
      { operation: 'update', table: 'actionproof.work', values: { title: 'no identity' }, message: 'Update requires row_id and updated_at' },
      { operation: 'update', table: 'actionproof.work', values: { row_id: source.row_id, title: 'no revision' }, message: 'Update requires row_id and updated_at' },
      { operation: 'create', table: 'Comment', values: { content: 'no target' }, message: 'Comment requires its document target' },
      { operation: 'create', table: 'Comment', values: { ref_table: 'actionproof.work', content: 'no row' }, message: 'Comment requires its document target' },
      { operation: 'delete', table: 'actionproof.work', source: source.row_id, message: 'Delete requires updatedAt' },
    ]
    for (const [index, { message, ...payload }] of cases.entries()) {
      await expect(admin.post(action + 'probe', { idempotencyKey: `invalid-helper-${index}`, payload }))
        .rejects.toMatchObject({ status: 417, type: 'ValidationError', message: expect.stringContaining(message) })
    }
    expect(await admin.get(`/api/table/actionproof.work/${source.row_id}`)).toMatchObject({
      title: 'preserve 37 units', updated_at: source.updated_at, destination: null,
    })
    expect(await sql`select row_id from actionproof.destination`).toEqual([])
    expect(await sql`select content from comment where ref_table = 'actionproof.work'`).toEqual([])
    expect(await sql`select row_id from version where ref_table = 'actionproof.work'`).toEqual([])
    expect(await sql`select * from runtime_action_result`).toEqual([])
  })
})

describe('action_helpers_preserve_caller_authority', () => {
  test('an action listing a declared table sees only the rows its caller may read', async ({ admin, createUser }) => {
    await discoverPackages([directory]); await admin.post('/api/install_app', { name: 'actionproof' })
    const owner = await createUser({ email: 'list-owner@example.com', roles: [] })
    const other = await createUser({ email: 'list-other@example.com', roles: [] })
    await owner.post('/api/save_row', { table: 'actionproof.work', row: { row_id: 'mine-17', title: '17 owned units' } })
    await other.post('/api/save_row', { table: 'actionproof.work', row: { row_id: 'theirs-43', title: '43 private units' } })
    const listed = await owner.post<any>(action + 'probe', { idempotencyKey: 'list-own', payload: { operation: 'list', table: 'actionproof.work', values: { fields: ['row_id', 'title'] } } })
    expect(listed.result).toEqual([{ row_id: 'mine-17', title: '17 owned units' }])
  })
})

describe('real package extensions retain transactional helper boundaries', () => {
  const extensionTest = test.extend<{ artifactDirectory: string }>({
    artifactDirectory: async ({ admin }, use) => {
      const root = await mkdtemp(resolve('test/.runtime-action-extension-'))
      try {
        await makeTable(admin, { name: 'Shared Action Note', columns: ['title'], track_changes: true })
        await cp(directory, root, { recursive: true })
        const manifestPath = resolve(root, 'featherbase.json')
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
        const policy = { policy: { kind: 'table' }, authorization: { kind: 'generic' } }
        manifest.actions.operations.delete_shared = policy
        manifest.actions.operations.forget_failed_write = policy
        manifest.actions.tables.push('Shared Action Note')
        manifest.permissions.push({ table: 'Shared Action Note', role: 'All', operations: { read: '*', delete: true } })
        manifest.reads = { version: 1, operations: { preview: policy }, tables: ['actionproof.work'] }
        await writeFile(manifestPath, JSON.stringify(manifest))
        const serverPath = resolve(root, 'server.mjs')
        await writeFile(serverPath, `${await readFile(serverPath, 'utf8')}
actions.delete_shared = async ({ payload, documents }) => {
  await documents.delete('Shared Action Note', payload.source, payload.updatedAt)
  return { deleted: true }
}
actions.forget_failed_write = async ({ payload, documents }) => {
  const destination = await documents.create('actionproof.destination', { title: 'Must roll back' })
  await documents.update('actionproof.work', { row_id: payload.source, updated_at: payload.updatedAt, destination: destination.row_id })
  await documents.create('Comment', { ref_table: 'actionproof.work', ref_name: payload.source, content: 'Must roll back too' })
  void documents.create('actionproof.destination', {}).catch(() => {})
  return { accepted: true }
}
export const reads = {
  async preview({ payload, documents }) { return documents.get('actionproof.work', payload.source) },
}
`)
        await use(root)
      } finally { await rm(root, { recursive: true, force: true }) }
    },
  })

  extensionTest('a declared shared Table with delete permission still cannot be deleted by an app action', async ({ admin, artifactDirectory }) => {
    expect(await discoverPackages([artifactDirectory])).toEqual([])
    await admin.post('/api/install_app', { name: 'actionproof' })
    const row = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', {
      table: 'Shared Action Note', row: { title: 'Keep this shared row' },
    })
    await expect(admin.post(action + 'delete_shared', {
      idempotencyKey: 'shared-delete', payload: { source: row.row_id, updatedAt: row.updated_at },
    })).rejects.toMatchObject({
      status: 417, type: 'ValidationError', message: '417 ValidationError: Actions may delete only their owned rows', fields: undefined,
    })
    expect(await admin.get(`/api/table/Shared%20Action%20Note/${row.row_id}`)).toMatchObject({
      title: 'Keep this shared row', updated_at: row.updated_at,
    })
    expect(await sql`select row_id from version where ref_table = 'Shared Action Note'`).toEqual([])
    expect(await sql`select * from runtime_action_result`).toEqual([])
  })

  extensionTest('a failing unawaited operation preserves its validation error and rolls back earlier writes and history', async ({ admin, artifactDirectory }) => {
    expect(await discoverPackages([artifactDirectory])).toEqual([])
    await admin.post('/api/install_app', { name: 'actionproof' })
    const source = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', {
      table: 'actionproof.work', row: { row_id: 'pending-failure', title: 'Keep original work' },
    })
    await expect(admin.post(action + 'forget_failed_write', {
      idempotencyKey: 'pending-failure', payload: { source: source.row_id, updatedAt: source.updated_at },
    })).rejects.toMatchObject({
      status: 417, type: 'ValidationError', message: '417 ValidationError: Invalid values for actionproof.destination', fields: { title: 'Required' },
    })
    expect(await admin.get(`/api/table/actionproof.work/${source.row_id}`)).toMatchObject({
      title: 'Keep original work', updated_at: source.updated_at, destination: null,
    })
    expect(await sql`select row_id from actionproof.destination`).toEqual([])
    expect(await sql`select row_id from comment where ref_table = 'actionproof.work'`).toEqual([])
    expect(await sql`select row_id from version where ref_table = 'actionproof.work'`).toEqual([])
    expect(await sql`select * from runtime_action_result`).toEqual([])
  })

  extensionTest('a read without payload is refused before its handler can inspect a document', async ({ admin, artifactDirectory }) => {
    expect(await discoverPackages([artifactDirectory])).toEqual([])
    await admin.post('/api/install_app', { name: 'actionproof' })
    await expect(admin.post('/api/app_reads/actionproof/preview', {})).rejects.toMatchObject({
      status: 417, type: 'ValidationError', message: '417 ValidationError: Expected { payload }', fields: undefined,
    })
    expect(await sql`select * from runtime_action_result`).toEqual([])
  })
})

describe('an action\'s document access', () => {
  pgTest('never reaches a Table another app owns, even when named', async ({ admin }) => {
    expect(await discoverPackages([resolve('../..', 'test-apps/other')])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    const access = callerDocuments('borrower', ['other.task'], 'Administrator')
    const refused = { message: 'Actions cannot access another application’s owned Tables' }
    await expect(access.documents.get('other.task', 'any')).rejects.toMatchObject(refused)
    // The refusal also fails the action as a whole, whatever the handler did with it.
    await expect(access.close()).rejects.toMatchObject(refused)
  })
})
