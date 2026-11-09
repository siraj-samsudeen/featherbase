// access-tokens' fenced scenarios that the server alone proves (#1070): renaming
// a token or a service account through the API, and what the credential then
// does. Each test is one fenced scenario of openspec/specs/access-tokens/spec.md,
// step by step; the scenarios a person reads in the token dialogs are in
// apps/web/test/scenarios/. The secret stays in the test, never in a step.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { expectRefused, expectStatus } from '../fixtures'

const scenario = scenarioFor(test, 'access-tokens')

type Account = { row_id: string; label: string }
type Token = { id: string; label: string; owner: string; expires_at: string | null; revoked_at: string | null }
type Identity = { row_id: string; full_name: string; roles: string[] }

const patch = (client: TestClient, path: string, body: unknown) =>
  client.fetch(path, { method: 'PATCH', body: JSON.stringify(body) })

/** A service account with one working token: its secret and the token as listed. */
async function accountWithToken(admin: TestClient, api: TestClient, name: string, label: string) {
  const account = await admin.post<Account>('/api/service_accounts', { label: name, roles: [] })
  const { token: secret, ...token } = await admin.post<Token & { token: string }>('/api/access_tokens', { owner: account.row_id, label })
  const identity = await whoami(api, secret)
  return { account, secret, token: token as Token, identity }
}

async function whoami(api: TestClient, secret: string): Promise<Identity> {
  const res = await api.fetch('/api/whoami', { headers: { authorization: `Bearer ${secret}` } })
  await expectStatus(res, 200)
  return (await res.json()) as Identity
}

const tokens = async (admin: TestClient) => (await admin.get<{ tokens: Token[] }>('/api/access_tokens')).tokens
const accounts = async (admin: TestClient) => (await admin.get<{ service_accounts: Account[] }>('/api/service_accounts')).service_accounts

function expectNoSecret(value: unknown, secret: string) {
  expect(Object.hasOwn(value as object, 'token'), 'no secret returned after issuance').toBe(false)
  expect(Object.hasOwn(value as object, 'secret')).toBe(false)
  expect(Object.hasOwn(value as object, 'token_hash')).toBe(false)
  expect(JSON.stringify(value).includes(secret), 'credential must not be disclosed').toBe(false)
}

/** The refused rename changed nothing: same name, same token, same identity behind the secret. */
async function expectTokenUnchanged(admin: TestClient, api: TestClient, given: Awaited<ReturnType<typeof accountWithToken>>, name: string) {
  const token = (await tokens(admin)).find((t) => t.id === given.token.id)!
  expect(token.label).toBe(name)
  for (const key of ['id', 'owner', 'expires_at', 'revoked_at'] as const) expect(token[key]).toBe(given.token[key])
  expect((await whoami(api, given.secret)).row_id).toBe(given.identity.row_id)
}

describe('access-tokens', () => {
  scenario('A blank token name cannot replace a useful one', async ({ admin, api }, step) => {
    let given!: Awaited<ReturnType<typeof accountWithToken>>
    let refused!: Response
    await step('the service account "warehouse-import-agent" has a working token named "nightly export"', async () => {
      given = await accountWithToken(admin, api, 'warehouse-import-agent', 'nightly export')
    })
    await step('a System Manager tries to rename the token to a blank name', async () => {
      refused = await patch(admin, `/api/access_tokens/${given.token.id}`, { label: '   ' })
      await expectRefused(refused, 417)
    })
    await step('the rename is refused and the token is still named "nightly export"', async () => {
      expect(refused.ok).toBe(false)
      await expectTokenUnchanged(admin, api, given, 'nightly export')
    })
  })

  scenario('A renamed automation credential still works', async ({ admin, api }, step) => {
    let given!: Awaited<ReturnType<typeof accountWithToken>>
    await step('the service account "warehouse-import-agent" has a working token named "nightly export"', async () => {
      given = await accountWithToken(admin, api, 'warehouse-import-agent', 'nightly export')
    })
    await step('a System Manager renames it to "warehouse-reader" and the token to "morning export"', async () => {
      await expectStatus(await patch(admin, `/api/service_accounts/${given.account.row_id}`, { label: 'warehouse-reader' }), 200)
      const renamed = await patch(admin, `/api/access_tokens/${given.token.id}`, { label: 'morning export' })
      await expectStatus(renamed, 200)
      expectNoSecret(await renamed.json(), given.secret)
    })
    await step('the same credential authenticates as the same account named "warehouse-reader"', async () => {
      const identity = await whoami(api, given.secret)
      expect(identity.row_id).toBe(given.identity.row_id)
      expect(identity.row_id).toBe(given.account.row_id)
      expect(identity.full_name).toBe('warehouse-reader')
      expect(identity.roles).toEqual(given.identity.roles)
    })
    await step('the token is listed as "morning export" without its secret', async () => {
      const listed = await tokens(admin)
      expectNoSecret(listed, given.secret)
      const token = listed.find((t) => t.id === given.token.id)!
      expect(token.label).toBe('morning export')
      for (const key of ['id', 'owner', 'expires_at', 'revoked_at'] as const) expect(token[key]).toBe(given.token[key])
      for (const row of listed) expectNoSecret(row, given.secret)
    })
  })

  scenario("Another person's token cannot be renamed", async ({ admin, api, createUser }, step) => {
    let given!: Awaited<ReturnType<typeof accountWithToken>>
    let refused!: Response
    await step('the service account "warehouse-import-agent" has a working token named "nightly export"', async () => {
      given = await accountWithToken(admin, api, 'warehouse-import-agent', 'nightly export')
    })
    await step('an ordinary user tries to rename that token to "morning export"', async () => {
      const ordinary = await createUser({ roles: [] })
      refused = await patch(ordinary, `/api/access_tokens/${given.token.id}`, { label: 'morning export' })
      await expectRefused(refused, 403)
    })
    await step('the rename is refused and the token is still named "nightly export"', async () => {
      expect(refused.ok).toBe(false)
      await expectTokenUnchanged(admin, api, given, 'nightly export')
    })
  })

  scenario('A taken service-account name cannot be claimed', async ({ admin }, step) => {
    const made = new Map<string, Account>()
    let refused!: Response
    await step('the service accounts "warehouse-import-agent" and "warehouse-reader" exist', async () => {
      for (const label of ['warehouse-import-agent', 'warehouse-reader'])
        made.set(label, await admin.post<Account>('/api/service_accounts', { label, roles: [] }))
    })
    await step('a System Manager renames "warehouse-import-agent" to "warehouse-reader"', async () => {
      refused = await patch(admin, `/api/service_accounts/${made.get('warehouse-import-agent')!.row_id}`, { label: 'warehouse-reader' })
      await expectRefused(refused, 409)
    })
    await step('the rename is refused and both accounts keep their names', async () => {
      expect(refused.ok).toBe(false)
      const rows = await accounts(admin)
      for (const [name, account] of made) expect(rows.find((a) => a.row_id === account.row_id)?.label).toBe(name)
    })
  })
})
