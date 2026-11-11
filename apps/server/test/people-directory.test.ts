import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { personByEmail, pickPeople, principalNames } from '../src/people-directory'
import { expectRefused, grantRole, makePerson, makeTable } from './fixtures'

// What the people directory tells a viewer about other people: names and
// addresses only as far as the viewer may read Person.
describe('the people directory', () => {
  test('naming nobody answers with no names', async () => {
    expect(await principalNames([], 'Administrator')).toEqual({})
  })

  test('a viewer who may read names but not addresses finds nobody by address', async ({ admin, createUser }) => {
    await makePerson({ email: 'findable@example.com', full_name: 'Findable' })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Name Reader' } })
    const [fullName] = await sql`select row_id from column_def where parent = 'Person' and column_name = 'full_name'`
    await admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: 'Person', role: 'Name Reader', operation: 'read', scope_mode: 'all', column_rule: 'listed',
      columns: [{ target_column: fullName.row_id }],
    } })
    const reader = await createUser({ roles: ['Name Reader'] })
    expect(await personByEmail('findable@example.com', reader.user!)).toBeNull()
  })

  test('the person picker names someone with no name, username, address or code as (no name)', async () => {
    const nobody = await makePerson({})
    expect((await pickPeople('', 'Administrator', 50)).find((p) => p.row_id === nobody)).toEqual({ row_id: nobody, label: '(no name)' })
  })

  test('two members with the same name are listed in a steady order, by their ids', async ({ admin, createUser }) => {
    const table = await makeTable(admin, { name: 'Twin Notes', access_policy: { version: 1, roles: ['Twin Member'] }, columns: ['title'] })
    await grantRole(admin, { table: table.name, role: 'Twin Member', can_read: true })
    const one = await createUser({ roles: ['Twin Member'], fullName: 'Asha Patel' })
    const two = await createUser({ roles: ['Twin Member'], fullName: 'Asha Patel' })
    const { data } = await one.get<{ data: { row_id: string }[] }>(`/api/table_members/${encodeURIComponent(table.name)}`)
    expect(data.map((m) => m.row_id)).toEqual([one.user!, two.user!].sort())
  })

  test('a Table with no mandatory access has no member directory', async ({ admin }) => {
    await expectRefused(admin.get('/api/table_members/ToDo'), 403, 'This Table has no member directory')
  })
})
