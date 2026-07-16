import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'

// META-004 regression (evaluator pass #6): after a schema sync ALTERs a
// table, warm pooled connections used to 500 once each with PG 0A000
// ("cached plan must not change result type"). With prepare:false there is
// no statement cache to go stale — hammer the doc across sync cycles and
// every request must succeed.

const DT = 'Stale Plan DT'

async function cleanup() {
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_stale_plan_dt')
}

beforeAll(cleanup)
afterAll(cleanup)

describe('META-004: schema sync does not leave stale prepared statements', () => {
  it('reads and writes keep working across repeated column additions', async () => {
    const created = await areq('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({ name: DT, fields: [{ fieldname: 'a', fieldtype: 'Data' }] }),
    })
    expect(created.status).toBe(201)
    const doc = (await (
      await areq('/api/save_doc', {
        method: 'POST',
        body: JSON.stringify({ doctype: DT, doc: { a: 'one' } }),
      })
    ).json()) as { name: string; modified: string }

    const fields = [{ fieldname: 'a', fieldtype: 'Data' }]
    for (let round = 1; round <= 3; round++) {
      // Warm every pooled connection with reads/updates on this table.
      let modified = (await (
        await areq(`/api/resource/${encodeURIComponent(DT)}/${doc.name}`)
      ).json() as { modified: string }).modified
      for (let i = 0; i < 5; i++) {
        const upd = await areq(`/api/resource/${encodeURIComponent(DT)}/${doc.name}`, {
          method: 'PUT',
          body: JSON.stringify({ a: `warm-${round}-${i}`, modified }),
        })
        expect(upd.status).toBe(200)
        modified = ((await upd.json()) as { modified: string }).modified
      }

      // ALTER the table via schema sync…
      fields.push({ fieldname: `extra_${round}`, fieldtype: 'Data' })
      const sync = await areq(`/api/doctype/${encodeURIComponent(DT)}`, {
        method: 'PUT',
        body: JSON.stringify({ fields }),
      })
      expect(sync.status).toBe(200)

      // …then EVERY subsequent request must succeed (no per-connection 500).
      for (let i = 0; i < 10; i++) {
        const read = await areq(`/api/resource/${encodeURIComponent(DT)}/${doc.name}`)
        expect(read.status).toBe(200)
        const upd = await areq(`/api/resource/${encodeURIComponent(DT)}/${doc.name}`, {
          method: 'PUT',
          body: JSON.stringify({ a: `post-${round}-${i}`, modified }),
        })
        expect(upd.status).toBe(200)
        modified = ((await upd.json()) as { modified: string }).modified
      }
    }
  })
})
