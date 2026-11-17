// #1266: a password manager filled the signed-in manager's own address into
// the StyleHR link field on someone else's Person page. Linking an address
// that already belongs to a different person is refused, and says whose it is.
import { expect } from 'vitest'
import { test } from './pg-test'
import { expectRefused, makePerson } from './fixtures'
import { configureDelegated, configureGoogle, inviteGoogleRaw } from './identity-fixtures'

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
