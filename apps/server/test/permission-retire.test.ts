import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'

// #1060: a Permission row is a grant, and retiring never changes who may see
// what (row-retirement spec). So a grant is not retired: it ends by unticking
// it in the permission matrix (#1034), and every refusal says so.
const DT = 'Retire Grant Doc'
const ROLE = 'Retire Grant Role'
const list = `/api/table/${encodeURIComponent(DT)}`

async function grantWithHistory(admin: TestClient) {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  const read = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: ROLE, operation: 'read', scope_mode: 'all' } })
  for (const scope_mode of ['creator', 'all']) {
    const row = await admin.get<Record<string, unknown>>(`/api/table/Permission/${read.row_id}`)
    await admin.post('/api/save_row', { table: 'Permission', row: { ...row, scope_mode } })
  }
  return read.row_id
}

describe('#1060: a grant is ended in the matrix, not retired', () => {
  test('retiring a Permission is refused, names the matrix, and changes nothing', async ({ admin, createUser }) => {
    const id = await grantWithHistory(admin)
    const holder = await createUser({ roles: [ROLE] })
    const refused = await admin.fetch(`/api/table/Permission/${id}:retire`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'No longer needed' }),
    })
    expect(refused.status).toBe(417)
    expect(await refused.text()).toContain('untick it in the permission matrix')
    expect(await sql`select retired_at from permission where row_id = ${id}`).toEqual([{ retired_at: null }])
    expect((await holder.fetch(list)).status).toBe(200)
  })

  test('a Permission row does not offer Retire', async ({ admin }) => {
    const id = await grantWithHistory(admin)
    expect(await admin.get<{ retire: boolean; reactivate: boolean }>(`/api/table/Permission/${id}:capabilities`)).toMatchObject({ retire: false, reactivate: false })
  })

  test('a refused delete of a grant points at the matrix, not at retiring', async ({ admin }) => {
    const id = await grantWithHistory(admin)
    const refused = await admin.fetch(`/api/table/Permission/${id}`, { method: 'DELETE' })
    expect(refused.status).toBe(417)
    const body = await refused.text()
    expect(body).toContain('history entries')
    expect(body).toContain('untick it in the permission matrix')
    expect(body).not.toContain('Retire it instead')
    expect(body).not.toContain('"retire"')
  })
})
