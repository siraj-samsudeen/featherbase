import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from './pg-test'
import { discoverPackages, availableRuntimeVersions } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { sql, withTransaction } from '../src/db'
import { actionDeclaration, readDeclaration, validateOperationFacts } from '../src/app-access'
import { AppError } from '../src/errors'
import { version as currentTaskerVersion } from '../../../runtime-apps/tasker/package.json'

const directory = resolve('../..', 'runtime-apps/scope-proof')
const read = '/api/app_reads/scopeproof/'
const action = '/api/app_actions/scopeproof/'
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': `scopeproof@1.0.0,tasker@${currentTaskerVersion}`, ...init?.headers },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
async function setup(admin: TestClient, createUser: CreateUserFn, roles = ['Scope Planner'], stores = ['A', 'C']) {
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'scopeproof' })
  const user = await createUser({ email: 'scoped@example.test', roles })
  for (const code of ['A', 'B', 'C']) await admin.post('/api/save_row', { table: 'scopeproof.store', row: { row_id: code, label: `${code} private label` } })
  for (const code of stores) await admin.post('/api/save_row', { table: 'Data Scope', row: { user: user.user, allow_table: 'scopeproof.store', for_value: code } })
  const digest = availableRuntimeVersions().find(p => p.name === 'scopeproof')!.digest
  const module = await import(`${pathToFileURL(resolve(directory, 'server.mjs')).href}?artifact=${digest}`)
  Object.assign(module.calls, { handler: 0, resolver: 0, authorizer: 0, upstream: 0 })
  for (const key of Object.keys(module.faults)) delete module.faults[key]
  return { user, module }
}

describe('fresh app roles and store access', () => {
  test('policies cannot omit their scope, use foreign dimensions, or opt actions/table policies into discovery', async () => {
    const policy = { kind: 'stores', storeTable: 'foreign.store', readRoles: ['Reader'], actionRoles: ['Writer'] }
    const operation = { policy, scope: { kind: 'request' }, authorization: { kind: 'generic' } }
    for (const invalid of [{}, { ...operation, scope: undefined }, { ...operation, policy: { ...policy, readRoles: [], actionRoles: [] } },
      { ...operation, policy: { kind: 'table' } }, { policy: { kind: 'table' }, authorization: { kind: 'generic' }, discoverStoreAccess: true }])
      expect(readDeclaration.safeParse({ version: 1, tables: [], operations: { read: invalid } }).success).toBe(false)
    expect(() => validateOperationFacts(operation as any, [])).toThrow('owned local Tables')
    for (const invalid of [{ ...operation, discoverStoreAccess: true }, { ...operation, authorization: { kind: 'product', name: 'pairs', facts: [] } },
      { policy: { kind: 'table' }, authorization: { kind: 'product', name: 'pairs', facts: [] } }])
      expect(actionDeclaration.safeParse({ version: 2, tables: [], operations: { write: invalid } }).success).toBe(false)
    expect(readDeclaration.safeParse({ version: 2, tables: [], operations: { read: operation } }).success).toBe(false)
    for (const column_type of ['Sub-table', 'Section Break', 'Column Break'])
      expect(() => validateOperationFacts({ ...operation, scope: { kind: 'resolver', name: 'scope', facts: [{ table: 'foreign.store', columns: ['layout'] }] } } as any,
        [{ name: 'foreign.store', columns: [{ column_name: 'layout', column_type }] }] as any)).toThrow('missing or unsupported')
  })

  test('missing declared callbacks on restart cannot fall back to generic access', async ({ admin, createUser }) => {
    const copy = await mkdtemp(resolve('test/.scope-package-'))
    try {
      await cp(directory, copy, { recursive: true })
      expect(await discoverPackages([copy])).toEqual([])
      await admin.post('/api/install_app', { name: 'scopeproof' })
      const user = await createUser({ email: 'callback@example.test', roles: ['Scope Reader'] })
      const server = resolve(copy, 'server.mjs')
      const original = await readFile(server, 'utf8')
      for (const name of ['authorizers', 'scopeResolvers', 'reads']) {
        await writeFile(server, original.replace(`export const ${name} =`, `export const unused =`))
        expect(await discoverPackages([copy])).toMatchObject([{ error: 'Package handlers and authorization callbacks must match declared names' }])
        await loadInstalledApps()
        await expect(user.get(read + 'product/access')).rejects.toMatchObject({ status: 403 })
      }
      await writeFile(server, original)
      expect(await discoverPackages([copy])).toEqual([])
      await loadInstalledApps()
      expect(await user.get(read + 'product/access')).toEqual({ storeCodes: [] })
    } finally { await rm(copy, { recursive: true, force: true }) }
  })

  test('historical exact Tasker refuses v1 actions, upgrades explicitly and can replay only table/generic legacy results', async ({ admin }) => {
    const historical = resolve('../..', 'runtime-apps/fixtures/tasker-v2')
    const current = resolve('../..', 'runtime-apps/tasker')
    expect(await discoverPackages([historical])).toEqual([])
    await admin.post('/api/install_app', { name: 'tasker' })
    const invoke = (version: string) => admin.fetch('/api/app_actions/tasker/promote', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `tasker@${version}` }, body: JSON.stringify({ idempotencyKey: 'old', payload: { row_id: 'deleted' } }) })
    expect((await invoke('2.0.0')).status).toBe(403)
    await sql`insert into runtime_action_result (caller, app, action, idempotency_key, payload, result)
      values ('Administrator', 'tasker', 'promote', 'old', '{"row_id":"deleted"}', '{"project":"original-37"}')`
    expect(await discoverPackages([historical, current])).toEqual([])
    await loadInstalledApps()
    const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'tasker', version: currentTaskerVersion })
    await admin.post('/api/upgrade_app', { name: 'tasker', version: currentTaskerVersion, planId: plan.planId })
    expect((await invoke(currentTaskerVersion)).status).toBe(403)
    await admin.post('/api/activate_app_upgrade', { name: 'tasker', version: currentTaskerVersion })
    expect((await invoke('2.0.0')).status).toBe(403)
    const replay = await invoke(currentTaskerVersion)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({ result: { project: 'original-37' } })
    expect(await discoverPackages([current, historical])).toEqual([])
    await loadInstalledApps()
    expect((await invoke(currentTaskerVersion)).status).toBe(200)
  })

  test('refusals survive rollback with fixed redacted audit reasons', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser, ['Scope Reader'], ['A'])
    await expect(user.post(read + 'stores', { payload: { storeCodes: ['private-store'], sql: 'secret-query', token: 'secret-token' } })).rejects.toMatchObject({ status: 403 })
    const logs = await sql`select operation, method, ref_table, reference_name from access_log where "user" = ${user.user} and operation = 'app_access_denied'`
    expect(logs).toEqual([{ operation: 'app_access_denied', method: 'scopeproof.stores:scope', ref_table: null, reference_name: null }])
    await expect(user.get(read + 'stores/access?user=secret-user')).rejects.toMatchObject({ status: 403 })
    await expect(user.get(read + 'missing/access')).rejects.toMatchObject({ status: 403 })
    expect(await sql`select method from access_log where "user" = ${user.user} and operation = 'app_access_denied' order by method`).toEqual([
      { method: 'scopeproof.missing:configuration' }, { method: 'scopeproof.stores:override' }, { method: 'scopeproof.stores:scope' },
    ])
  })

  test('callback errors and invalid footprints refuse without disclosure, while admitted handler errors remain intact', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser, ['Scope Planner'], ['A'])
    await admin.post('/api/save_row', { table: 'scopeproof.access', row: { row_id: user.user, pairs: [['A', 'X']] } })
    const replay = { idempotencyKey: 'private-result', payload: { storeCodes: ['A'], pairs: [['A', 'X']] } }
    await user.post(action + 'product', replay)
    await sql.unsafe(`alter table featherbase.runtime_action_result rename to protected_receipts;
      create function pg_temp.forbidden_result(jsonb) returns jsonb language plpgsql stable as
      $$ begin raise exception 'Protected result was read'; end $$;
      create view featherbase.runtime_action_result as select caller, app, action, idempotency_key, payload,
        "authorization", pg_temp.forbidden_result(result) as result from featherbase.protected_receipts`)
    const before = { ...module.calls }
    let refusals = 0
    const refused = async (path: string, body: unknown) => {
      const response = await user.fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: { type: 'PermissionError', message: 'Application access refused' } })
      refusals++
      const logs = await sql`select method from access_log where "user" = ${user.user} and operation = 'app_access_denied'`
      expect(logs).toHaveLength(refusals)
      expect(logs.every(row => /^scopeproof\.(object|product):(scope|product)$/.test(row.method))).toBe(true)
      expect(module.calls.handler).toBe(before.handler)
      expect(module.calls.upstream).toBe(before.upstream)
    }
    for (const error of [new Error('Private object 37 missing'), new AppError('NotFoundError', 'Private object 37 missing', { secret: '37' })]) {
      module.faults.resolver = error
      await refused(read + 'object', { payload: { id: 'private-37', storeCodes: ['A'] } })
      delete module.faults.resolver
      module.faults.authorizer = error
      await refused(read + 'product', { payload: replay.payload })
      await refused(action + 'product', replay)
      delete module.faults.authorizer
    }
    module.faults.scopeResult = { storeCodes: ['A'], productScope: { private: undefined } }
    await refused(read + 'object', { payload: { id: 'private-37', storeCodes: ['A'] } })
    delete module.faults.scopeResult
    module.faults.handler = new AppError('NotFoundError', 'Admitted business error')
    await expect(user.post(read + 'stores', { payload: { storeCodes: ['A'] } })).rejects.toMatchObject({ status: 404 })
    expect(await sql`select row_id from access_log where "user" = ${user.user} and operation = 'app_access_denied'`).toHaveLength(refusals)
    delete module.faults.handler
  })

  test('every HTTP admission requires exact active identity even before the first migration', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser, ['Scope Planner'], ['A'])
    expect((await sql`select migration_ledger from installed_app where name = 'scopeproof'`)[0].migration_ledger).toEqual([])
    const send = (identity: string, path: string, payload?: unknown) => user.fetch(path, {
      method: payload === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': identity },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    })
    let refusals = 0
    for (const identity of ['', 'bad private-37', 'tasker@1.0.0', 'scopeproof@9.9.9', 'scopeproof@0.9.0']) {
      for (const [path, body] of [[read + 'stores/access', undefined], [read + 'object', { payload: { id: 'missing', storeCodes: ['A'] } }],
        [action + 'product', { idempotencyKey: 'private', payload: { storeCodes: ['A'], pairs: [['A', 'X']] } }]] as const) {
        const response = await send(identity, path, body)
        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: { type: 'PermissionError', message: 'Application access refused' } })
        refusals++
      }
    }
    expect(module.calls).toEqual({ handler: 0, resolver: 0, authorizer: 0, upstream: 0 })
    expect(await sql`select row_id from access_log where "user" = ${user.user} and operation = 'app_access_denied'`).toHaveLength(refusals)
    expect((await send('scopeproof@1.0.0', read + 'stores/access')).status).toBe(200)
    expect((await send('scopeproof@1.0.0', read + 'stores', { payload: { storeCodes: ['A'] } })).status).toBe(200)
    expect((await send('scopeproof@1.0.0', action + 'write', { idempotencyKey: 'exact', payload: { storeCodes: ['A'], effect: 'exact' } })).status).toBe(200)
  })

  test('unavailable required audit fails closed as a visible server failure', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser, ['Scope Reader'], ['A'])
    await sql`alter table featherbase.access_log rename to unavailable_audit`
    const response = await user.fetch(read + 'stores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: { storeCodes: ['B'] } }) })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: { type: 'InternalError', message: 'Internal server error' } })
    expect(module.calls).toEqual({ handler: 0, resolver: 0, authorizer: 0, upstream: 0 })
  })

  test('pending and upgraded app identities refuse every protected route until exact activation', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser, ['Scope Planner'], ['A'])
    await admin.post('/api/save_row', { table: 'scopeproof.access', row: { row_id: user.user, pairs: [['A', 'X']] } })
    const receipt = { idempotencyKey: 'upgrade-replay', payload: { storeCodes: ['A'], pairs: [['A', 'X']] } }
    const original = await user.post(action + 'product', receipt)
    const target = await mkdtemp(resolve('test/.scope-upgrade-'))
    try {
      await cp(directory, target, { recursive: true })
      const pkg = JSON.parse(await readFile(resolve(target, 'package.json'), 'utf8'))
      await writeFile(resolve(target, 'package.json'), JSON.stringify({ ...pkg, version: '1.1.0' }))
      const manifest = JSON.parse(await readFile(resolve(target, 'featherbase.json'), 'utf8'))
      manifest.migrations = [{ id: 'identity_upgrade', fromVersion: '1.0.0', toVersion: '1.1.0', operations: [] }]
      await writeFile(resolve(target, 'featherbase.json'), JSON.stringify(manifest))
      expect(await discoverPackages([directory, target])).toEqual([])
      await loadInstalledApps()
      const { planId } = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'scopeproof', version: '1.1.0' })
      await admin.post('/api/upgrade_app', { name: 'scopeproof', version: '1.1.0', planId })
      const digest = availableRuntimeVersions().find(p => p.name === 'scopeproof' && p.version === '1.1.0')!.digest
      const module = await import(`${pathToFileURL(resolve(target, 'server.mjs')).href}?artifact=${digest}`)
      const send = (identity: string, path: string, body?: unknown) => user.fetch(path, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': identity },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      await sql.unsafe(`alter table featherbase.runtime_action_result rename to protected_receipts;
        create function pg_temp.forbidden_result(jsonb) returns jsonb language plpgsql stable as
        $$ begin raise exception 'Protected result was read'; end $$;
        create view featherbase.runtime_action_result as select caller, app, action, idempotency_key, payload,
          "authorization", pg_temp.forbidden_result(result) as result from featherbase.protected_receipts`)
      const paths = [[read + 'stores/access', undefined], [read + 'object', { payload: { id: 'missing', storeCodes: ['A'] } }], [action + 'product', receipt]] as const
      let refusals = 0
      for (const phase of ['pending', 'active']) {
        if (phase === 'active') await admin.post('/api/activate_app_upgrade', { name: 'scopeproof', version: '1.1.0' })
        for (const identity of ['', 'private malformed', 'other@1.1.0', 'scopeproof@1.0.0', 'scopeproof@9.9.9', ...(phase === 'pending' ? ['scopeproof@1.1.0'] : [])]) {
          for (const [path, body] of paths) {
            const response = await send(identity, path, body)
            expect(response.status).toBe(403)
            expect(await response.json()).toEqual({ error: { type: 'PermissionError', message: 'Application access refused' } })
            refusals++
          }
        }
      }
      expect(module.calls).toEqual({ handler: 0, resolver: 0, authorizer: 0, upstream: 0 })
      expect(await sql`select row_id from access_log where "user" = ${user.user} and operation = 'app_access_denied'`).toHaveLength(refusals)
      await sql.unsafe(`drop view featherbase.runtime_action_result;
        alter table featherbase.protected_receipts rename to runtime_action_result`)
      expect(await (await send('scopeproof@1.1.0', read + 'stores/access')).json()).toEqual({ storeCodes: ['A'] })
      expect(await (await send('scopeproof@1.1.0', read + 'stores', { payload: { storeCodes: ['A'] } })).json()).toEqual(original)
      expect(await (await send('scopeproof@1.1.0', action + 'product', receipt)).json()).toEqual(original)
      expect(module.calls).toEqual({ handler: 1, resolver: 0, authorizer: 1, upstream: 1 })
    } finally { await rm(target, { recursive: true, force: true }) }
  })

  test('read role may read A but direct mutation and client role tampering never invoke work', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser, ['Scope Reader'], ['A'])
    expect(await user.post(read + 'stores', { payload: { storeCodes: ['A'] } })).toEqual({ result: { stores: ['A'], marker: 37 } })
    const before = { ...module.calls }
    await expect(user.post(action + 'write', { idempotencyKey: 'fake', payload: { storeCodes: ['A'], role: 'Scope Planner', effect: 'no' } })).rejects.toMatchObject({ status: 403 })
    await expect(user.post(read + 'stores', { payload: { storeCodes: ['B'], roles: ['Administrator'], sql: 'all', filters: [] } })).rejects.toMatchObject({ status: 403 })
    expect(module.calls).toEqual(before)
    expect(await sql`select * from scopeproof.effect`).toEqual([])
  })

  test('whole set admits A and C+A but refuses A+B, empty, missing and malformed scopes', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser)
    for (const [effect, stores] of [['one', ['A']], ['two', ['C', 'A']]] as const)
      expect(await user.post(action + 'write', { idempotencyKey: effect, payload: { effect, storeCodes: stores } })).toEqual({ result: { stores: [...stores].sort(), marker: 37 } })
    const before = { ...module.calls }
    for (const storeCodes of [['A', 'B'], [], undefined, [''], [37], 'A'])
      await expect(user.post(action + 'write', { idempotencyKey: 'no', payload: { effect: 'no', storeCodes } })).rejects.toMatchObject({ status: 403 })
    await expect(admin.post(read + 'stores', { payload: { storeCodes: ['A'] } })).rejects.toMatchObject({ status: 403 })
    expect(module.calls).toEqual(before)
    expect(await sql`select value from scopeproof.effect order by row_id`).toEqual([{ value: 'A' }, { value: 'A,C' }])
  })

  test('discovery is self-only and runs no callback; removal changes the same session and old discovery grants nothing', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser, ['Scope Reader'], ['A'])
    expect(await user.get(read + 'product/access')).toEqual({ storeCodes: ['A'] })
    expect(module.calls).toEqual({ handler: 0, resolver: 0, authorizer: 0, upstream: 0 })
    await expect(user.get(read + 'object/access')).rejects.toMatchObject({ status: 403 })
    await expect(user.get(read + 'stores/access?user=Administrator')).rejects.toMatchObject({ status: 403 })
    await sql`delete from data_scope where "user" = ${user.user}`
    expect(await user.get(read + 'stores/access')).toEqual({ storeCodes: [] })
    await expect(user.post(read + 'stores', { payload: { storeCodes: ['A'] } })).rejects.toMatchObject({ status: 403 })
    await sql`delete from has_role where parent = ${user.user}`
    await expect(user.get(read + 'stores/access')).rejects.toMatchObject({ status: 403 })
    expect(module.calls).toEqual({ handler: 0, resolver: 0, authorizer: 0, upstream: 0 })
  })

  test('restart keeps fresh grants and disabled app/user refuse with no business work', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser)
    await discoverPackages([directory]); await loadInstalledApps()
    expect(await user.get(read + 'stores/access')).toEqual({ storeCodes: ['A', 'C'] })
    await admin.post('/api/set_app_enabled', { name: 'scopeproof', enabled: false })
    await expect(user.get(read + 'stores/access')).rejects.toMatchObject({ status: 403 })
    await admin.post('/api/set_app_enabled', { name: 'scopeproof', enabled: true })
    await sql`update "user" set enabled = false where row_id = ${user.user}`
    await expect(user.get(read + 'stores/access')).rejects.toMatchObject({ status: 401 })
    expect(module.calls.handler).toBe(0)
  })

  test('persisted A+B cannot be underclaimed as A; exact scope and parent identity precede work', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser, ['Scope Planner'], ['A'])
    await admin.post('/api/save_row', { table: 'scopeproof.object', row: { row_id: 'draft', stores: ['B', 'A'], secret: 'private' } })
    await admin.post('/api/save_row', { table: 'scopeproof.line', row: { row_id: 'line', parent_id: 'other' } })
    for (const payload of [{ id: 'draft', storeCodes: ['A'] }, { id: 'draft' }, { id: 'absent', storeCodes: ['A'] }])
      await expect(user.post(read + 'object', { payload })).rejects.toMatchObject({ status: 403 })
    expect(module.calls.handler).toBe(0)
    await admin.post('/api/save_row', { table: 'Data Scope', row: { user: user.user, allow_table: 'scopeproof.store', for_value: 'B' } })
    await expect(user.post(read + 'object', { payload: { id: 'draft', storeCodes: ['A'], mutateClaim: true } })).rejects.toMatchObject({ status: 403 })
    await expect(user.post(read + 'object', { payload: { id: 'draft', line: 'line', storeCodes: ['A', 'B'] } })).rejects.toMatchObject({ status: 403 })
    expect(module.calls.handler).toBe(0)
    expect(await user.post(read + 'object', { payload: { id: 'draft', storeCodes: ['B', 'A', 'A'], mutateClaim: true } })).toEqual({ result: { stores: ['A', 'B'], marker: 37 } })
    expect(await user.post(read + 'object', { payload: { id: 'draft' } })).toEqual({ result: { stores: ['A', 'B'], marker: 37 } })
    await expect(module.escapedFacts.get('scopeproof.object', 'draft')).rejects.toThrow('Application access refused')
  })

  test('deleted-source replay uses immutable original scope, never a narrowed retry', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser, ['Scope Planner'], ['A', 'B'])
    const draft = await admin.post<{ updated_at: string }>('/api/save_row', { table: 'scopeproof.object', row: { row_id: 'draft', stores: ['A', 'B'] } })
    const payload = { id: 'draft', updatedAt: draft.updated_at, storeCodes: ['B', 'A'] }
    const result = await user.post(action + 'discard', { idempotencyKey: 'receipt', payload })
    expect(result).toEqual({ result: { stores: ['A', 'B'], marker: 37 } })
    expect(await sql`select * from scopeproof.object where row_id = 'draft'`).toEqual([])
    const before = { ...module.calls }
    expect(await user.post(action + 'discard', { idempotencyKey: 'receipt', payload: { ...payload, storeCodes: ['A', 'B'] } })).toEqual(result)
    await sql`delete from data_scope where "user" = ${user.user} and for_value = 'B'`
    await expect(user.post(action + 'discard', { idempotencyKey: 'receipt', payload })).rejects.toMatchObject({ status: 403 })
    await expect(user.post(action + 'discard', { idempotencyKey: 'receipt', payload: { ...payload, storeCodes: ['A'] } })).rejects.toMatchObject({ status: 409 })
    expect(module.calls).toEqual(before)
  })

  test('exact pairs do not form a cross product and fresh product scope blocks replay', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser, ['Scope Planner'], ['A', 'B'])
    await admin.post('/api/save_row', { table: 'scopeproof.access', row: { row_id: user.user, pairs: [['A', 'X'], ['B', 'Y']] } })
    await expect(user.post(read + 'product', { payload: { storeCodes: ['A'], pairs: [['A', 'Y']] } })).rejects.toMatchObject({ status: 403 })
    expect(module.calls.handler).toBe(0)
    const request = { idempotencyKey: 'pair', payload: { storeCodes: ['A'], pairs: [['A', 'X']] } }
    expect(await user.post(action + 'product', request)).toEqual({ result: { stores: ['A'], marker: 37 } })
    await sql`update scopeproof.access set pairs = ${sql.json([['B', 'Y']])} where row_id = ${user.user}`
    await expect(user.post(action + 'product', request)).rejects.toMatchObject({ status: 403 })
    expect(module.calls.handler).toBe(1)
    expect(module.calls.upstream).toBe(1)
    expect(module.calls.resolver).toBe(2)
    expect(module.calls.authorizer).toBe(3)
  })

  test('revoked original scope and malformed metadata refuse before a SQL result projection can run', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser, ['Scope Planner'], ['A', 'B'])
    const draft = await admin.post<{ updated_at: string }>('/api/save_row', { table: 'scopeproof.object', row: { row_id: 'original', stores: ['A', 'B'] } })
    const request = { idempotencyKey: 'projection', payload: { id: 'original', updatedAt: draft.updated_at } }
    await user.post(action + 'discard', request)
    // This real PostgreSQL view permits metadata SELECTs, but result projection
    // raises. A mistaken SELECT payload,result before authorization returns 500.
    await sql.unsafe(`alter table featherbase.runtime_action_result rename to protected_receipts;
      create function pg_temp.forbidden_result(jsonb) returns jsonb language plpgsql stable as
      $$ begin raise exception 'Protected result was read'; end $$;
      create view featherbase.runtime_action_result as select caller, app, action, idempotency_key, payload,
        "authorization", pg_temp.forbidden_result(result) as result from featherbase.protected_receipts`)
    await expect(withTransaction(async () => { await sql`select result from runtime_action_result` })).rejects.toThrow('Protected result was read')
    await sql`delete from data_scope where "user" = ${user.user} and for_value = 'B'`
    await expect(user.post(action + 'discard', request)).rejects.toMatchObject({ status: 403 })
    await sql`update featherbase.protected_receipts set "authorization" = '{"version":99}'`
    await expect(user.post(action + 'discard', request)).rejects.toMatchObject({ status: 403 })
    expect(module.calls.handler).toBe(1)
    expect(module.calls.resolver).toBe(1)
  })
})
