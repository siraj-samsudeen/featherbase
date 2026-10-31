import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { expectApiError, makeTable, tableRef } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'

// #738 (list-columns-from-the-table, Decision 3): which columns a Table's list
// shows for everyone is each column's in_list_view flag in the Table's
// definition, saved through PUT /api/table_def/:name. That save deletes the
// in_list_view Metadata Override of each column whose flag it changes, so an
// override can't make the "In list" tick do nothing.
//
// A column's flag "changes" when the flag sent differs from the stored
// definition's, or from what the column showed (the definition with its
// override laid over it). The Edit columns page sends back the merged meta,
// so the second half is how unticking a column that only an override put in
// the list takes it out.

const DT = 'List Default Zones'
const T = tableRef(DT)

interface Column {
  column_name: string
  in_list_view?: boolean
  label?: string
  reqd?: boolean
}
interface Meta {
  name: string
  columns: Column[]
}

async function setup(admin: TestClient) {
  await makeTable(admin, {
    name: DT,
    columns: [
      { column_name: 'section', column_type: 'Data', in_list_view: true },
      { column_name: 'floor', column_type: 'Data', in_list_view: false },
      { column_name: 'remarks', column_type: 'Data', in_list_view: false },
    ],
  })
  await admin.post('/api/save_row', { table: DT, row: { section: 'A', floor: 'G', remarks: 'ok' } })

}

async function override(admin: TestClient, column: string, property: string, value: string) {
  await admin.post('/api/save_row', {
    table: 'Metadata Override',
    row: { row_id: `${DT}-${column}-${property}`, table_name: DT, column_name: column, property, value },
  })
}

async function overrides(): Promise<string[]> {
  const rows = await sql<{ column_name: string; property: string }[]>`
    select column_name, property from metadata_override where table_name = ${DT}
    order by column_name, property`
  return rows.map((r) => `${r.column_name}.${r.property}`)
}

const inList = (meta: Meta, column: string) =>
  Boolean(meta.columns.find((c) => c.column_name === column)?.in_list_view)

/** What the Edit columns page does: read the merged meta, change one column, PUT it all back. */
async function saveColumn(client: TestClient, admin: TestClient, column: string, change: Partial<Column>) {
  const t = T
  const meta = await admin.get<Meta>(t.metaUrl)
  return client.put<Meta>(t.defUrl, {
    ...meta,
    columns: meta.columns.map((c) => (c.column_name === column ? { ...c, ...change } : c)),
  })
}

describe('#738: a save that changes a column\'s list flag clears its override', () => {
  test('ticking a column an override keeps out of the list puts it in', async ({ admin }) => {
    await setup(admin)
    await override(admin, 'remarks', 'in_list_view', '0')
    const after = await saveColumn(admin, admin, 'remarks', { in_list_view: true })
    expect(inList(after, 'remarks')).toBe(true)
  })

  test('unticking a column only an override put in the list takes it out', async ({ admin }) => {
    await setup(admin)
    await override(admin, 'floor', 'in_list_view', '1')
    const after = await saveColumn(admin, admin, 'floor', { in_list_view: false })
    expect(inList(after, 'floor')).toBe(false)
  })

  test("sending an override's value back unchanged folds it into the definition", async ({ admin }) => {
    await setup(admin)
    await override(admin, 'floor', 'in_list_view', '1')
    // Another column's label changes; floor goes back as the merged meta showed it.
    const after = await saveColumn(admin, admin, 'section', { label: 'Sec' })
    expect(inList(after, 'floor')).toBe(true)
    expect(await overrides()).toEqual([])
  })

  test('a column whose flag the save leaves as it was keeps its override', async ({ admin }) => {
    await setup(admin)
    await override(admin, 'section', 'in_list_view', '1')
    await saveColumn(admin, admin, 'remarks', { in_list_view: true })
    expect(await overrides()).toEqual(['section.in_list_view'])
  })

  test("a changed column's other overrides stay", async ({ admin }) => {
    await setup(admin)
    await override(admin, 'remarks', 'reqd', '1')
    await saveColumn(admin, admin, 'remarks', { in_list_view: true })
    expect(await overrides()).toEqual(['remarks.reqd'])
  })
})

describe('#738: only a System Manager changes the list for everyone', () => {
  test("a non-System-Manager's save of a list flag is refused", async ({ admin, createUser }) => {
    await setup(admin)
    const user = await createUser({ roles: [] })
    await expectApiError(saveColumn(user, admin, 'remarks', { in_list_view: true }), { status: 403 })
    expect(inList(await admin.get<Meta>(T.metaUrl), 'remarks')).toBe(false)
  })
})
