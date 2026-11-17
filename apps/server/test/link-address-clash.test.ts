// #1266: a password manager filled the signed-in manager's own address into
// the StyleHR link field on someone else's Person page. Linking an address
// that already belongs to a different person is refused, and says whose it is.
import { expect } from 'vitest'
import { test } from './pg-test'
import { expectRefused, makePerson } from './fixtures'
import { sql } from '../src/db'
import { getIdentity } from '../src/identities'
import { configureDelegated, configureGoogle, inviteGoogleRaw } from './identity-fixtures'

const patch = (as: { fetch: (url: string, init: RequestInit) => Promise<Response> }, id: string, body: unknown) =>
  as.fetch(`/api/identities/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function people() {
  const manager = await makePerson({ full_name: 'Meena Manager', email: 'meena@jeyarama.test' })
  const staff = await makePerson({ full_name: 'Mohammad Staff', email: 'mohammad@jeyarama.test' })
  return { manager, staff }
}

test("another person's address is refused as a StyleHR login, and the refusal names them", async ({ admin }) => {
  await configureDelegated()
  const { staff } = await people()
  const res = await admin.fetch(`/api/people/${staff}/identities`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'stylehr', subject: 'E9001', sign_in_name: 'Meena@Jeyarama.test' }),
  })
  expect(res.status).toBe(409)
  const body = await res.json() as { error: { message: string } }
  expect(body.error.message).toContain('Meena Manager')
  expect(body.error.message).not.toMatch(/psn_/)
})

test("an address another person holds under another sign-in method is theirs too", async ({ admin }) => {
  await configureDelegated()
  await configureGoogle()
  const { manager, staff } = await people()
  await inviteGoogleRaw(manager, 'boss@jeyarama.test')
  await expectRefused(admin.post(`/api/people/${staff}/identities`, { method: 'stylehr', subject: 'E9002', sign_in_name: 'boss@jeyarama.test' }), 409)
})

test("another person's address is refused as a Google invite", async ({ admin }) => {
  await configureGoogle()
  const { staff } = await people()
  await expectRefused(admin.post(`/api/people/${staff}/identities`, { method: 'google', email: 'meena@jeyarama.test', send_invitation_email: false }), 409)
})

test("a person's own address and a plain login id still link", async ({ admin }) => {
  await configureDelegated()
  await configureGoogle()
  const { staff } = await people()
  await admin.post(`/api/people/${staff}/identities`, { method: 'stylehr', subject: 'E9003', sign_in_name: 'mohammad@jeyarama.test' })
  await admin.post(`/api/people/${staff}/identities`, { method: 'google', email: 'mohammad@jeyarama.test', send_invitation_email: false })
  const other = await makePerson({ full_name: 'Plain Login' })
  await admin.post(`/api/people/${other}/identities`, { method: 'stylehr', subject: 'E9004', sign_in_name: 'plainlogin' })
})

// Codex review: a claimed identity's email is covered by no unique index.
test("an address held only in another person's live Google sign-in is theirs", async ({ admin }) => {
  await configureGoogle()
  const { manager, staff } = await people()
  await sql`insert into sign_in_identity ${sql({ id: 'uid_1266claimed', person_id: manager, method: 'google', subject: 'g-1266', email: 'meena.google@jeyarama.test', linked_by: 'test' })}`
  await expectRefused(admin.post(`/api/people/${staff}/identities`, { method: 'google', email: 'Meena.Google@jeyarama.test', send_invitation_email: false }), 409)
})

// Codex review: a rename or a move goes through the same guard.
test("renaming a login to another person's address is refused and changes nothing", async ({ admin }) => {
  await configureDelegated()
  const { staff } = await people()
  const link = await admin.post<{ id: string }>(`/api/people/${staff}/identities`, { method: 'stylehr', subject: 'E9010', sign_in_name: 'plain.login' })
  expect((await patch(admin, link.id, { sign_in_name: 'meena@jeyarama.test' })).status).toBe(409)
  expect((await getIdentity(link.id)).sign_in_name).toBe('plain.login')
})

test("moving a person's own invite to someone else is refused and leaves it with them", async ({ admin }) => {
  await configureGoogle()
  const { manager, staff } = await people()
  const invite = await admin.post<{ id: string }>(`/api/people/${manager}/identities`, { method: 'google', email: 'meena@jeyarama.test', send_invitation_email: false })
  expect((await patch(admin, invite.id, { person_id: staff })).status).toBe(409)
  expect((await getIdentity(invite.id)).person_id).toBe(manager)
})
