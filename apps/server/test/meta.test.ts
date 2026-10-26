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
      `/api/table/${encodeURIComponent(DT)}:meta`,
    )
    expect(body.name).toBe(DT)
    expect(body.columns).toHaveLength(2)
  })

  test('404s for an unknown Table with the error envelope', async ({ admin }) => {
    await expect(admin.get('/api/table/Nope:meta')).rejects.toMatchObject({
      status: 404,
      type: 'NotFoundError',
    })
  })
})

// #473 (Codex bot review): a column can carry a one-line description, kept in
// its metadata, which every form shows under the control. The generic form
// renders it; no Table needs frontend code for it.
describe('a column description', () => {
  test('is stored with the column, served in the meta, and kept when an update leaves it out', async ({ admin }) => {
    const { createTable, updateTable } = await import('../src/table-engine')
    await createTable({
      name: 'Described Note',
      columns: [
        { column_name: 'title', column_type: 'Data' },
        { column_name: 'urgent', column_type: 'Check', description: 'Ticked notes go to the top of everyone’s list.' },
      ],
    })
    const meta = (await admin.get('/api/table/Described%20Note:meta')) as { columns: { column_name: string; description: string | null }[] }
    expect(meta.columns.find((c) => c.column_name === 'urgent')?.description).toBe('Ticked notes go to the top of everyone’s list.')
    expect(meta.columns.find((c) => c.column_name === 'title')?.description).toBeNull()
    await updateTable('Described Note', {
      columns: [
        { column_name: 'title', column_type: 'Data', label: 'Heading' },
        { column_name: 'urgent', column_type: 'Check' },
      ],
    })
    expect((await getMeta('Described Note')).columns.find((c) => c.column_name === 'urgent')?.description).toBe('Ticked notes go to the top of everyone’s list.')
  })

  test('the Person column that lets a first Google sign-in link carries its explanation', async () => {
    const column = (await getMeta('Person')).columns.find((c) => c.column_name === 'expects_google_sign_in')
    expect(column?.description).toBe('They can sign in with Google using this email the first time; after that the link is permanent.')
  })
})
