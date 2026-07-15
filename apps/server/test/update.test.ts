import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { app } from '../src/index'

const DT = 'Upd Test Note'
const TABLE = 'tab_upd_test_note'

async function post(body: unknown) {
  return app.request('/api/save_doc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  await sql`delete from doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await app.request('/api/doctype', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: DT,
      fields: [{ fieldname: 'title', fieldtype: 'Data' }],
    }),
  })
})

afterAll(async () => {
  await sql`delete from doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await sql.end()
})

describe('DOC-002 + META-005: update with conflict detection, standard fields auto-set', () => {
  it('updates with a fresh modified value and bumps modified/modified_by', async () => {
    const created = (await (
      await post({ doctype: DT, doc: { title: 'v1' } })
    ).json()) as Record<string, unknown>

    const res = await post({
      doctype: DT,
      doc: { name: created.name, modified: created.modified, title: 'v2' },
    })
    expect(res.status).toBe(201)
    const updated = (await res.json()) as Record<string, unknown>
    expect(updated.title).toBe('v2')
    expect(new Date(String(updated.modified)).getTime()).toBeGreaterThan(
      new Date(String(created.modified)).getTime(),
    )
    expect(updated.owner).toBe('Administrator')
    expect(updated.creation).toEqual(created.creation)
  })

  it('rejects a stale modified value with 409', async () => {
    const created = (await (
      await post({ doctype: DT, doc: { title: 'a' } })
    ).json()) as Record<string, unknown>

    // First save wins
    const ok = await post({
      doctype: DT,
      doc: { name: created.name, modified: created.modified, title: 'b' },
    })
    expect(ok.status).toBe(201)

    // Second save with the ORIGINAL (now stale) timestamp loses
    const stale = await post({
      doctype: DT,
      doc: { name: created.name, modified: created.modified, title: 'c' },
    })
    expect(stale.status).toBe(409)
    const body = await stale.json()
    expect(body.error.type).toBe('ConflictError')
    const [row] = await sql.unsafe(
      `select title from ${TABLE} where name = '${created.name}'`,
    )
    expect(row.title).toBe('b')
  })

  it('rejects an update without a modified timestamp', async () => {
    const created = (await (
      await post({ doctype: DT, doc: { title: 'x' } })
    ).json()) as Record<string, unknown>
    const res = await post({
      doctype: DT,
      doc: { name: created.name, title: 'y' },
    })
    expect(res.status).toBe(417)
  })

  it('404s when updating a nonexistent name', async () => {
    const res = await post({
      doctype: DT,
      doc: { name: 'ghost', modified: new Date().toISOString(), title: 'z' },
    })
    expect(res.status).toBe(404)
  })
})
