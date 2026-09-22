import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { sql, withTransaction } from '../src/db'
import { discoverPackages, runPackageAction, runPackageRead } from '../src/runtime-packages'
import { installApp, uninstallApp } from '../src/apps'
import { saveDoc, deleteDoc } from '../src/document'
import { app } from '../src/index'

void app
// Independent commits are essential: sandbox savepoints cannot prove a grant
// committed by another session becomes visible after an authorization lock wait.
const prove = process.env.APP_ACCESS_COMMIT_PROOF === '1' ? test : test.skip
const user = 'scope-race@example.test'
const outcome = (promise: Promise<unknown>) => promise.then(value => ({ value }), error => ({ error }))

// @spec authoritative_object_store_scope
// @spec declared_product_gate_composes
// @spec fresh_app_store_access
// @spec action_writes_and_replay_are_atomic
prove('scope locks, product locks and duplicate waits never retain pre-wait grants', async () => {
  const [identity] = await sql`select current_database() as name,
    (select value from internal_metadata where key = 'environment') as environment`
  expect(identity).toEqual({ name: 'featherbase_issue279_access_commit_e2e', environment: 'test' })
  expect(await sql`select name from installed_app where name = 'scopeproof'`).toHaveLength(0)
  expect(await discoverPackages([resolve('../..', 'runtime-apps/scope-proof')])).toEqual([])
  await installApp('scopeproof')
  await saveDoc('User', { row_id: user, email: user, enabled: true, roles: [{ role: 'Scope Planner' }] }, 'Administrator', 'insert')
  const grant = () => saveDoc('Data Scope', { user, allow_table: 'scopeproof.store', for_value: 'A' }, 'Administrator', 'insert')
  const revoke = () => sql`delete from data_scope where "user" = ${user}`
  try {
    await saveDoc('scopeproof.store', { row_id: 'A', label: 'A' }, 'Administrator', 'insert')
    await saveDoc('scopeproof.object', { row_id: 'draft', stores: ['A'] }, 'Administrator', 'insert')
    await saveDoc('scopeproof.access', { row_id: user, pairs: [['A', 'X']] }, 'Administrator', 'insert')
    await grant()
    const request = { idempotencyKey: 'original', payload: { storeCodes: ['A'], pairs: [['A', 'X']] } }
    await runPackageAction('scopeproof', 'product', request, user)
    for (const mode of ['object', 'product-first', 'product-replay', 'duplicate'] as const) {
      let unlock!: () => void
      let locked!: () => void
      const ready = new Promise<void>(resolve => { locked = resolve })
      const gate = new Promise<void>(resolve => { unlock = resolve })
      const holder = withTransaction(async () => {
        if (mode === 'object') {
          await sql`update scopeproof.object set stores = '["A","B"]' where row_id = 'draft'`
        } else if (mode === 'duplicate') {
          await sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([user, 'scopeproof', 'product', 'original'])}, 296))`
        } else await sql`select row_id from scopeproof.access where row_id = ${user} for update`
        locked(); await gate
      })
      let operation: ReturnType<typeof outcome> | undefined
      try {
        await ready
        operation = outcome(mode === 'object'
          ? runPackageRead('scopeproof', 'object', { payload: { id: 'draft', storeCodes: ['A'] } }, user)
          : runPackageAction('scopeproof', 'product', mode === 'product-first' ? { ...request, idempotencyKey: 'new' } : request, user))
        const wait = mode === 'duplicate' ? 'advisory' : 'transactionid'
        await expect.poll(async () => Number((await sql`select count(*) as n from pg_stat_activity
          where datname = current_database() and wait_event = ${wait}`)[0].n)).toBeGreaterThanOrEqual(1)
        if (mode !== 'object') await revoke()
        unlock(); await holder
        expect(await operation).toMatchObject({ error: { type: 'PermissionError', message: 'Application access refused' } })
        expect(await sql`select idempotency_key from runtime_action_result where app = 'scopeproof'`).toEqual([{ idempotency_key: 'original' }])
        if (mode !== 'object') await grant()
      } finally { unlock(); await Promise.allSettled([holder, operation]) }
    }
  } finally {
    await revoke()
    await sql`delete from runtime_action_result where app = 'scopeproof'`
    await deleteDoc('User', user, 'Administrator')
    await uninstallApp('scopeproof')
  }
}, 30_000)
