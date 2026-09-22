import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { discoverPackages, availableRuntimeVersions } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { sql, withTransaction } from '../src/db'
import { actionDeclaration, readDeclaration, validateOperationFacts } from '../src/app-access'

const directory = resolve('../..', 'runtime-apps/scope-proof')
const read = '/api/app_reads/scopeproof/'
const action = '/api/app_actions/scopeproof/'
async function setup(admin: TestClient, createUser: CreateUserFn, roles = ['Scope Planner'], stores = ['A', 'C']) {
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'scopeproof' })
  const user = await createUser({ email: 'scoped@example.test', roles })
  for (const code of ['A', 'B', 'C']) await admin.post('/api/save_row', { table: 'scopeproof.store', row: { row_id: code, label: `${code} private label` } })
  for (const code of stores) await admin.post('/api/save_row', { table: 'Data Scope', row: { user: user.user, allow_table: 'scopeproof.store', for_value: code } })
  const digest = availableRuntimeVersions().find(p => p.name === 'scopeproof')!.digest
  const module = await import(`${pathToFileURL(resolve(directory, 'server.mjs')).href}?artifact=${digest}`)
  Object.assign(module.calls, { handler: 0, resolver: 0, authorizer: 0, upstream: 0 })
  return { user, module }
}

describe('fresh app roles and store access', () => {
  // @spec declared_app_actions_fail_closed
  // @spec self_store_access_discovery
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

  // @spec declared_product_gate_composes.missing_declared_product_callback
  // @spec explicit_runtime_policy_upgrade.policy_restart_is_fail_closed
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

  // @spec explicit_runtime_policy_upgrade
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
    const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'tasker', version: '2.1.0' })
    await admin.post('/api/upgrade_app', { name: 'tasker', version: '2.1.0', planId: plan.planId })
    expect((await invoke('2.1.0')).status).toBe(403)
    await admin.post('/api/activate_app_upgrade', { name: 'tasker', version: '2.1.0' })
    expect((await invoke('2.0.0')).status).toBe(409)
    const replay = await invoke('2.1.0')
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({ result: { project: 'original-37' } })
    expect(await discoverPackages([current, historical])).toEqual([])
    await loadInstalledApps()
    expect((await invoke('2.1.0')).status).toBe(200)
  })

  // @spec app_refusals_are_auditable
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

  // @spec fresh_app_store_access
  // @spec runtime_reads_have_no_mutations
  test('read role may read A but direct mutation and client role tampering never invoke work', async ({ admin, createUser }) => {
    const { user, module } = await setup(admin, createUser, ['Scope Reader'], ['A'])
    expect(await user.post(read + 'stores', { payload: { storeCodes: ['A'] } })).toEqual({ result: { stores: ['A'], marker: 37 } })
    const before = { ...module.calls }
    await expect(user.post(action + 'write', { idempotencyKey: 'fake', payload: { storeCodes: ['A'], role: 'Scope Planner', effect: 'no' } })).rejects.toMatchObject({ status: 403 })
    await expect(user.post(read + 'stores', { payload: { storeCodes: ['B'], roles: ['Administrator'], sql: 'all', filters: [] } })).rejects.toMatchObject({ status: 403 })
    expect(module.calls).toEqual(before)
    expect(await sql`select * from scopeproof.effect`).toEqual([])
  })

  // @spec fresh_app_store_access.entire_requested_set_is_checked
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

  // @spec self_store_access_discovery
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

  // @spec fresh_app_store_access.session_survives_assignment_removal
  // @spec runtime_reads_have_no_mutations.independent_read_install_restart_disable
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

  // @spec authoritative_object_store_scope
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

  // @spec action_writes_and_replay_are_atomic
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

  // @spec declared_product_gate_composes
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

  // @spec action_writes_and_replay_are_atomic
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
