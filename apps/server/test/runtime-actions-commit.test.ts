import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { sql } from '../src/db'
import { discoverPackages, runPackageAction } from '../src/runtime-packages'
import { installApp, uninstallApp } from '../src/apps'
import { saveDoc } from '../src/document'
import { createTable, deleteTable } from '../src/table-engine'
import { registerController, unregisterController, type TableController } from '../src/controllers'
import { app } from '../src/index'

// This proof must COMMIT on independent connections. It is deliberately not a
// sandbox test; opt in only on a worker-owned, directly local disposable DB.
// Run: RUNTIME_ACTION_COMMIT_PROOF=1 DATABASE_URL=..._actions_commit_e2e
//      FEATHERBASE_ENV=test pnpm --filter server exec vitest run test/runtime-actions-commit.test.ts
void app
const prove = process.env.RUNTIME_ACTION_COMMIT_PROOF === '1' ? test : test.skip

// @spec guarded_action_deletion_preserves_retained_work.action_delete_races_comment_or_reference_creation
// @spec action_commit_boundary_and_lifecycle_serialize
// @spec core_document_links_serialize_with_runtime_deletion.core_link_creation_races_runtime_deletion
prove('real commits: both sides of core-link/reference deletion races; effects observe durable results', async () => {
  const [identity] = await sql`select current_database() as name,
    (select value from internal_metadata where key = 'environment') as environment`
  expect(String(identity.name).endsWith('_actions_commit_e2e')).toBe(true)
  expect(identity.environment).toBe('test')
  expect(await sql`select name from installed_app where name = 'actionproof'`).toHaveLength(0)
  expect(await discoverPackages([resolve('../..', 'runtime-apps/action-proof')])).toEqual([])
  await installApp('actionproof')
  await createTable({ name: 'ActionProof Ref', columns: [{ column_name: 'source', column_type: 'Reference', reference_table: 'actionproof.work' }] })
  const controllers: TableController[] = []
  const add = (controller: TableController) => { controllers.push(controller); registerController(controller) }
  const clear = () => { for (const controller of controllers.splice(0)) unregisterController(controller) }
  const stamp = (row: Record<string, unknown>) => new Date(row.updated_at as string).toISOString()
  try {
    for (const first of ['delete', 'writers'] as const) {
      const source = await saveDoc('actionproof.work', { row_id: first, title: first === 'delete' ? '19 deletable units' : '43 retained units' }, 'Administrator', 'insert')
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      let entered = 0
      if (first === 'delete') add({ table: 'actionproof.work', hooks: { on_trash: async () => { entered++; await gate } } })
      else {
        for (const table of ['Comment', 'ActionProof Ref', 'File', 'Share']) add({ table, hooks: { after_insert: async () => { entered++; await gate } } })
      }
      const discard = () => runPackageAction('actionproof', 'discard', {
        idempotencyKey: first, payload: { source: first, updatedAt: stamp(source) },
      }, 'Administrator')
      const writers = () => [
        saveDoc('Comment', { ref_table: 'actionproof.work', ref_name: first, content: 'Retain this exact discussion' }, 'Administrator', 'insert'),
        saveDoc('ActionProof Ref', { source: first }, 'Administrator', 'insert'),
        saveDoc('File', { ref_table: 'actionproof.work', ref_name: first, file_name: 'invoice-83.txt' }, 'Administrator', 'insert'),
        saveDoc('Share', { share_table: 'actionproof.work', share_name: first, user: 'Administrator', read: true }, 'Administrator', 'insert'),
      ].map(promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error })))
      let deletion: Promise<any> | undefined
      let writing: Promise<any>[] = []
      try {
        if (first === 'delete') {
          deletion = discard().then(value => ({ ok: true, value }), error => ({ ok: false, error }))
          await expect.poll(() => entered).toBe(1)
          writing = writers()
          await expect.poll(async () => Number((await sql`select count(*) as n from pg_stat_activity where datname = current_database() and wait_event = 'transactionid'`)[0].n)).toBeGreaterThanOrEqual(4)
        } else {
          writing = writers()
          await expect.poll(() => entered).toBe(4)
          deletion = discard().then(value => ({ ok: true, value }), error => ({ ok: false, error }))
          await expect.poll(async () => Number((await sql`select count(*) as n from pg_stat_activity where datname = current_database() and wait_event = 'transactionid'`)[0].n)).toBeGreaterThanOrEqual(1)
        }
        release()
        const deleted = await deletion
        const written = await Promise.all(writing)
        if (first === 'delete') {
          expect(deleted).toMatchObject({ ok: true, value: { result: { deleted: true } } })
          expect(written).toMatchObject([{ ok: false, error: { type: 'NotFoundError' } }, { ok: false, error: { type: 'ValidationError' } },
            { ok: false, error: { type: 'NotFoundError' } }, { ok: false, error: { type: 'NotFoundError' } }])
          expect(await sql`select row_id from comment where ref_table = 'actionproof.work' and ref_name = ${first}`).toHaveLength(0)
          expect(await sql`select row_id from actionproof_ref where source = ${first}`).toHaveLength(0)
          expect(await sql`select row_id from file where ref_table = 'actionproof.work' and ref_name = ${first}`).toHaveLength(0)
          expect(await sql`select row_id from share where share_table = 'actionproof.work' and share_name = ${first}`).toHaveLength(0)
        } else {
          expect(written).toMatchObject([{ ok: true }, { ok: true }, { ok: true }, { ok: true }])
          expect(deleted).toMatchObject({ ok: false, error: { type: 'ValidationError', fields: { comments: '1', versions: '0', references: '1', files: '1', shares: '1' } } })
          expect(await sql`select title from actionproof.work where row_id = ${first}`).toEqual([{ title: '43 retained units' }])
        }
      } finally { release(); await Promise.allSettled([deletion, ...writing]); clear() }
    }

    const source = await saveDoc('actionproof.work', { row_id: 'effect', title: 'Durable 71 units' }, 'Administrator', 'insert')
    let effectObservedCommit = false
    add({ table: 'actionproof.destination', hooks: { after_commit: async () => {
      // The exported sql is no longer inside the action transaction. This
      // independent connection must see both rows and the durable result.
      const [count] = await sql`select count(*)::int as n from runtime_action_result where idempotency_key = 'committed-effect'`
      effectObservedCommit = count.n === 1
      throw new Error('Expected external effect failure after commit')
    } } })
    const request = { idempotencyKey: 'committed-effect', payload: { source: 'effect', updatedAt: stamp(source) } }
    const result = await runPackageAction('actionproof', 'transform', request, 'Administrator')
    expect(effectObservedCommit).toBe(true)
    expect(await runPackageAction('actionproof', 'transform', request, 'Administrator')).toEqual(result)
    expect(await sql`select title from actionproof.destination`).toEqual([{ title: 'Durable 71 units / destination' }])
  } finally {
    clear()
    await sql`delete from comment where ref_table = 'actionproof.work'`
    await sql`delete from version where ref_table = 'actionproof.work'`
    await sql`delete from file where ref_table = 'actionproof.work'`
    await sql`delete from share where share_table = 'actionproof.work'`
    await sql`delete from runtime_action_result where app = 'actionproof'`
    await deleteTable('ActionProof Ref')
    await uninstallApp('actionproof')
  }
}, 30_000)
