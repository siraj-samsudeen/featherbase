import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'

// UI-017: document tags add/list/remove, gated by document read permission.

const DT = 'Tag Srv DT'

async function cleanup() {
  await sql`delete from tag_link where ref_doctype = ${DT}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_tag_srv_dt')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: DT, autoname: 'prompt', fields: [{ fieldname: 'title', fieldtype: 'Data' }] }),
  })
  await areq(`/api/resource/${encodeURIComponent(DT)}`, {
    method: 'POST',
    body: JSON.stringify({ name: 't1', title: 'x' }),
  })
})

afterAll(cleanup)

describe('UI-017: tags', () => {
  it('adds, lists, and removes tags', async () => {
    for (const tag of ['urgent', 'finance']) {
      const res = await areq('/api/tags', { method: 'POST', body: JSON.stringify({ doctype: DT, name: 't1', tag }) })
      expect(res.status).toBe(201)
    }
    const listed = (await (await areq(`/api/tags/${encodeURIComponent(DT)}/t1`)).json()) as { tags: string[] }
    expect(listed.tags).toEqual(['finance', 'urgent']) // sorted

    // Duplicate is a no-op, not an error.
    const dup = await areq('/api/tags', { method: 'POST', body: JSON.stringify({ doctype: DT, name: 't1', tag: 'urgent' }) })
    expect(dup.status).toBe(201)
    const after = (await (await areq(`/api/tags/${encodeURIComponent(DT)}/t1`)).json()) as { tags: string[] }
    expect(after.tags).toHaveLength(2)

    const del = await areq(`/api/tags/${encodeURIComponent(DT)}/t1/urgent`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    const final = (await (await areq(`/api/tags/${encodeURIComponent(DT)}/t1`)).json()) as { tags: string[] }
    expect(final.tags).toEqual(['finance'])
  })

  it('rejects tagging a document that does not exist (404)', async () => {
    const res = await areq('/api/tags', { method: 'POST', body: JSON.stringify({ doctype: DT, name: 'ghost', tag: 'x' }) })
    expect(res.status).toBe(404)
  })

  it('requires a non-empty tag', async () => {
    const res = await areq('/api/tags', { method: 'POST', body: JSON.stringify({ doctype: DT, name: 't1', tag: '  ' }) })
    expect(res.status).toBe(417)
  })
})
