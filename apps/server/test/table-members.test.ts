// #1298: a protected Table's member directory (tableMembers) read every enabled
// person and then asked each one's roles in turn, so Tasker's people list took
// 14–17 s on an instance with a few thousand people. It answers in a fixed number
// of queries, with exactly the members asking getRoles of each person gives.
import { resolve } from 'node:path'
import { describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { grantRole, makePerson, makeTable } from './fixtures'

const counter = vi.hoisted(() => ({ queries: 0 }))
vi.mock('../src/db', async (original) => {
  const db = await original<typeof import('../src/db')>()
  return { ...db, sql: new Proxy(db.sql, { apply(target, self, args) {
    if (Array.isArray(args[0]) && 'raw' in args[0]) counter.queries++ // a statement, not an sql(...) helper
    return Reflect.apply(target as never, self, args)
  } }) }
})

const { sql } = await import('../src/db')
const { getRoles } = await import('../src/permissions')
const { getMeta } = await import('../src/meta')
const { tableMembers, displayName } = await import('../src/people-directory')
const { discoverPackages } = await import('../src/runtime-packages')
const { suspendRuntimeApp } = await import('../src/apps')

/** The directory as it was answered before #1298: every enabled person, each one's roles asked in turn. */
async function membersOneByOne(table: string) {
  const policy = (await getMeta(table)).access_policy!
  const members: { row_id: string; full_name: string }[] = []
  for (const person of await sql`select row_id, full_name, username from person where enabled and replaced_by is null`) {
    const roles = await getRoles(String(person.row_id))
    if (policy.roles.some((role) => roles.includes(role))) members.push({ row_id: String(person.row_id), full_name: displayName(person) })
  }
  return members.sort((a, b) => a.full_name.localeCompare(b.full_name) || a.row_id.localeCompare(b.row_id))
}

let held = 0
async function holding(person: string, ...roles: string[]) {
  for (const role of roles)
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${`hr-1298-${++held}`}, ${person}, 'Person', 'roles', ${role})`
  return person
}

async function directory(admin: TestClient, name: string, roles: string[]) {
  const table = await makeTable(admin, { name, access_policy: { version: 1, roles }, columns: ['title'] })
  for (const role of roles) await grantRole(admin, { table: table.name, role, can_read: true })
  return table.name
}

describe('a protected Table\'s member directory', () => {
  test('answers in the same number of queries however many people there are', async ({ admin }) => {
    const table = await directory(admin, 'Tm Count Notes', ['Tm Count Member'])
    const viewer = await holding(await makePerson({ full_name: 'Tm Viewer' }), 'Tm Count Member')
    const queriesFor = async () => {
      await tableMembers(table, viewer) // the first call may also read metadata and check bindings
      counter.queries = 0
      await tableMembers(table, viewer)
      return counter.queries
    }
    for (let i = 0; i < 3; i++) await holding(await makePerson({ full_name: `Tm Few ${i}` }), 'Tm Count Member')
    const few = await queriesFor()
    for (let i = 0; i < 40; i++) await holding(await makePerson({ full_name: `Tm Many ${i}` }), ...(i % 2 ? ['Tm Count Member'] : []))
    expect(await queriesFor()).toBe(few)
  })

  test('lists exactly the people getRoles admits, one by one, in the same order', async ({ admin }) => {
    // A role held directly, through an app's role binding, through System Settings'
    // everyone roles, or not at all; disabled, merged-away, unnamed and same-named people;
    // and a service account, which is never a Person.
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Setup Staff' } })
    expect(await discoverPackages([resolve('../..', 'test-apps/fixtures/setup-proof-v1')])).toEqual([])
    await admin.post('/api/install_app', { name: 'setupproof' })
    const bound = await directory(admin, 'Tm Bound Notes', ['Setup Reader', 'Tm Direct'])
    const everyone = await directory(admin, 'Tm Everyone Notes', ['Tm Everyone'])
    const other = await directory(admin, 'Tm Other Notes', ['Tm Other'])
    await admin.post('/api/save_row', { table: 'System Settings', row: { everyone_roles: 'Tm Everyone' } })

    const viewer = await holding(await makePerson({ full_name: 'Tm Viewer' }), 'Tm Direct', 'Tm Other')
    const direct = await holding(await makePerson({ full_name: 'Asha Patel' }), 'Tm Direct')
    const sameName = await holding(await makePerson({ full_name: 'Asha Patel' }), 'Tm Direct')
    const throughBinding = await holding(await makePerson({ full_name: 'Ravi Shah' }), 'Setup Staff')
    const unnamed = await holding(await makePerson({ username: 'tm-unnamed' }), 'Tm Direct')
    const otherOnly = await holding(await makePerson({ full_name: 'Outside Person' }), 'Tm Other')
    await makePerson({ full_name: 'No Role Person' })
    const disabled = await holding(await makePerson({ full_name: 'Gone Person', enabled: false }), 'Tm Direct', 'Tm Other')
    const merged = await holding(await makePerson({ full_name: 'Merged Person' }), 'Tm Direct', 'Tm Other')
    await sql`update person set enabled = false, replaced_by = ${direct} where row_id = ${merged}`
    await sql`insert into service_account (row_id, label) values ('svc_tm1298aaaaaaaaaaaa', 'tm-bot')`
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values ('hr-1298-svc', 'svc_tm1298aaaaaaaaaaaa', 'Service Account', 'roles', 'Tm Direct')`

    for (const table of [bound, everyone, other]) expect(await tableMembers(table, viewer)).toEqual(await membersOneByOne(table))
    // What each comparison covered, so it is not of two empty or two everyone lists.
    const ids = async (table: string) => (await tableMembers(table, viewer)).map((m) => m.row_id)
    expect(await ids(bound)).toEqual(expect.arrayContaining([viewer, direct, sameName, throughBinding, unnamed]))
    expect(await ids(bound)).not.toEqual(expect.arrayContaining([otherOnly]))
    expect(await ids(other)).toEqual([otherOnly, viewer])
    expect(await ids(everyone)).toEqual(expect.arrayContaining([otherOnly, throughBinding]))
    for (const table of [bound, everyone, other]) expect(await ids(table)).not.toEqual(expect.arrayContaining([disabled]))
    for (const table of [bound, everyone, other]) expect(await ids(table)).not.toEqual(expect.arrayContaining([merged]))
    for (const table of [bound, everyone, other]) expect(await ids(table)).not.toContain('svc_tm1298aaaaaaaaaaaa')

    // A binding of an app that is not available holds nothing.
    suspendRuntimeApp('setupproof')
    expect(await ids(bound)).not.toContain(throughBinding)
    expect(await tableMembers(bound, viewer)).toEqual(await membersOneByOne(bound))
  })
})
