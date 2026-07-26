import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'

const DT = 'Meta Test Note'

// Setup runs at the start of each test that needs it — the sandbox rolls the
// rows back after every test, so there is no shared state and no cleanup.
async function makeDT() {
  await sql`insert into table_def (name, module, id_pattern) values (${DT}, 'Core', 'hash')`
  await sql`insert into column_def (parent, position, column_name, label, column_type, reqd) values
    (${DT}, 1, 'title', 'Title', 'Data', true),
    (${DT}, 2, 'content', 'Content', 'Text', false)`
}

describe('META-001: table/column storage and Meta loader', () => {
  test('loads a Table definition inserted as rows into a Meta object', async () => {
    await makeDT()
    const meta = await getMeta(DT)
    expect(meta.name).toBe(DT)
    expect(meta.kind).toBe('table')
    expect(meta.columns).toHaveLength(2)
    expect(meta.columns[0]).toMatchObject({
      column_name: 'title',
      column_type: 'Data',
      reqd: true,
      position: 1,
    })
    expect(meta.columns[1].column_name).toBe('content')
  })

  test('serves meta over HTTP', async ({ admin }) => {
    await makeDT()
    const body = await admin.get<{ name: string; columns: unknown[] }>(
      `/api/meta/${encodeURIComponent(DT)}`,
    )
    expect(body.name).toBe(DT)
    expect(body.columns).toHaveLength(2)
  })

  test('404s for an unknown Table with the error envelope', async ({ admin }) => {
    await expect(admin.get('/api/meta/Nope')).rejects.toMatchObject({
      status: 404,
      type: 'NotFoundError',
    })
  })
})
