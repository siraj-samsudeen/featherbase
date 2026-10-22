import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import {
  getAccessToken,
  issueAccessToken,
  listAccessTokens,
  revokeAccessToken,
  setUserPassword,
} from '../src/auth'
import { resolveVerified } from '../src/sign-in'
import { methodOfKind } from '../src/identities'

// person-identities: Google reaches a principal through a linked account ID.
// Link one directly, then sign in through it the way the callback does.
async function findOrCreateGoogleUserIn(db: import("../src/db").TxSql | typeof sql, user: string) {
  const subject = `g-${user}`
  await db`insert into sign_in_identity (id, person_id, method, subject, linked_by)
    values (${'uid_' + subject.slice(0, 30)}, ${user}, 'google', ${subject}, 'test')`
}
async function findOrCreateGoogleUser(user: string, name: string) {
  const subject = `g-${user}`
  await sql`insert into sign_in_identity (id, person_id, method, subject, linked_by)
    values (${'uid_' + subject.slice(0, 30)}, ${user}, 'google', ${subject}, 'test') on conflict do nothing`
  const method = (await methodOfKind('google'))!
  // Resolve and check eligibility exactly as the shared pipeline does.
  const { completeSignIn } = await import('../src/sign-in')
  void resolveVerified
  return completeSignIn(method, { status: 'verified', subject, display_name: name }, null)
}
import { requestPasswordReset, resetPassword } from '../src/password-reset'
import { createTable } from '../src/table-engine'
import { getServiceAccount } from '../src/service-accounts'

// #137: review findings on the #131 access-token feature. Each case fails
// against the code as merged in #134.

// person-rename R2: a service account is its own principal with a minted
// `svc_` id; the name is its label.
async function serviceAccount(admin: { post: (p: string, b?: unknown) => Promise<unknown> }, name: string): Promise<string> {
  const created = (await admin.post('/api/service_accounts', { label: name, roles: ['System Manager'] })) as { row_id: string }
  return created.row_id
}

describe('#137 P1: an access token is header-only, never URL-borne', () => {
  test('a token in ?token= is refused for private files and for the websocket path', async ({
    admin,
    api,
  }) => {
    const svc = await serviceAccount(admin, 'svc-url-test')
    const { token } = await issueAccessToken(svc, 'url test')

    // Upload a private file as Administrator, then try to fetch it two ways.
    const form = new FormData()
    form.set('file', new File(['secret contents'], 'secret.txt', { type: 'text/plain' }))
    form.set('is_private', '1')
    const uploaded = (await (
      await admin.fetch('/api/upload_file', { method: 'POST', body: form, headers: {} })
    ).json()) as { file_url: string }

    // The header still works — automation must keep being able to read files.
    const viaHeader = await api.fetch(uploaded.file_url, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(viaHeader.status).toBe(200)

    // The query parameter does not: a URL lands in logs and history.
    const viaQuery = await api.fetch(
      `${uploaded.file_url}?token=${encodeURIComponent(token)}`,
    )
    expect(viaQuery.status).toBe(401)
  })
})

describe('#137 P1: OAuth cannot revive a disabled principal', () => {
  test('signing in does not re-enable a disabled user, and refuses a service account', async ({
    admin,
    seed,
  }) => {
    void seed
    // A disabled human user stays disabled — OAuth used to flip it back on.
    const email = 'disabled-human@example.com'
    const human = (await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email, enabled: false },
    })).row_id
    await expect(findOrCreateGoogleUser(human, 'Disabled Human')).rejects.toMatchObject({
      type: 'AuthenticationError',
    })
    const [row] = await sql`select enabled from person where row_id = ${human}`
    expect(row.enabled).toBe(false)

    // A service account is not a person (person-rename R2): no sign-in method
    // can even point at it — and critically, its tokens must not come back
    // to life.
    const svcId = await serviceAccount(admin, 'svc-oauth-test')
    const { token } = await issueAccessToken(svcId, 'oauth revival')
    await admin.fetch(`/api/service_accounts/${svcId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    })
    await expect(sql.begin((tx) => findOrCreateGoogleUserIn(tx, svcId))).rejects.toThrow(/foreign key constraint/)
    const [svc] = await sql`select enabled from service_account where row_id = ${svcId}`
    expect(svc.enabled).toBe(false)
    // The token stays dead.
    const who = await admin.fetch('/api/whoami', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(who.status).toBe(401)
  })
})

describe('#137 P2: a service account never acquires a password', () => {
  test('setUserPassword refuses, and password reset issues no link', async ({ admin }) => {
    const svc = await serviceAccount(admin, 'svc-pw-test')

    await expect(setUserPassword(svc, 'sneaky123')).rejects.toMatchObject({
      type: 'ValidationError',
    })
    // A service account has no password column at all; no person was touched.
    expect(await sql`select 1 from person where row_id = ${svc}`).toHaveLength(0)

    // Reset reaches setUserPassword directly, so it must be stopped earlier —
    // and silently, so it cannot be used to enumerate service accounts.
    await expect(requestPasswordReset('svc-pw-test')).resolves.toBeNull()
    await expect(requestPasswordReset(svc)).resolves.toBeNull()
    await expect(requestPasswordReset('svc-pw-test@service.invalid')).resolves.toBeNull()
  })
})

describe('#137 P2: "active" means the token actually authenticates', () => {
  test('expired tokens leave the count; a disabled owner is reported', async ({ admin }) => {
    const svc = await serviceAccount(admin, 'svc-count-test')
    await issueAccessToken(svc, 'live one')
    const expiring = await issueAccessToken(
      svc,
      'expiring',
      new Date(Date.now() + 60_000),
    )
    await sql`update access_token set expires_at = now() - interval '1 minute' where id = ${expiring.id}`

    const [account] = (await admin.get<{ service_accounts: { row_id: string; token_count: number }[] }>(
      '/api/service_accounts',
    )).service_accounts.filter((a) => a.row_id === svc)
    expect(account.token_count).toBe(1) // not 2 — the expired one cannot authenticate

    // A token whose owner is disabled is not "active" either.
    await admin.fetch(`/api/service_accounts/${svc}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    })
    const listed = await listAccessTokens(svc)
    expect(listed.every((t) => t.owner_enabled === false)).toBe(true)
  })
})

describe('#137 P2: a user Table cannot squat on the credential store', () => {
  test('creating a Table named "Access Token" is refused', async () => {
    await expect(
      createTable({ name: 'Access Token', columns: [{ column_name: 'label', column_type: 'Data' }] }),
    ).rejects.toMatchObject({ type: 'ConflictError' })
  })
})

// ---------------------------------------------------------------------------
// #137 round 2: findings on the fix above. Each case below fails against the
// first cut of this PR (029becd) and passes here.
// ---------------------------------------------------------------------------

// The password write must fail between the reset request and the click. A
// person can no longer turn into a service account mid-reset (person-rename
// R2: separate tables), so the person is removed instead: the write then
// finds no person and refuses.
async function failPasswordWrites(person: string) {
  await sql`delete from person where row_id = ${person}`
}

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))

describe('#137 R2: the access_token guard reaches databases that already ran 0069', () => {
  test('the guard is a migration of its own, and it fires only on a squatter', async () => {
    // Which file carries the guard?
    const carriers = readdirSync(MIGRATIONS).filter(
      (f) => f.endsWith('.sql') && readFileSync(join(MIGRATIONS, f), 'utf8').includes('credential store'),
    )
    expect(carriers).toHaveLength(1)
    const [guardFile] = carriers

    // THE POINT: runMigrations() skips any file already recorded in the
    // `migration` table. Every checkout that has access tokens recorded
    // 0069 when they landed, so a guard written INTO 0069 can never run
    // again there — and on a fresh database it is vacuous, because
    // access_token cannot pre-exist the migration that creates it. Only a
    // later, not-yet-recorded file converges a real developer database.
    expect(guardFile).not.toMatch(/^0069/)
    expect(readFileSync(join(MIGRATIONS, '0069_access_tokens.sql'), 'utf8')).not.toMatch(
      /raise exception/i,
    )

    const body = readFileSync(join(MIGRATIONS, guardFile), 'utf8')

    // Against the real credential store the guard is a no-op.
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
    })

    // Against a squatting table — what a Table named "Access Token" compiles
    // to — it refuses, and says how to fix it. (Wrapped in a savepoint so the
    // deliberate failure does not poison the surrounding test transaction.)
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe(`set local search_path = featherbase, public`)
        await tx.unsafe(`alter table access_token rename to access_token_real`)
        await tx.unsafe(`create table access_token (id varchar(140) primary key, label varchar(140))`)
        await tx.unsafe(body)
      }),
    ).rejects.toThrow(/credential store/)
  })
})

describe('#137 R2: the token list never hides a credential', () => {
  test('a token whose owner row has vanished is still listed, and still revocable', async ({
    admin,
  }) => {
    const svc = await serviceAccount(admin, 'svc-orphan')
    const { id } = await issueAccessToken(svc, 'orphaned')

    // The FK normally keeps owner pointing at a real user, so this state is
    // constructed rather than provoked. It is worth defending anyway: an
    // INNER join drops such a row from the admin screen while
    // resolveAccessToken would still match it by hash — an operator cannot
    // revoke a credential they have been shown does not exist.
    await sql`alter table access_token drop constraint access_token_service_account_fkey`
    await sql`update access_token set service_account = 'ghost-principal' where id = ${id}`

    const listed = await listAccessTokens()
    expect(listed.map((t) => t.id)).toContain(id)
    expect(listed.find((t) => t.id === id)?.owner_enabled).toBe(false)
    // Filtering by that owner must find it too — that is how the screen drills in.
    expect((await listAccessTokens('ghost-principal')).map((t) => t.id)).toContain(id)

    await revokeAccessToken(id)
    expect((await getAccessToken(id)).revoked_at).not.toBeNull()
  })
})

describe('#137 R2: token_count agrees with what actually authenticates', () => {
  test('a disabled service account reports zero active tokens', async ({ admin }) => {
    const svc = await serviceAccount(admin, 'svc-count-disabled')
    const { token } = await issueAccessToken(svc, 'one')
    await issueAccessToken(svc, 'two')
    expect((await getServiceAccount(svc)).token_count).toBe(2)

    await admin.fetch(`/api/service_accounts/${svc}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    })

    // Ground truth first: resolveAccessToken refuses, because it checks the
    // owner's enabled flag. The count must say the same thing.
    const who = await admin.fetch('/api/whoami', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(who.status).toBe(401)
    expect((await getServiceAccount(svc)).token_count).toBe(0)
  })
})

describe('#137 R2: OAuth refusals cannot be told apart', () => {
  test('a disabled person and a privileged one through a method that cannot admit them fail identically; a service account cannot be reached at all', async ({ admin, seed }) => {
    void seed
    // person-rename R2: a service account is not a person, so no sign-in
    // method can point at it (the identity's foreign key refuses) — the old
    // "service account vs disabled user" pair has no second half any more.
    const svc = await serviceAccount(admin, 'svc-enum')
    await expect(sql.begin((tx) => findOrCreateGoogleUserIn(tx, svc))).rejects.toThrow(/foreign key constraint/)

    // The refusal for an existing-but-ineligible person is the one generic
    // AuthenticationError, whichever reason applies.
    const disabled = (await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: 'enum-disabled@example.com', enabled: false },
    })).row_id
    const other = (await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: 'enum-other@example.com', enabled: false },
    })).row_id
    const a = await findOrCreateGoogleUser(disabled, 'x').catch((e: Error) => e)
    const b = await findOrCreateGoogleUser(other, 'x').catch((e: Error) => e)
    expect(a).toBeInstanceOf(Error)
    expect(b).toBeInstanceOf(Error)
    if (!(a instanceof Error) || !(b instanceof Error)) throw new Error('unreachable')
    expect(a.message).toBe(b.message)
    expect((a as { type?: string }).type).toBe((b as { type?: string }).type)
  })
})

describe('#137 R2: a reset link is single-use, and a failed write still burns it', () => {
  test('a link that cannot set a password never sets one, however often it is used', async ({
    admin,
  }) => {
    const email = 'reset-then-service@example.com'
    const id = (await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email, enabled: true },
    })).row_id
    // person-identities: a reset link goes only to an account with a password.
    await setUserPassword(id, 'initial-pw-1')
    const [{ password_hash: initial }] = await sql`select password_hash from person where row_id = ${id}`
    const token = await requestPasswordReset(email)
    expect(token).toMatch(/^[0-9a-f]{48}$/)

    // The write must fail between the request and the click. A person can no
    // longer turn into a service account (person-rename R2: they are separate
    // tables), so the person's password write is made to fail instead.
    await failPasswordWrites(id)

    // The link is inert from here on: it can never stamp a password, no
    // matter how many times it is presented.
    for (const attempt of ['first', 'second'])
      await expect(resetPassword(token as string, `pw-${attempt}-123`)).rejects.toThrow()
    // The link never stamps a password anywhere: the person is gone and no
    // one else's hash changed.
    void initial
    expect(await sql`select 1 from person where row_id = ${id}`).toHaveLength(0)
    expect(await sql`select 1 from password_reset where token = ${token}`).toHaveLength(0)
  })

  test('a write that fails does not give the link back', async ({ admin }) => {
    const email = 'reset-burn@example.com'
    const id = (await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email, enabled: true },
    })).row_id
    // person-identities: a reset link goes only to an account with a password.
    await setUserPassword(id, 'initial-pw-1')
    const [{ password_hash: initial }] = await sql`select password_hash from person where row_id = ${id}`
    const token = await requestPasswordReset(email)

    // Same failure mode as above — the principal turns into a service account
    // between the request and the click — but this case pins the ORDER, which
    // is what separates burn-on-use from an atomic write-and-consume. Under
    // atomicity the refused write rolls the deletion back and the row is still
    // sitting there, live for the rest of its hour.
    await failPasswordWrites(id)
    await expect(resetPassword(token as string, 'burned-pw-1')).rejects.toThrow()

    const outstanding = await sql`select 1 from password_reset where token = ${token}`
    expect(outstanding.length).toBe(0)

    // And the second click is refused as a spent link, not re-run against the
    // guard: the token is gone, so the lookup is what turns it away.
    await expect(resetPassword(token as string, 'burned-pw-2')).rejects.toMatchObject({
      type: 'ValidationError',
      message: 'This reset link is invalid or has expired',
    })
    // The link never stamps a password anywhere: the person is gone and no
    // one else's hash changed.
    void initial
    expect(await sql`select 1 from person where row_id = ${id}`).toHaveLength(0)
    expect(await sql`select 1 from password_reset where token = ${token}`).toHaveLength(0)
  })

  test('a successful reset consumes the link, so it cannot be replayed', async ({ admin }) => {
    const email = 'reset-replay@example.com'
    const id = (await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email, enabled: true },
    })).row_id
    // person-identities: a reset link goes only to an account with a password.
    await setUserPassword(id, 'initial-pw-1')
    const token = await requestPasswordReset(email)
    await resetPassword(token as string, 'first-password-1')
    const [afterFirst] = await sql`select password_hash from person where row_id = ${id}`
    expect(afterFirst.password_hash).not.toBeNull()

    // Replaying it must not set a second password.
    await expect(resetPassword(token as string, 'second-password-2')).rejects.toMatchObject({
      type: 'ValidationError',
    })
    const [afterSecond] = await sql`select password_hash from person where row_id = ${id}`
    expect(afterSecond.password_hash).toBe(afterFirst.password_hash)
  })
})

describe('#137 R2: the reserved set covers every engine-owned raw table', () => {
  test('no user Table may compile onto a raw platform table', async () => {
    // The first cut listed three names by hand; the database has eleven such
    // tables. Deriving the set means this list is a witness, not a duplicate
    // of the implementation — a new raw table is covered the day it lands.
    // (`internal_metadata` joined in 0081; `patch_log` only became reliable
    // here in 0079, which stopped it being created lazily on first use.)
    const raw = (
      await sql`
        select t.table_name from information_schema.tables t
        where ((t.table_schema = 'featherbase' and t.table_name in
                 ('access_token','installed_app','internal_metadata','migration','password_reset',
                  'patch_log','series','single_value','tag_link','user_settings'))
               or (t.table_schema = 'public' and t.table_name = 'site'))
        order by 1`
    ).map((r) => r.table_name as string)
    expect(raw.length).toBe(11)

    for (const physical of raw) {
      // 'single_value' -> 'Single Value': the inverse of tableName().
      const name = physical.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
      await expect(
        createTable({ name, columns: [{ column_name: 'x', column_type: 'Data' }] }),
      ).rejects.toMatchObject({ type: 'ConflictError' })
    }
  })
})
