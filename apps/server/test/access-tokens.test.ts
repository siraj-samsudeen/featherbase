import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { setUserPassword } from '../src/auth'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'

// #131: named access tokens (the API-005 replacement) + service accounts.
// A token is a show-once fbt_ Bearer secret that authenticates as its owner;
// service accounts are their own principals (person-rename R2) that can only
// ever authenticate by token.

const EMAIL = 'token-user@x.com'
// The person's minted id, set by makeUser for the running test.
let USER = ''

// The login flow itself is under test here, so the user is created in-test
// (with a real password) rather than through the createUser fixture.
async function makeUser(admin: TestClient) {
  const created = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Person',
    row: { email: EMAIL },
  })
  USER = created.row_id
  await setUserPassword(USER, 'tokenpw123')
}

async function userJwt(api: TestClient): Promise<string> {
  const login = await api.fetch('/api/login', {
    method: 'POST',
    body: JSON.stringify({ usr: EMAIL, pwd: 'tokenpw123' }),
  })
  expect(login.status).toBe(200)
  return ((await login.json()) as { token: string }).token
}

describe('#131: access tokens', () => {
  test('issued token authenticates as its owner; revoked token stops working', async ({
    admin,
    api,
  }) => {
    await makeUser(admin)
    const jwt = await userJwt(api)
    const issued = await api.fetch('/api/access_tokens', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ label: 'my script' }),
    })
    expect(issued.status).toBe(201)
    const tok = (await issued.json()) as { token: string; id: string; owner: string }
    expect(tok.token).toMatch(/^fbt_[A-Za-z0-9_-]{43}$/)
    expect(tok.owner).toBe(USER)

    const who = await api.fetch('/api/whoami', {
      headers: { authorization: `Bearer ${tok.token}` },
    })
    expect(who.status).toBe(200)
    expect(((await who.json()) as { row_id: string }).row_id).toBe(USER)

    // Use stamps last_used_at.
    const [row] = await sql`select last_used_at from access_token where id = ${tok.id}`
    expect(row.last_used_at).not.toBeNull()

    // A mangled token fails.
    const bad = await api.fetch('/api/whoami', {
      headers: { authorization: `Bearer fbt_${'0'.repeat(43)}` },
    })
    expect(bad.status).toBe(401)

    // Revocation (owner revokes their own) kills it.
    const rev = await api.fetch(`/api/access_tokens/${tok.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${jwt}` },
    })
    expect(rev.status).toBe(200)
    const after = await api.fetch('/api/whoami', {
      headers: { authorization: `Bearer ${tok.token}` },
    })
    expect(after.status).toBe(401)
  })

  test('an expired token is refused; expiry must be in the future', async ({ admin, api }) => {
    await makeUser(admin)
    const jwt = await userJwt(api)
    const past = await api.fetch('/api/access_tokens', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ label: 'stale', expires_at: '2000-01-01T00:00:00Z' }),
    })
    expect(past.status).toBe(417)

    const issued = await api.fetch('/api/access_tokens', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ label: 'short-lived', expires_at: new Date(Date.now() + 60_000).toISOString() }),
    })
    const tok = (await issued.json()) as { token: string; id: string }
    // Age it past its expiry directly — the clock is not test-controllable.
    await sql`update access_token set expires_at = now() - interval '1 minute' where id = ${tok.id}`
    const who = await api.fetch('/api/whoami', {
      headers: { authorization: `Bearer ${tok.token}` },
    })
    expect(who.status).toBe(401)
  })

  test("secrets are never retrievable after creation; listing shows metadata only", async ({
    admin,
    api,
  }) => {
    await makeUser(admin)
    const jwt = await userJwt(api)
    await api.fetch('/api/access_tokens', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ label: 'mine' }),
    })
    const list = await api.fetch('/api/access_tokens', {
      headers: { authorization: `Bearer ${jwt}` },
    })
    expect(list.status).toBe(200)
    const { tokens } = (await list.json()) as { tokens: Record<string, unknown>[] }
    expect(tokens).toHaveLength(1)
    expect(tokens[0].label).toBe('mine')
    expect(tokens[0]).not.toHaveProperty('token')
    expect(tokens[0]).not.toHaveProperty('token_hash')
  })

  test("only System Managers can manage another principal's tokens or see all", async ({
    admin,
    api,
  }) => {
    await makeUser(admin)
    const jwt = await userJwt(api)
    // Non-SM issuing for someone else: refused.
    const cross = await api.fetch('/api/access_tokens', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ label: 'sneaky', owner: 'Administrator' }),
    })
    expect(cross.status).toBe(403)

    // Admin issues one for the user, and one for themselves.
    const forUser = await admin.post<{ id: string }>('/api/access_tokens', {
      label: 'admin-issued',
      owner: USER,
    })
    await admin.post('/api/access_tokens', { label: 'admin-own' })

    // The user sees only their own; the admin sees every token.
    const mine = (await (
      await api.fetch('/api/access_tokens', { headers: { authorization: `Bearer ${jwt}` } })
    ).json()) as { tokens: { owner: string }[] }
    expect(mine.tokens.every((t) => t.owner === USER)).toBe(true)
    // The dev database may hold tokens from outside this test — assert the
    // admin's view is a superset spanning both owners, not an exact set.
    const all = await admin.get<{ tokens: { owner: string }[] }>('/api/access_tokens')
    const owners = new Set(all.tokens.map((t) => t.owner))
    expect(owners.has(USER)).toBe(true)
    expect(owners.has('Administrator')).toBe(true)

    // Non-SM revoking someone else's token: refused; SM revoking theirs: fine.
    const adminTokens = all.tokens as { id: string; owner: string }[]
    const adminOwn = adminTokens.find((t) => t.owner === 'Administrator')!
    const crossRevoke = await api.fetch(`/api/access_tokens/${adminOwn.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${jwt}` },
    })
    expect(crossRevoke.status).toBe(403)
    await admin.delete(`/api/access_tokens/${forUser.id}`)
  })
})

describe('#131: service accounts', () => {
  test('SM creates a service account with roles; it works by token and only by token', async ({
    admin,
    api,
  }) => {
    const created = await admin.post<{ row_id: string; label: string; roles: string[]; enabled: boolean }>(
      '/api/service_accounts',
      { label: 'svc-test-bot', roles: ['System Manager'] },
    )
    // person-rename R1/R2: its own kind of principal with a minted svc_ id.
    expect(created.row_id).toMatch(/^svc_[a-z2-7]{20}$/)
    expect(created.label).toBe('svc-test-bot')
    expect(created.roles).toContain('System Manager')
    const id = created.row_id

    // No password login, ever — even after someone tries to set one.
    for (const usr of ['svc-test-bot', id]) {
      const login = await api.fetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ usr, pwd: 'anything' }),
      })
      expect(login.status).toBe(401)
    }
    await expect(
      admin.post('/api/set_password', { user: id, password: 'sneaky123' }),
    ).rejects.toMatchObject({ status: 417 })

    // Its token carries its roles: an SM-gated endpoint answers.
    const issued = await admin.post<{ token: string; owner: string; owner_kind: string }>('/api/access_tokens', {
      label: 'bot token',
      owner: id,
    })
    expect(issued).toMatchObject({ owner: id, owner_kind: 'service_account' })
    const gated = await api.fetch('/api/service_accounts', {
      headers: { authorization: `Bearer ${issued.token}` },
    })
    expect(gated.status).toBe(200)
    const who = (await (await api.fetch('/api/whoami', { headers: { authorization: `Bearer ${issued.token}` } })).json()) as {
      row_id: string
      kind: string
    }
    expect(who).toMatchObject({ row_id: id, kind: 'service_account' })

    // Disabling the account dead-ends the token without revoking it.
    await admin.fetch(`/api/service_accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    })
    const dead = await api.fetch('/api/whoami', {
      headers: { authorization: `Bearer ${issued.token}` },
    })
    expect(dead.status).toBe(401)

    // Re-enabling brings it back — the token was disabled, not destroyed.
    await admin.fetch(`/api/service_accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true }),
    })
    const alive = await api.fetch('/api/whoami', {
      headers: { authorization: `Bearer ${issued.token}` },
    })
    expect(alive.status).toBe(200)
  })

  test('service-account management is System Manager only; names are slugs', async ({
    admin,
    api,
    createUser,
  }) => {
    const plain = await createUser({ email: 'plain-user@x.com' })
    await expect(
      plain.post('/api/service_accounts', { label: 'svc-nope' }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(plain.get('/api/service_accounts')).rejects.toMatchObject({ status: 403 })

    await expect(
      admin.post('/api/service_accounts', { label: 'Not A Slug!' }),
    ).rejects.toMatchObject({ status: 417 })

    // A name already used by another service account cannot be claimed,
    // even by case. (Its id is minted, so it can no longer shadow a person's
    // id — person-rename R1.)
    await admin.post('/api/service_accounts', { label: 'svc-taken' })
    await expect(
      admin.post('/api/service_accounts', { label: 'SVC-TAKEN' }),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.post('/api/service_accounts', { label: 'svc-taken' }),
    ).rejects.toMatchObject({ status: 409 })
    void api
  })

  test('a service account holding tokens cannot be deleted; the generic row API refuses it', async ({ admin, api }) => {
    // person-rename R2: principal foreign keys are `on delete restrict`, and
    // writes go through the service-account API only.
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-doomed' })
    const issued = await admin.post<{ token: string; id: string }>('/api/access_tokens', {
      label: 'doomed token',
      owner: account.row_id,
    })
    await expect(admin.delete(`/api/table/Service%20Account/${account.row_id}`)).rejects.toMatchObject({ status: 417 })
    await expect(sql.begin((tx) => tx`delete from service_account where row_id = ${account.row_id}`)).rejects.toThrow(/foreign key constraint/)
    const res = await api.fetch('/api/whoami', {
      headers: { authorization: `Bearer ${issued.token}` },
    })
    expect(res.status).toBe(200)
  })
})

describe('A token acts as its owner', () => {
  test("a token deletes rows when its owner's role may, and is refused where the owner is", async ({
    admin,
    api,
    createUser,
  }) => {
    const { createUserWithRole, makeTable } = await import('./fixtures')
    const dt = await makeTable(admin, { name: 'Token Crate', columns: ['title'] })
    const owner = await createUserWithRole(admin, createUser, {
      role: 'Token Crate Keeper',
      table: 'Token Crate',
      can_read: true,
      can_delete: true,
    })
    const first = await admin.post<{ row_id: string }>(dt.url, { title: 'one' })
    const { token } = await admin.post<{ token: string }>('/api/access_tokens', { label: 'crate script', owner: owner.user })
    const bearer = { authorization: `Bearer ${token}` }

    expect((await api.fetch(dt.rowUrl(first.row_id), { method: 'DELETE', headers: bearer })).status).toBe(200)
    expect((await admin.fetch(dt.rowUrl(first.row_id))).status).toBe(404)
    // No wider than the owner: the role cannot create, so neither can the token.
    expect(
      (await api.fetch(dt.url, { method: 'POST', headers: bearer, body: JSON.stringify({ title: 'two' }) })).status,
    ).toBe(403)
  })
})

describe('Revoke a token', () => {
  test('a revoked token stays listed, marked revoked', async ({ admin, api }) => {
    await makeUser(admin)
    const jwt = await userJwt(api)
    const auth = { authorization: `Bearer ${jwt}` }
    const issued = (await (
      await api.fetch('/api/access_tokens', { method: 'POST', headers: auth, body: JSON.stringify({ label: 'old script' }) })
    ).json()) as { id: string }
    expect((await api.fetch(`/api/access_tokens/${issued.id}`, { method: 'DELETE', headers: auth })).status).toBe(200)
    const { tokens } = (await (await api.fetch('/api/access_tokens', { headers: auth })).json()) as {
      tokens: { id: string; label: string; revoked_at: string | null }[]
    }
    const listed = tokens.find((t) => t.id === issued.id)
    expect(listed).toMatchObject({ label: 'old script' })
    expect(listed?.revoked_at).not.toBeNull()
  })
})

describe('An expired token or a disabled owner also stops it', () => {
  test('disabling a service account stops every one of its tokens, and enabling it again revives them', async ({
    admin,
    api,
  }) => {
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-many-tokens' })
    const tokens = [
      (await admin.post<{ token: string }>('/api/access_tokens', { label: 'first', owner: account.row_id })).token,
      (await admin.post<{ token: string }>('/api/access_tokens', { label: 'second', owner: account.row_id })).token,
    ]
    const status = async (token: string) =>
      (await api.fetch('/api/whoami', { headers: { authorization: `Bearer ${token}` } })).status
    await admin.fetch(`/api/service_accounts/${account.row_id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) })
    for (const token of tokens) expect(await status(token)).toBe(401)
    await admin.fetch(`/api/service_accounts/${account.row_id}`, { method: 'PATCH', body: JSON.stringify({ enabled: true }) })
    for (const token of tokens) expect(await status(token)).toBe(200)
  })

  test('a disabled person cannot be issued a new token', async ({ admin }) => {
    await makeUser(admin)
    await sql`update person set enabled = false where row_id = ${USER}`
    await expect(admin.post('/api/access_tokens', { label: 'for a leaver', owner: USER })).rejects.toMatchObject({
      status: 417,
    })
  })
})

describe('Changes to a service account are recorded', () => {
  test('creating, disabling and changing the roles of a service account is recorded in the activity record', async ({
    admin,
  }) => {
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-audited' })
    await admin.fetch(`/api/service_accounts/${account.row_id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) })
    await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['System Manager'] })
    const rows = await sql`select "user", operation from activity_log where operation like ${'%' + account.row_id + '%'} order by created_at`
    expect(rows.map((r) => r.operation)).toEqual([
      `service_account_created ${account.row_id}`,
      `service_account_disabled ${account.row_id}`,
      `service_account_roles ${account.row_id}: System Manager`,
    ])
    expect(rows.every((r) => r.user === admin.user)).toBe(true)
  })
})
