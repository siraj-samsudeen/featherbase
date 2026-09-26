import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { describe, expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { discoverPackages, availableRuntimeVersions } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { sql } from '../src/db'
import { app } from '../src/index'
import { registerController, unregisterController, type TableController } from '../src/controllers'

const directory = resolve('../..', 'runtime-apps/action-proof')
const action = '/api/app_actions/actionproof/'
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': 'actionproof@1.1.0,actionproof2@1.1.0' },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

describe('declared transactional runtime actions', () => {
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
    await expect(admin.post(action + 'transform', { ...request, payload: { ...request.payload, fail: true } })).rejects.toMatchObject({ status: 409 })
    await admin.post('/api/set_app_enabled', { name: 'actionproof', enabled: false })
    await expect(admin.post(action + 'transform', request)).rejects.toMatchObject({ status: 403 })
  })

  test('handler failure and stale revisions leave no destination, discussion, version or result', async ({ admin, createUser }) => {
    await discoverPackages([directory]); await admin.post('/api/install_app', { name: 'actionproof' })
    const member = await createUser({ email: 'action-owner@example.com', roles: [] })
    const outsider = await createUser({ email: 'action-outsider@example.com', roles: [] })
    const source = await member.post<any>('/api/save_row', { table: 'actionproof.work', row: { row_id: 'owned', title: '17 different units' } })
    const request = { idempotencyKey: 'retryable', payload: { source: 'owned', updatedAt: source.updated_at, fail: true } }
    await expect(outsider.post(action + 'transform', request)).rejects.toMatchObject({ status: 403 })
    await expect(member.post(action + 'transform', request)).rejects.toMatchObject({ status: 500 })
    await expect(member.post(action + 'transform', { ...request, payload: {} })).rejects.toMatchObject({ status: 417 })
    await expect(member.post(action + 'transform', { ...request, payload: { ...request.payload, updatedAt: '2001-01-01T00:00:00Z' } })).rejects.toMatchObject({ status: 409 })
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
    await expect(admin.post(action + 'discard', { ...request, payload: { ...request.payload, updatedAt: '2000-01-01' } })).rejects.toMatchObject({ status: 409 })
    const deleted = await admin.post(action + 'discard', request)
    expect(deleted).toEqual({ result: { deleted: true, source: 'accident' } })
    expect(await admin.post(action + 'discard', request)).toEqual(deleted)
    await expect(admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'actionproof.work', ref_name: 'accident', content: 'Too late' } })).rejects.toMatchObject({ status: 404 })
    const retained = await admin.post<any>('/api/save_row', { table: 'actionproof.work', row: { row_id: 'retained', title: 'Keep me' } })
    await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'actionproof.work', ref_name: 'retained', content: 'Keep this discussion' } })
    const guard = { idempotencyKey: 'guard', payload: { source: 'retained', updatedAt: retained.updated_at } }
    await expect(admin.post(action + 'discard', guard)).rejects.toMatchObject({ status: 417 })
    expect(await admin.post(action + 'discard', { ...guard, payload: { ...guard.payload, explain: true } })).toEqual({ result: { deleted: false, counts: { comments: 1, versions: 0, references: 0, files: 0, shares: 0 } } })
  })

  test('effects wait for result commit, never run on rollback/replay, and disable waits through a failed effect', async ({ admin }) => {
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
      await expect(admin.post(action + 'transform', { ...request, payload: { ...request.payload, fail: true } })).rejects.toMatchObject({ status: 500 })
      expect(effects).toBe(0)
      write = admin.post(action + 'transform', request)
      await started
      disable = admin.post('/api/set_app_enabled', { name: 'actionproof', enabled: false })
      await expect.poll(async () => Number((await sql`select count(*) as n from pg_locks where locktype = 'advisory' and classid = 296 and objid = 1 and not granted`)[0].n)).toBe(1)
      release()
      const result = await write
      await disable
      await expect(admin.post(action + 'transform', request)).rejects.toMatchObject({ status: 403 })
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
    expect((await app.request(action + 'probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })).status).toBe(401)
    await expect(admin.post(action + 'constructor', request)).rejects.toMatchObject({ status: 404 })
    expect(await admin.post(action + 'probe', request)).toEqual({ result: ['authorization', 'documents', 'payload', 'reject', 'user'] })
    for (const table of ['Permission', 'runtime_action_result', 'other.task']) {
      await expect(admin.post(action + 'probe', { idempotencyKey: table, payload: { operation: 'create', table, values: { row_id: 'forbidden' } } })).rejects.toMatchObject({ status: 417 })
    }
    await expect(admin.post(action + 'probe', { ...request, user: 'Administrator' })).rejects.toMatchObject({ status: 417 })
    const manager = await admin.get<any>('/api/apps')
    expect(manager.actions).toContainEqual({ app: 'actionproof', actions: ['transform', 'discard', 'probe'] })
    expect(await sql`select has_table_privilege('app_client', 'featherbase.runtime_action_result', 'select') as allowed`).toEqual([{ allowed: false }])
    await discoverPackages([]); await loadInstalledApps()
    await expect(admin.post(action + 'probe', request)).rejects.toMatchObject({ status: 403 })
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
      await expect(owner.post(action + 'probe', { idempotencyKey: 'scoped', payload: { operation: 'update', table: 'actionproof.work', values: { row_id: source.row_id, updated_at: source.updated_at, title: 'Forbidden after hook' } } })).rejects.toMatchObject({ status: 403 })
      expect(await sql`select title, destination from actionproof.work where row_id = 'scope'`).toEqual([{ title: 'Public input', destination: null }])
      expect(await sql`select row_id from version where ref_table = 'actionproof.work'`).toHaveLength(0)
    } finally { unregisterController(controller) }
    await expect(owner.post(action + 'probe', { idempotencyKey: 'parallel', payload: { operation: 'parallel', source: source.row_id } })).rejects.toMatchObject({ status: 417 })
    const changed = await owner.post<any>('/api/save_row', { table: 'actionproof.work', row: { ...source, title: 'Retain the edit' } })
    const activity = await owner.post<any>(action + 'probe', { idempotencyKey: 'activity', payload: { operation: 'activity', table: 'actionproof.work', source: source.row_id } })
    expect(activity.result.versions[0].data.changed).toEqual([['title', 'Public input', 'Retain the edit']])
    expect(await owner.post(action + 'discard', { idempotencyKey: 'has-history', payload: { source: source.row_id, updatedAt: changed.updated_at, explain: true } })).toEqual({ result: { deleted: false, counts: { comments: 0, versions: 1, references: 0, files: 0, shares: 0 } } })
    // Neither a system Table declaration nor its ordinary read grant makes
    // global Comment queries a document-authorized activity API.
    await expect(owner.post(action + 'probe', { idempotencyKey: 'global-comments', payload: { operation: 'list', table: 'Comment' } })).rejects.toMatchObject({ status: 417 })
    await expect(owner.post(action + 'probe', { idempotencyKey: 'related', payload: { operation: 'list', table: 'actionproof.work', values: { filters: [['destination', 'related', { table: 'actionproof.destination' }]] } } })).rejects.toMatchObject({ status: 417 })
  })

  test('escaped helpers, unawaited writes, swallowed failures and non-JSON results fail without partial commits', async ({ admin }) => {
    await discoverPackages([directory]); await admin.post('/api/install_app', { name: 'actionproof' })
    for (const operation of ['unawaited', 'swallow', 'nonjson']) {
      await expect(admin.post(action + 'probe', { idempotencyKey: operation, payload: { operation } })).rejects.toMatchObject({ status: 417 })
      expect(await sql`select row_id from actionproof.destination`).toHaveLength(0)
      expect(await sql`select * from runtime_action_result`).toHaveLength(0)
    }
    expect(await admin.post(action + 'probe', { idempotencyKey: 'escape', payload: { operation: 'escape' } })).toEqual({ result: true })
    const artifact = availableRuntimeVersions().find(pkg => pkg.name === 'actionproof')!
    const module = await import(/* @vite-ignore */ `${pathToFileURL(resolve(directory, 'server.mjs')).href}?artifact=${artifact.digest}`)
    await expect(module.escapedDocuments.create('actionproof.destination', { title: 'Too late' })).rejects.toMatchObject({ type: 'ValidationError' })
    expect(await sql`select row_id from actionproof.destination`).toHaveLength(0)
  })
})
