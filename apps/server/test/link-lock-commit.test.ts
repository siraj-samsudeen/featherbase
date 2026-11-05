import { describe, expect, test } from 'vitest'
import { sql } from '../src/db'
import { deleteDoc, saveDoc } from '../src/document'
import { createTable, deleteTable, tableRelation } from '../src/table-engine'
import { registerController, unregisterController, type TableController } from '../src/controllers'

// #947, across real commits. A save that links to a row holds that row until
// it commits, so a delete running at the same moment waits and then sees the
// link, instead of removing the row and leaving the link pointing at nothing.
// An ordinary save of the linked row does not wait. A sandbox can't show this
// (one connection never waits on itself), so this proof commits. Opt in only
// on a disposable database (vitest.config.ts refuses any other name):
//   LINK_LOCK_COMMIT_PROOF=1 DATABASE_URL=postgres://...:5432/featherbase_<worker>_links_commit_e2e \
//     FEATHERBASE_ENV=test pnpm --filter server exec vitest run test/link-lock-commit.test.ts
const prove = process.env.LINK_LOCK_COMMIT_PROOF === '1' ? test : test.skip

const CUSTOMER = 'Link Lock Customer'
const ORDER = 'Link Lock Order'

/** A save of an Order linking `customer`, held open after its links are
 *  checked until `release` is called. */
function heldOrderSave(customer: string) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let reached!: () => void
  const checked = new Promise<void>((resolve) => { reached = resolve })
  const hold: TableController = {
    table: ORDER,
    hooks: { after_insert: async () => { reached(); await gate } },
  }
  registerController(hold)
  const saving = saveDoc(ORDER, { title: 'first order', customer })
  saving.catch(() => {})
  return {
    checked,
    release: () => { release(); unregisterController(hold) },
    saving,
  }
}

/** Sessions waiting on a row lock held by another transaction. */
async function waitingOnRow(): Promise<number> {
  const [row] = await sql`select count(*)::int as n from pg_stat_activity
    where datname = current_database() and wait_event_type = 'Lock' and wait_event in ('transactionid', 'tuple')
      and query ilike '%for update%'`
  return row.n
}

describe('a save holds the rows it links to until it commits (#947)', () => {
  prove('this is a disposable test database', async () => {
    const [identity] = await sql`select current_database() as name,
      (select value from internal_metadata where key = 'environment') as environment`
    expect(String(identity.name)).toMatch(/^featherbase_[a-z0-9_]+_links_commit_e2e$/)
    expect(identity.environment).toBe('test')
  })

  prove('a delete racing a save that links to the row waits, then refuses', async () => {
    // A run stopped part-way leaves its Tables behind.
    await sql`delete from ${sql(await tableRelation(ORDER))}`.catch(() => {})
    await deleteTable(ORDER).catch(() => {})
    await deleteTable(CUSTOMER).catch(() => {})
    await createTable({ name: CUSTOMER, id_pattern: 'prompt', columns: [{ column_name: 'city', column_type: 'Data' }] })
    await createTable({
      name: ORDER,
      columns: [
        { column_name: 'title', column_type: 'Data' },
        { column_name: 'customer', column_type: 'Reference', reference_table: CUSTOMER },
      ],
    })
    try {
      await saveDoc(CUSTOMER, { row_id: 'Acme', city: 'Palakkad' })
      const globex = await saveDoc(CUSTOMER, { row_id: 'Globex', city: 'Palakkad' })

      // An ordinary save of a linked row goes straight through.
      const first = heldOrderSave('Globex')
      try {
        await first.checked
        const edit = saveDoc(CUSTOMER, { row_id: 'Globex', city: 'Kochi', updated_at: globex.updated_at })
        const outcome = await Promise.race([edit.then(() => 'saved'), new Promise((r) => setTimeout(() => r('waiting'), 3000))])
        expect(outcome).toBe('saved')
      } finally {
        first.release()
        await Promise.allSettled([first.saving])
      }
      await first.saving

      // A delete waits for the save to commit, then sees its link.
      const second = heldOrderSave('Acme')
      let removing: Promise<unknown> = Promise.resolve()
      try {
        await second.checked
        removing = deleteDoc(CUSTOMER, 'Acme')
        removing.catch(() => {})
        await expect.poll(waitingOnRow, { timeout: 5000 }).toBe(1)
        second.release()
        await second.saving
        await expect(removing).rejects.toThrow(/linked from/)
      } finally {
        second.release()
        await Promise.allSettled([second.saving, removing])
      }
      const [acme] = await sql`select row_id from ${sql(await tableRelation(CUSTOMER))} where row_id = 'Acme'`
      expect(acme?.row_id).toBe('Acme')
    } finally {
      await sql`delete from ${sql(await tableRelation(ORDER))}`.catch(() => {})
      await deleteTable(ORDER).catch(() => {})
      await deleteTable(CUSTOMER).catch(() => {})
    }
  }, 30_000)
})
