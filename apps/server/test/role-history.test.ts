// #830: granting or removing a role is an access change an auditor must see.
// A Person's roles are Has Role rows saved with the Person, so each grant or
// removal is recorded in that Person's history: who did it, when, and the
// roles before and after.
import { expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { expectStatus } from './fixtures'

type Changed = [string, unknown, unknown][]

async function roles(names: string[]) {
  for (const r of names) {
    const [have] = await sql`select 1 from role where row_id = ${r}`
    if (!have) await saveDoc('Role', { row_id: r }, 'Administrator', 'insert')
  }
}

async function history(person: string) {
  const rows = await sql`select created_by, data from version where ref_table = 'Person' and ref_name = ${person} order by created_at, row_id`
  return rows.map((r) => ({ by: String(r.created_by), changed: (r.data as { changed: Changed }).changed }))
}

async function person(admin: TestClient, values: Record<string, unknown>) {
  return admin.post<{ row_id: string; updated_at: string; roles: { row_id: string; role: string }[] }>('/api/save_row', { table: 'Person', row: { enabled: true, ...values } })
}

test('#830: a role granted to an existing Person is recorded in their history, by whom', async ({ admin }) => {
  await roles(['Rh Auditor', 'Rh Clerk'])
  const p = await person(admin, { email: 'rh.grant@example.com', full_name: 'Rh Grant', roles: [{ role: 'Rh Clerk' }] })
  await admin.post('/api/save_row', {
    table: 'Person',
    row: { row_id: p.row_id, updated_at: p.updated_at, roles: [...p.roles, { role: 'Rh Auditor' }] },
  })
  const last = (await history(p.row_id)).at(-1)!
  expect(last.by).toBe('Administrator')
  expect(last.changed).toEqual([['roles', 'Rh Clerk', 'Rh Clerk, Rh Auditor']])
})

test('#830: a role removed from a Person is recorded too, down to no roles at all', async ({ admin }) => {
  await roles(['Rh Auditor', 'Rh Clerk'])
  const p = await person(admin, { email: 'rh.remove@example.com', full_name: 'Rh Remove', roles: [{ role: 'Rh Clerk' }, { role: 'Rh Auditor' }] })
  const once = await admin.post<typeof p>('/api/save_row', {
    table: 'Person',
    row: { row_id: p.row_id, updated_at: p.updated_at, roles: p.roles.filter((r) => r.role === 'Rh Clerk') },
  })
  await admin.post('/api/save_row', { table: 'Person', row: { row_id: p.row_id, updated_at: once.updated_at, roles: [] } })
  const changes = (await history(p.row_id)).map((h) => h.changed)
  expect(changes.slice(-2)).toEqual([
    [['roles', 'Rh Clerk, Rh Auditor', 'Rh Clerk']],
    [['roles', 'Rh Clerk', null]],
  ])
})

// #897: the roles a Person is created with are a grant like any other, so
// creation records them, by whom. A Person created without roles records
// nothing. (#321: a Person with history is disabled, not deleted.)
test('#897: creating a Person with roles records the grant in their history, by whom', async ({ admin }) => {
  await roles(['Rh Clerk', 'Rh Auditor'])
  const granted = await person(admin, { email: 'rh.new@example.com', full_name: 'Rh New', roles: [{ role: 'Rh Clerk' }, { role: 'Rh Auditor' }] })
  expect(await history(granted.row_id)).toEqual([{ by: 'Administrator', changed: [['roles', null, 'Rh Clerk, Rh Auditor']] }])
  const activity = await admin.get<{ versions: { data: Record<string, unknown> }[] }>(`/api/activity/Person/${encodeURIComponent(granted.row_id)}`)
  expect(activity.versions.map((v) => v.data)).toEqual([{ created: true, changed: [['roles', null, 'Rh Clerk, Rh Auditor']] }])
})

test('#830: creating a Person without roles records no history entry', async ({ admin }) => {
  const plain = await person(admin, { email: 'rh.plain@example.com', full_name: 'Rh Plain' })
  expect(await history(plain.row_id)).toEqual([])
})

test('#830: re-saving the same roles, or editing only other fields, records no role change', async ({ admin }) => {
  await roles(['Rh Clerk'])
  const p = await person(admin, { email: 'rh.same@example.com', full_name: 'Rh Same', roles: [{ role: 'Rh Clerk' }] })
  const again = await admin.post<typeof p>('/api/save_row', { table: 'Person', row: { row_id: p.row_id, updated_at: p.updated_at, roles: p.roles } })
  await admin.post('/api/save_row', { table: 'Person', row: { row_id: p.row_id, updated_at: again.updated_at, full_name: 'Rh Same Renamed' } })
  const changes = (await history(p.row_id)).map((h) => h.changed)
  expect(changes).toEqual([[['roles', null, 'Rh Clerk']], [['full_name', 'Rh Same', 'Rh Same Renamed']]])
})

// #897: the creation entry alone does not keep a Person from being deleted (a
// delete grant removes a person with their roles); it goes with them. A later
// change is history like any other and still refuses the delete (#321).
// (That deletion is the scenario "A person with only their creation entry can still
// be deleted" in permissions-and-roles.)

test('#897: a Person changed after creation keeps their history and is not deleted', async ({ admin }) => {
  await roles(['Rh Clerk', 'Rh Auditor'])
  const p = await person(admin, { email: 'rh.staying@example.com', full_name: 'Rh Staying', roles: [{ role: 'Rh Clerk' }] })
  await admin.post('/api/save_row', { table: 'Person', row: { row_id: p.row_id, updated_at: p.updated_at, roles: [...p.roles, { role: 'Rh Auditor' }] } })
  const refused = await admin.fetch(`/api/table/Person/${encodeURIComponent(p.row_id)}`, { method: 'DELETE' })
  await expectStatus(refused, 417)
  expect(await refused.text()).toContain('cannot be deleted: it has 1 history entry')
  expect(await history(p.row_id)).toHaveLength(2)
})
