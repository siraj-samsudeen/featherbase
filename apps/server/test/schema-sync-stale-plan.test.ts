import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'

// META-004 regression (evaluator pass #6): after a schema sync ALTERs a
// table, warm pooled connections used to 500 once each with PG 0A000
// ("cached plan must not change result type"). With prepare:false there is
// no statement cache to go stale — hammer the doc across sync cycles and
// every request must succeed.
//
// KEPT LEGACY (not migrated to the pg-test sandbox): the scenario depends on
// MULTIPLE warm pooled connections each holding their own cached plan; the
// sandbox pins every query to ONE connection inside one transaction, which
// makes the regression unreproducible and the test a no-op there.

const DT = 'Stale Plan DT'

async function cleanup() {
  await sql`delete from column_def where parent = ${DT}`
  await sql`delete from table_def where name = ${DT}`
  await sql.unsafe('drop table if exists stale_plan_dt')
}

beforeAll(cleanup)
afterAll(cleanup)

describe('META-004: schema sync does not leave stale prepared statements', () => {
  it('reads and writes keep working across repeated column additions', async () => {
    const created = await areq('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({ name: DT, columns: [{ column_name: 'a', column_type: 'Data' }] }),
    })
    expect(created.status).toBe(201)
    const doc = (await (
      await areq('/api/save_doc', {
        method: 'POST',
        body: JSON.stringify({ doctype: DT, doc: { a: 'one' } }),
      })
    ).json()) as { name: string; updated_at: string }

    const columns = [{ column_name: 'a', column_type: 'Data' }]
    for (let round = 1; round <= 3; round++) {
      // Warm every pooled connection with reads/updates on this table.
      let updated_at = (await (
        await areq(`/api/table/${encodeURIComponent(DT)}/${doc.name}`)
      ).json() as { updated_at: string }).updated_at
      for (let i = 0; i < 5; i++) {
        const upd = await areq(`/api/table/${encodeURIComponent(DT)}/${doc.name}`, {
          method: 'PATCH',
          body: JSON.stringify({ a: `warm-${round}-${i}`, updated_at }),
        })
        expect(upd.status).toBe(200)
        updated_at = ((await upd.json()) as { updated_at: string }).updated_at
      }

      // ALTER the table via schema sync…
      columns.push({ column_name: `extra_${round}`, column_type: 'Data' })
      const sync = await areq(`/api/doctype/${encodeURIComponent(DT)}`, {
        method: 'PUT',
        body: JSON.stringify({ columns }),
      })
      expect(sync.status).toBe(200)

      // …then EVERY subsequent request must succeed (no per-connection 500).
      for (let i = 0; i < 10; i++) {
        const read = await areq(`/api/table/${encodeURIComponent(DT)}/${doc.name}`)
        expect(read.status).toBe(200)
        const upd = await areq(`/api/table/${encodeURIComponent(DT)}/${doc.name}`, {
          method: 'PATCH',
          body: JSON.stringify({ a: `post-${round}-${i}`, updated_at }),
        })
        expect(upd.status).toBe(200)
        updated_at = ((await upd.json()) as { updated_at: string }).updated_at
      }
    }
  })
})
