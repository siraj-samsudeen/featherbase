import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'

const DT = 'Meta Test Note'

// Setup runs at the start of each test that needs it — the sandbox rolls the
// rows back after every test, so there is no shared state and no cleanup.
async function makeDT() {
  await sql`insert into tab_doctype (name, module, autoname) values (${DT}, 'Core', 'hash')`
  await sql`insert into tab_docfield (parent, idx, fieldname, label, fieldtype, reqd) values
    (${DT}, 1, 'title', 'Title', 'Data', true),
    (${DT}, 2, 'content', 'Content', 'Text', false)`
}

describe('META-001: doctype/docfield storage and Meta loader', () => {
  test('loads a DocType definition inserted as rows into a Meta object', async () => {
    await makeDT()
    const meta = await getMeta(DT)
    expect(meta.name).toBe(DT)
    expect(meta.istable).toBe(false)
    expect(meta.fields).toHaveLength(2)
    expect(meta.fields[0]).toMatchObject({
      fieldname: 'title',
      fieldtype: 'Data',
      reqd: true,
      idx: 1,
    })
    expect(meta.fields[1].fieldname).toBe('content')
  })

  test('serves meta over HTTP', async ({ admin }) => {
    await makeDT()
    const body = await admin.get<{ name: string; fields: unknown[] }>(
      `/api/meta/${encodeURIComponent(DT)}`,
    )
    expect(body.name).toBe(DT)
    expect(body.fields).toHaveLength(2)
  })

  test('404s for an unknown DocType with the error envelope', async ({ admin }) => {
    await expect(admin.get('/api/meta/Nope')).rejects.toMatchObject({
      status: 404,
      type: 'NotFoundError',
    })
  })
})
