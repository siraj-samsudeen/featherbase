// #923: an instance can give roles to everyone who signs in, from one System
// Settings field, without adding them to each Person. Taking a role out of the
// setting takes it from everyone who held it only that way.
import { expect } from 'vitest'
import { test } from './pg-test'
import { grantRole, makeTable } from './fixtures'
import { managedScope } from '../src/instance-settings'
import { getRoles } from '../src/permissions'
import type { TestClient } from 'feather-testing-postgres'

const NOTES = 'Er Notes'
const MEMBER = 'Er Member'
const notes = `/api/table/${encodeURIComponent(NOTES)}`
const setEveryone = (client: TestClient, roles: string | null) =>
  client.post('/api/save_row', { table: 'System Settings', row: { everyone_roles: roles } })
const settings = (client: TestClient) => client.get<{ everyone_roles: string | null }>('/api/table/System%20Settings/System%20Settings')

async function setup(admin: TestClient) {
  await makeTable(admin, { name: NOTES, columns: ['note'] })
  await grantRole(admin, { role: MEMBER, table: NOTES, can_read: true })
}

test('everyone who signs in holds the roles the setting names, and loses them when it stops', async ({ admin, createUser }) => {
  await setup(admin)
  const newcomer = await createUser({})
  const member = await createUser({ roles: [MEMBER] })
  expect((await newcomer.fetch(notes)).status).toBe(403)

  await setEveryone(admin, MEMBER)
  expect((await newcomer.fetch(notes)).status).toBe(200)
  // Someone who signs in for the first time later holds it too.
  const later = await createUser({})
  expect((await later.fetch(notes)).status).toBe(200)

  // A service account is not a person who signs in.
  await grantRole(admin, { role: 'Er Robot', table: NOTES, can_read: true })
  const robot = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-er-robot', roles: ['Er Robot'] })
  expect(await getRoles(robot.row_id)).not.toContain(MEMBER)
  expect(await getRoles(String(newcomer.user))).toContain(MEMBER)

  await setEveryone(admin, null)
  expect((await newcomer.fetch(notes)).status).toBe(403)
  // A role given to the person directly stays.
  expect((await member.fetch(notes)).status).toBe(200)
})

test('the setting holds existing roles, one per line, and never a platform role', async ({ admin }) => {
  await setup(admin)
  await setEveryone(admin, `  ${MEMBER} \n\n${MEMBER}\n`)
  expect((await settings(admin)).everyone_roles).toBe(MEMBER)
  await expect(setEveryone(admin, 'Er Nobody'))
    .rejects.toMatchObject({ status: 417, fields: { everyone_roles: 'There is no role Er Nobody' } })
  await expect(setEveryone(admin, `${MEMBER}\nSystem Manager`))
    .rejects.toMatchObject({ status: 417, fields: { everyone_roles: 'System Manager cannot be given to everyone' } })
  expect((await settings(admin)).everyone_roles).toBe(MEMBER)
})

test('only a System Manager changes it, though others may edit the rest of System Settings', async ({ admin, createUser }) => {
  await setup(admin)
  await grantRole(admin, { role: 'Er Settings Editor', table: 'System Settings', can_read: true, can_write: true })
  const editor = await createUser({ roles: ['Er Settings Editor'] })
  await editor.post('/api/save_row', { table: 'System Settings', row: { app_name: 'Er Instance' } })
  await expect(setEveryone(editor, MEMBER)).rejects.toMatchObject({ status: 403 })
  // Saving the form back with the setting unchanged is not a change to it.
  await setEveryone(admin, MEMBER)
  await editor.post('/api/save_row', { table: 'System Settings', row: { app_name: 'Er Instance 2', everyone_roles: MEMBER } })
})

test("a person's access page says which roles come from the setting", async ({ admin, createUser }) => {
  await setup(admin)
  const person = await createUser({})
  await setEveryone(admin, MEMBER)
  const page = await admin.get<{ roles: { role: string; everyone: boolean }[] }>(`/api/access_explanation/${encodeURIComponent(person.user!)}`)
  expect(page.roles).toContainEqual(expect.objectContaining({ role: MEMBER, everyone: true, given_by: null }))
  // Given directly as well, it reads as given, once.
  const member = await createUser({ roles: [MEMBER] })
  const own = await admin.get<{ roles: { role: string; everyone: boolean }[] }>(`/api/access_explanation/${encodeURIComponent(member.user!)}`)
  expect(own.roles.filter((r) => r.role === MEMBER)).toEqual([expect.objectContaining({ everyone: false, given_by: 'Administrator' })])
})

test('a settings file never carries the roles everyone holds', async () => {
  const scope = await managedScope()
  expect(scope.find((entry) => entry.table === 'System Settings')?.fields).not.toContain('everyone_roles')
})
