import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { issueSession, setUserPassword } from '../src/auth'
import { sql } from '../src/db'
import { getServiceAccount } from '../src/service-accounts'
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

describe('#853: rename access tokens', () => {
  test('an owner renames a token without replacing its credential', async ({ api, createUser }) => {
    const owner = await createUser({ email: 'rename-owner@x.com' })
    const issued = await owner.post<{ id: string; token: string }>('/api/access_tokens', {
      label: 'old name', expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    })
    const [before] = await sql`select * from access_token where id = ${issued.id}`
    const response = await owner.fetch(`/api/access_tokens/${issued.id}`, {
      method: 'PATCH',
      // A rename is not a generalized token update: immutable fields are ignored.
      body: JSON.stringify({ label: 'new name', owner: 'Administrator', person: 'Administrator',
        service_account: 'svc_fake', token_hash: 'replacement', expires_at: null, revoked_at: new Date().toISOString() }),
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).not.toHaveProperty('token')
    expect(result).not.toHaveProperty('token_hash')
    expect(JSON.stringify(result)).not.toContain(issued.token)
    expect(JSON.stringify(result)).not.toContain(before.token_hash)
    const [after] = await sql`select * from access_token where id = ${issued.id}`
    expect(after).toEqual({ ...before, label: 'new name' })
    const { tokens } = await owner.get<{ tokens: { id: string; label: string }[] }>('/api/access_tokens')
    expect(tokens.find((t) => t.id === issued.id)).toMatchObject({ label: 'new name' })
    const who = await api.fetch('/api/whoami', { headers: { authorization: `Bearer ${issued.token}` } })
    expect(who.status).toBe(200)
    expect(await who.json()).toMatchObject({ row_id: owner.user })
    const audit = await sql`select "user", operation from activity_log where operation = ${`access_token_renamed ${issued.id}`}`
    expect(audit).toEqual([{ user: owner.user, operation: `access_token_renamed ${issued.id}` }])
  })

  test('a System Manager renames a foreign token while preserving its data access', async ({ admin, api, createUser }) => {
    const { createUserWithRole, makeTable } = await import('./fixtures')
    const table = await makeTable(admin, { name: 'Rename Crate', columns: ['title'] })
    const owner = await createUserWithRole(admin, createUser, {
      role: 'Rename Crate Reader', table: 'Rename Crate', can_read: true, can_delete: false,
    })
    const row = await admin.post<{ row_id: string }>(table.url, { title: 'still readable' })
    const issued = await admin.post<{ id: string; token: string }>('/api/access_tokens', { label: 'before', owner: owner.user })
    const bearer = { authorization: `Bearer ${issued.token}` }
    expect((await api.fetch(table.rowUrl(row.row_id), { headers: bearer })).status).toBe(200)
    expect((await api.fetch(table.rowUrl(row.row_id), { method: 'DELETE', headers: bearer })).status).toBe(403)
    const [before] = await sql`select * from access_token where id = ${issued.id}`
    const response = await admin.fetch(`/api/access_tokens/${issued.id}`, { method: 'PATCH', body: JSON.stringify({ label: 'after' }) })
    expect(response.status).toBe(200)
    const [after] = await sql`select * from access_token where id = ${issued.id}`
    expect(after).toEqual({ ...before, label: 'after' })
    expect((await api.fetch(table.rowUrl(row.row_id), { headers: bearer })).status).toBe(200)
    expect((await api.fetch(table.rowUrl(row.row_id), { method: 'DELETE', headers: bearer })).status).toBe(403)
    expect(await sql`select "user" from activity_log where operation = ${`access_token_renamed ${issued.id}`}`)
      .toEqual([{ user: admin.user }])
  })

  test.for([
    ['blank', { label: '' }], ['whitespace', { label: '   ' }], ['missing', {}],
    ['null', { label: null }], ['number', { label: 42 }], ['object', { label: {} }], ['array', { label: ['name'] }],
  ] as const)('refuses a %s token label without changing the token', async ([, body], { admin }) => {
    const issued = await admin.post<{ id: string }>('/api/access_tokens', { label: 'keep me' })
    const before = await sql`select * from access_token where id = ${issued.id}`
    const response = await admin.fetch(`/api/access_tokens/${issued.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    expect(response.status).toBe(417)
    expect(await sql`select * from access_token where id = ${issued.id}`).toEqual(before)
    expect(await sql`select 1 from activity_log where operation = ${`access_token_renamed ${issued.id}`}`).toHaveLength(0)
  })

  test('refuses malformed rename JSON without changing the token', async ({ admin }) => {
    const issued = await admin.post<{ id: string }>('/api/access_tokens', { label: 'keep malformed' })
    const before = await sql`select * from access_token where id = ${issued.id}`
    const response = await admin.fetch(`/api/access_tokens/${issued.id}`, { method: 'PATCH', body: '{' })
    expect(response.status).toBe(417)
    expect(await response.json()).toMatchObject({ error: { type: 'ValidationError' } })
    expect(await sql`select * from access_token where id = ${issued.id}`).toEqual(before)
    expect(await sql`select 1 from activity_log where operation = ${`access_token_renamed ${issued.id}`}`).toHaveLength(0)
  })

  test.for(['foreign user', 'preview session'] as const)('refuses token rename by a %s', async (actor, { admin, api, createUser }) => {
    const owner = await createUser({ email: 'rename-guard@x.com' })
    const issued = await admin.post<{ id: string }>('/api/access_tokens', { label: 'protected', owner: owner.user })
    const before = await sql`select * from access_token where id = ${issued.id}`
    const response = actor === 'foreign user'
      ? await (await createUser({ email: 'foreign-renamer@x.com' })).fetch(`/api/access_tokens/${issued.id}`, {
        method: 'PATCH', body: JSON.stringify({ label: 'stolen' }),
      })
      : await api.fetch(`/api/access_tokens/${issued.id}`, {
        method: 'PATCH', headers: { authorization: `Bearer ${(await issueSession(owner.user!, { preview: true })).token}` },
        body: JSON.stringify({ label: 'preview edit' }),
      })
    expect(response.status).toBe(403)
    expect(await sql`select * from access_token where id = ${issued.id}`).toEqual(before)
  })

  test.for(['revoked', 'expired', 'disabled person', 'disabled service account'] as const)(
    'renaming a %s token cannot revive it', async (state, { admin, api, createUser }) => {
      const owner = state === 'disabled service account'
        ? (await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-disabled-token' })).row_id
        : (await createUser({ email: 'inactive-token-owner@x.com' })).user
      const issued = await admin.post<{ id: string; token: string }>('/api/access_tokens', { label: 'inactive', owner })
      if (state === 'revoked') await admin.delete(`/api/access_tokens/${issued.id}`)
      if (state === 'expired') await sql`update access_token set expires_at = now() - interval '1 minute' where id = ${issued.id}`
      if (state === 'disabled person') await sql`update person set enabled = false where row_id = ${owner}`
      if (state === 'disabled service account') {
        expect((await admin.fetch(`/api/service_accounts/${owner}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) })).status).toBe(200)
      }
      const auth = { authorization: `Bearer ${issued.token}` }
      expect((await api.fetch('/api/whoami', { headers: auth })).status).toBe(401)
      const [before] = await sql`select * from access_token where id = ${issued.id}`
      expect((await admin.fetch(`/api/access_tokens/${issued.id}`, { method: 'PATCH', body: JSON.stringify({ label: 'still inactive' }) })).status).toBe(200)
      const [after] = await sql`select * from access_token where id = ${issued.id}`
      expect(after).toEqual({ ...before, label: 'still inactive' })
      expect((await api.fetch('/api/whoami', { headers: auth })).status).toBe(401)
    },
  )

  test('a nonexistent token cannot be renamed', async ({ admin }) => {
    const response = await admin.fetch('/api/access_tokens/tok_000000000000', { method: 'PATCH', body: JSON.stringify({ label: 'missing' }) })
    expect(response.status).toBe(404)
    expect(await sql`select 1 from access_token where id = 'tok_000000000000'`).toHaveLength(0)
  })
})

describe('#853: rename service accounts', () => {
  test('a System Manager renames a service account without replacing its principal', async ({ admin, api }) => {
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-before', roles: ['System Manager'] })
    const issued = await admin.post<{ id: string; token: string }>('/api/access_tokens', { label: 'automation', owner: account.row_id })
    const auth = { authorization: `Bearer ${issued.token}` }
    expect((await api.fetch('/api/service_accounts', { headers: auth })).status).toBe(200)
    const [before] = await sql`select row_id, label, enabled, created_at, created_by from service_account where row_id = ${account.row_id}`
    const roles = await sql`select * from has_role where parent = ${account.row_id} order by row_id`
    const tokens = await sql`select * from access_token where service_account = ${account.row_id}`
    const response = await admin.fetch(`/api/service_accounts/${account.row_id}`, { method: 'PATCH', body: JSON.stringify({ label: 'svc-after' }) })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).not.toHaveProperty('token')
    expect(result).not.toHaveProperty('token_hash')
    expect(JSON.stringify(result)).not.toContain(issued.token)
    expect(JSON.stringify(result)).not.toContain(tokens[0].token_hash)
    const [after] = await sql`select row_id, label, enabled, created_at, created_by from service_account where row_id = ${account.row_id}`
    expect(after).toEqual({ ...before, label: 'svc-after' })
    expect(await sql`select * from has_role where parent = ${account.row_id} order by row_id`).toEqual(roles)
    expect(await sql`select * from access_token where service_account = ${account.row_id}`).toEqual(tokens)
    const list = await admin.get<{ service_accounts: { row_id: string; label: string }[] }>('/api/service_accounts')
    expect(list.service_accounts.find((a) => a.row_id === account.row_id)).toMatchObject({ label: 'svc-after' })
    const who = await api.fetch('/api/whoami', { headers: auth })
    expect(who.status).toBe(200)
    expect(await who.json()).toMatchObject({ row_id: account.row_id, kind: 'service_account' })
    expect((await api.fetch('/api/service_accounts', { headers: auth })).status).toBe(200)
    expect(await sql`select "user" from activity_log where operation = ${`service_account_renamed ${account.row_id}`}`)
      .toEqual([{ user: admin.user }])
  })

  test.for([
    ['blank', { label: '' }, 417], ['whitespace', { label: '  ' }, 417], ['missing', {}, 417],
    ['null', { label: null }, 417], ['number', { label: 42 }, 417], ['object', { label: {} }, 417],
    ['array', { label: ['svc-name'] }, 417], ['invalid slug', { label: 'Not A Slug!' }, 417],
    ['too short', { label: 'a' }, 417], ['too long', { label: 'a'.repeat(65) }, 417],
    ['duplicate', { label: 'svc-taken-rename' }, 409],
    ['uppercase duplicate', { label: 'SVC-TAKEN-RENAME' }, 417],
    ['mixed disable', { label: 'svc-new', enabled: false }, 417],
    ['mixed enable', { label: 'svc-new', enabled: true }, 417],
  ] as const)('refuses a %s service-account edit without changing state', async ([, body, status], { admin }) => {
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-keep', roles: ['All'] })
    await admin.post('/api/service_accounts', { label: 'svc-taken-rename' })
    await admin.post('/api/access_tokens', { label: 'keep credential', owner: account.row_id })
    const before = await sql`select * from service_account order by row_id`
    const roles = await sql`select * from has_role where parent = ${account.row_id} order by row_id`
    const tokens = await sql`select * from access_token where service_account = ${account.row_id}`
    const response = await admin.fetch(`/api/service_accounts/${account.row_id}`, { method: 'PATCH', body: JSON.stringify(body) })
    expect(response.status).toBe(status)
    expect(await sql`select * from service_account order by row_id`).toEqual(before)
    expect(await sql`select * from has_role where parent = ${account.row_id} order by row_id`).toEqual(roles)
    expect(await sql`select * from access_token where service_account = ${account.row_id}`).toEqual(tokens)
    expect(await sql`select 1 from activity_log where operation = ${`service_account_renamed ${account.row_id}`}`).toHaveLength(0)
  })

  test('an ordinary user cannot rename a service account', async ({ admin, createUser }) => {
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-protected' })
    const plain = await createUser({ email: 'service-renamer@x.com' })
    const before = await sql`select * from service_account where row_id = ${account.row_id}`
    expect((await plain.fetch(`/api/service_accounts/${account.row_id}`, { method: 'PATCH', body: JSON.stringify({ label: 'svc-stolen' }) })).status).toBe(403)
    expect(await sql`select * from service_account where row_id = ${account.row_id}`).toEqual(before)
  })

  test.for(['disabled', 'revoked', 'expired'] as const)('renaming a service account cannot revive a %s credential', async (state, { admin, api }) => {
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-off', roles: ['System Manager'] })
    const issued = await admin.post<{ id: string; token: string }>('/api/access_tokens', { label: 'off token', owner: account.row_id })
    if (state === 'disabled') {
      expect((await admin.fetch(`/api/service_accounts/${account.row_id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) })).status).toBe(200)
    }
    if (state === 'revoked') await admin.delete(`/api/access_tokens/${issued.id}`)
    if (state === 'expired') await sql`update access_token set expires_at = now() - interval '1 minute' where id = ${issued.id}`
    const auth = { authorization: `Bearer ${issued.token}` }
    expect((await api.fetch('/api/whoami', { headers: auth })).status).toBe(401)
    const tokens = await sql`select * from access_token where service_account = ${account.row_id}`
    const roles = await sql`select * from has_role where parent = ${account.row_id} order by row_id`
    expect((await admin.fetch(`/api/service_accounts/${account.row_id}`, { method: 'PATCH', body: JSON.stringify({ label: 'svc-still-off' }) })).status).toBe(200)
    expect(await sql`select label, enabled from service_account where row_id = ${account.row_id}`).toEqual([{ label: 'svc-still-off', enabled: state !== 'disabled' }])
    expect(await sql`select * from access_token where service_account = ${account.row_id}`).toEqual(tokens)
    expect(await sql`select * from has_role where parent = ${account.row_id} order by row_id`).toEqual(roles)
    expect((await api.fetch('/api/whoami', { headers: auth })).status).toBe(401)
  })

  test('token names accept 140 characters but refuse longer suggestions and edits without changing state', async ({ admin }) => {
    const boundary = `${'a'.repeat(138)}-1`
    const issued = await admin.post<{ id: string; label: string }>('/api/access_tokens', { label: boundary })
    expect(issued.label).toBe(boundary)
    const before = await sql`select * from access_token where id = ${issued.id}`
    for (const label of [`${'a'.repeat(139)}-1`, 'manual '.repeat(21), '😀'.repeat(141)]) {
      for (const [method, path] of [['POST', '/api/access_tokens'], ['PATCH', `/api/access_tokens/${issued.id}`]]) {
        const response = await admin.fetch(path, { method, body: JSON.stringify({ label }) })
        expect(response.status).toBe(417)
        expect(await response.json()).toMatchObject({ error: { type: 'ValidationError', message: 'A token label must be at most 140 characters' } })
      }
    }
    expect(await sql`select * from access_token where id = ${issued.id}`).toEqual(before)
    const unicode = '😀'.repeat(140)
    const renamed = await admin.fetch(`/api/access_tokens/${issued.id}`, { method: 'PATCH', body: JSON.stringify({ label: unicode }) })
    expect(renamed.status).toBe(200)
    expect(await renamed.json()).toMatchObject({ label: unicode })
  })

  test('a nonexistent service account cannot be renamed', async ({ admin }) => {
    const response = await admin.fetch('/api/service_accounts/svc_aaaaaaaaaaaaaaaaaaaa', { method: 'PATCH', body: JSON.stringify({ label: 'svc-missing' }) })
    expect(response.status).toBe(404)
    expect(await sql`select 1 from service_account where row_id = 'svc_aaaaaaaaaaaaaaaaaaaa'`).toHaveLength(0)
  })
})

describe('looking up a service account', () => {
  test('one that does not exist is not found', async () => {
    await expect(getServiceAccount('svc_missing')).rejects.toMatchObject({ type: 'NotFoundError', message: 'Service account svc_missing not found' })
  })
})
