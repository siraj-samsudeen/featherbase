// OpenSpec change `person-rename` (#275): User → Person, service accounts as
// their own principal, one principal model (person / service_account, exactly
// one set), opaque ids with built-ins kept, the sign-in table renamed.
import { describe, expect } from 'vitest'
import { makeClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { app } from '../src/index'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import { issueAccessToken } from '../src/auth'
import { getRoles, isPrivileged } from '../src/permissions'
import { makePerson } from './fixtures'

const rel = async (name: string) => (await sql`select to_regclass(${'featherbase.' + name}) as r`)[0].r

describe('person-rename: the human record is a Person', () => {
  test('tables are renamed and /api/users is gone, with no alias', async ({ admin }) => {
    expect(await rel('person')).toBeTruthy()
    expect(await rel('user')).toBeNull()
    expect(await rel('sign_in_identity')).toBeTruthy()
    expect(await rel('user_identity')).toBeNull()
    expect(await sql`select name from table_def where name in ('User', 'Person')`).toEqual([{ name: 'Person' }])
    expect((await admin.fetch('/api/users/Administrator/identities')).status).toBe(404)
    expect((await admin.fetch('/api/people/Administrator/identities')).status).toBe(200)
    // username carries over with its index.
    expect(await sql`select 1 from pg_indexes where schemaname = 'featherbase' and indexname = 'person_username_lower_uq'`).toHaveLength(1)
  })

  test('ids live in namespaces; the built-ins keep theirs', async () => {
    expect(await sql`select row_id, built_in from person where row_id in ('Administrator', 'Guest') order by row_id`).toEqual([
      { row_id: 'Administrator', built_in: true },
      { row_id: 'Guest', built_in: true },
    ])
    const id = await makePerson({ email: 'ns@x.test' })
    expect(id).toMatch(/^psn_[a-z2-7]{20}$/)
    await expect(sql.begin((tx) => tx`insert into person (row_id, full_name) values ('RR-7963', 'x')`)).rejects.toThrow(/person_id_namespace/)
    await expect(sql.begin((tx) => tx`insert into service_account (row_id, label) values ('svc-bot', 'x')`)).rejects.toThrow(/service_account_id_namespace/)
  })

  test('a person id is assigned, never typed', async ({ admin }) => {
    await expect(admin.post('/api/save_row', { table: 'Person', row: { row_id: 'chosen@x.test', email: 'chosen@x.test' } })).rejects.toMatchObject({ status: 404 })
    await expect(
      sql.begin(async () => {
        const { saveDoc } = await import('../src/document')
        await saveDoc('Person', { row_id: 'chosen@x.test', email: 'chosen@x.test' }, 'Administrator', 'insert')
      }),
    ).rejects.toMatchObject({ type: 'ValidationError', fields: { row_id: 'assigned automatically' } })
    // Not even one shaped like a minted id (Codex P2 on #384).
    await expect(
      sql.begin(async () => {
        const { saveDoc } = await import('../src/document')
        await saveDoc('Person', { row_id: 'psn_chosen', email: 'chosen@x.test' }, 'Administrator', 'insert')
      }),
    ).rejects.toMatchObject({ type: 'ValidationError', fields: { row_id: 'assigned automatically' } })
    await expect(admin.post('/api/table/Person', { row_id: 'psn_chosen', email: 'chosen@x.test' })).rejects.toMatchObject({ status: 417 })
    // Nor through the amendment path: `amended_from` does not let a chosen id
    // in on an opaque-id Table (Codex review on #384).
    await admin.post('/api/table_def', {
      name: 'Opaque Doc', is_submittable: true, id_pattern: 'opaque:opq_',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    const { saveDoc } = await import('../src/document')
    const first = await saveDoc('Opaque Doc', { title: 'one' }, 'Administrator', 'insert')
    expect(first.row_id).toMatch(/^opq_[a-z2-7]{20}$/)
    const amended = await saveDoc('Opaque Doc', { row_id: 'opq_chosen', amended_from: first.row_id, title: 'two' }, 'Administrator', 'insert')
    expect(amended.row_id).not.toBe('opq_chosen')
    expect(amended.row_id).toMatch(/^opq_[a-z2-7]{20}$/)
  })

  test('a Person saved with roles through the generic path; the generated pair follows parent', async ({ admin }) => {
    const created = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: 'roles@x.test', full_name: 'Roles', roles: [{ role: 'System Manager' }] },
    })
    expect(await sql`select role, person, service_account, parenttype from has_role where parent = ${created.row_id}`).toEqual([
      { role: 'System Manager', person: created.row_id, service_account: null, parenttype: 'Person' },
    ])
    expect(await getRoles(created.row_id)).toContain('System Manager')
    expect(await isPrivileged(created.row_id)).toBe(true)
    // The pair is storage, not metadata: the roles grid renders no pickers.
    expect((await getMeta('Has Role')).columns.map((c) => c.column_name)).toEqual(['role'])
  })
})

describe('person-rename: one principal model', () => {
  test('Data Scope and Share carry a Person and a Service account picker; exactly one must be set', async ({ admin }) => {
    for (const table of ['Data Scope', 'Share']) {
      const cols = (await getMeta(table)).columns
      expect(cols.find((c) => c.column_name === 'person')).toMatchObject({ column_type: 'Reference', reference_table: 'Person' })
      expect(cols.find((c) => c.column_name === 'service_account')).toMatchObject({ column_type: 'Reference', reference_table: 'Service Account' })
      expect(cols.find((c) => c.column_name === 'user')).toBeUndefined()
    }
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-pair' })
    const person = await makePerson({ email: 'pair@x.test' })
    for (const row of [{}, { person, service_account: account.row_id }])
      await expect(
        admin.post('/api/save_row', { table: 'Data Scope', row: { ...row, allow_table: 'Role', for_value: 'All' } }),
      ).rejects.toMatchObject({ status: 417, fields: { person: expect.any(String), service_account: expect.any(String) } })
    await expect(sql.begin((tx) => tx`insert into data_scope (row_id, allow_table, for_value) values ('ds-none', 'Role', 'All')`)).rejects.toThrow(
      /data_scope_one_principal/,
    )
  })

  test('the Person picker cannot take a service account', async ({ admin }) => {
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-picker' })
    await expect(
      admin.post('/api/save_row', { table: 'Data Scope', row: { person: account.row_id, allow_table: 'Role', for_value: 'All' } }),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('deleting a principal that still holds scope, share or token rows is refused by the database', async ({ admin }) => {
    const person = await makePerson({ email: 'held@x.test' })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person, allow_table: 'Role', for_value: 'All' } })
    await expect(sql.begin((tx) => tx`delete from person where row_id = ${person}`)).rejects.toThrow(/foreign key constraint/)
  })

  test('Service Account is read-only through the generic API; its roles change only through its own endpoint', async ({ admin }) => {
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-ro' })
    const url = `/api/table/Service%20Account/${account.row_id}`
    const row = await admin.get<{ updated_at: string }>(url)
    const patched = await admin.fetch(url, { method: 'PATCH', body: JSON.stringify({ label: 'renamed', updated_at: row.updated_at }) })
    expect(patched.status).toBe(417)
    await expect(admin.post('/api/save_row', { table: 'Service Account', row: { label: 'svc-generic' } })).rejects.toMatchObject({ status: 417 })
    await expect(admin.delete(url)).rejects.toMatchObject({ status: 417 })

    const updated = await admin.post<{ roles: string[] }>(`/api/service_accounts/${account.row_id}/roles`, { roles: ['System Manager'] })
    expect(updated.roles).toEqual(['System Manager'])
    expect(await isPrivileged(account.row_id)).toBe(true)
    expect(await sql`select parenttype, service_account, person from has_role where parent = ${account.row_id}`).toEqual([
      { parenttype: 'Service Account', service_account: account.row_id, person: null },
    ])
    await admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: [] })
    expect(await isPrivileged(account.row_id)).toBe(false)
    await expect(admin.post(`/api/service_accounts/${account.row_id}/roles`, { roles: ['No Such Role'] })).rejects.toMatchObject({ status: 417 })
  })

  test('a service-account name names one account, held by the database (Codex P2 on #384)', async () => {
    await sql`insert into service_account (row_id, label) values ('svc_aaaaaaaaaaaaaaaaaaaa', 'svc-once')`
    await expect(sql.begin((tx) => tx`insert into service_account (row_id, label) values ('svc_bbbbbbbbbbbbbbbbbbbb', 'SVC-ONCE')`)).rejects.toThrow(
      /service_account_label_lower_uq/,
    )
  })

  test('a service account writes as itself: created_by is its id, and it is rate-limited by its own budget', async ({ admin }) => {
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-writer', roles: ['System Manager'] })
    const { token } = await issueAccessToken(account.row_id, 'writer')
    const svc = makeClient(app, token, account.row_id)
    const role = await svc.post<{ row_id: string; created_by: string }>('/api/save_row', { table: 'Role', row: { row_id: 'Written By Bot' } })
    expect(role.created_by).toBe(account.row_id)
    await sql`update service_account set api_rate_limit = 1 where row_id = ${account.row_id}`
    const { resetRateLimit } = await import('../src/rate-limit')
    resetRateLimit(account.row_id)
    expect((await svc.fetch('/api/whoami')).status).toBe(200)
    expect((await svc.fetch('/api/whoami')).status).toBe(429)
  })

  test('assignment goes to people; a service account is not offered', async ({ admin }) => {
    const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-assign' })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Assign Probe' } })
    await expect(admin.post('/api/assign', { table: 'Role', row_id: 'Assign Probe', assign_to: account.row_id })).rejects.toMatchObject({ status: 404 })
  })
})

describe('person-rename: names, not ids (review B-M2, B-M3)', () => {
  test('names come back for people and service accounts; an unknown id or a nameless person is null', async ({ admin, createUser }) => {
    const asha = await createUser({ email: 'asha.n@x.test', fullName: 'Asha Kumar' })
    const handle = await makePerson({ username: 'ravi.m' })
    const bare = await makePerson({})
    const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-named' })
    const { names } = await asha.post<{ names: Record<string, string | null> }>('/api/people/names', {
      ids: [asha.user, handle, bare, svc.row_id, 'psn_nobodyaaaaaaaaaaaaa', 'Administrator'],
    })
    expect(names).toEqual({
      [asha.user!]: 'Asha Kumar',
      [handle]: '@ravi.m',
      [bare]: null,
      [svc.row_id]: 'svc-named',
      psn_nobodyaaaaaaaaaaaaa: null,
      Administrator: 'Administrator',
    })
  })

  test('the Person picker searches name, username, address and employee code, labels "Name · handle", and skips built-ins', async ({ admin }) => {
    const { sql: db } = await import('../src/db')
    await db.unsafe(`alter table featherbase.person add column if not exists employee_code varchar(140)`)
    const asha = await makePerson({ full_name: 'Asha Kumar', username: 'asha.k' })
    const mail = await makePerson({ email: 'only.mail@x.test' })
    const coded = await makePerson({ full_name: 'Coded Person' })
    await db`update person set employee_code = 'RR-4242' where row_id = ${coded}`
    const pick = async (q: string) => (await admin.get<{ people: { row_id: string; label: string }[] }>(`/api/people/pick?q=${encodeURIComponent(q)}`)).people
    expect(await pick('asha')).toEqual([{ row_id: asha, label: 'Asha Kumar · @asha.k' }])
    expect(await pick('ASHA.K')).toEqual([{ row_id: asha, label: 'Asha Kumar · @asha.k' }])
    expect(await pick('only.mail')).toEqual([{ row_id: mail, label: 'only.mail@x.test' }])
    expect(await pick('rr-4242')).toEqual([{ row_id: coded, label: 'Coded Person · RR-4242' }])
    expect((await pick('admin')).map((p) => p.row_id)).not.toContain('Administrator')
  })

  test('the picker needs Person read and honours a Data Scope on Person', async ({ admin, createUser }) => {
    const a = await makePerson({ full_name: 'Scope Pick A' })
    await makePerson({ full_name: 'Scope Pick B' })
    const none = await createUser({ email: 'no.read@x.test' })
    await expect(none.get('/api/people/pick?q=scope')).rejects.toMatchObject({ status: 403 })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Pick Reader' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Pick Reader', can_read: true } })
    const reader = await createUser({ email: 'pick.reader@x.test', roles: ['Pick Reader'] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: reader.user, allow_table: 'Person', for_value: a } })
    expect((await reader.get<{ people: { row_id: string }[] }>('/api/people/pick?q=scope pick')).people.map((p) => p.row_id)).toEqual([a])
  })

  test('the token list names each owner', async ({ admin, createUser }) => {
    const p = await createUser({ email: 'token.owner@x.test', fullName: 'Token Owner' })
    const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-token-owner' })
    await admin.post('/api/access_tokens', { label: 'p', owner: p.user })
    await admin.post('/api/access_tokens', { label: 's', owner: svc.row_id })
    const { tokens } = await admin.get<{ tokens: { owner: string; owner_name: string }[] }>('/api/access_tokens')
    expect(tokens.find((t) => t.owner === p.user)?.owner_name).toBe('Token Owner')
    expect(tokens.find((t) => t.owner === svc.row_id)?.owner_name).toBe('svc-token-owner')
  })
})

describe('person-rename: review minors', () => {
  test('an opaque id is never renamed — a Service Account’s neither (A-m1)', async ({ admin }) => {
    const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-no-rename' })
    const { renameDoc } = await import('../src/document')
    await expect(renameDoc('Service Account', svc.row_id, 'svc_renamedaaaaaaaaaaaaa')).rejects.toMatchObject({ type: 'ValidationError' })
    const p = await makePerson({ full_name: 'No Rename' })
    await expect(renameDoc('Person', p, 'psn_renamedaaaaaaaaaaaaa')).rejects.toMatchObject({ type: 'ValidationError' })
  })

  test('an address is not a mention: name@gmail.com notifies nobody', async ({ admin }) => {
    const { mentionedNames } = await import('../src/controllers/comment')
    expect(mentionedNames('write to asha@gmail.com and @ravi.m, cc @[Asha Kumar]')).toEqual({ usernames: ['ravi.m'], names: ['asha kumar'] })
    void admin
  })

  test('an exclusion conflict no path mapped answers 409, not 500', async () => {
    const { errorResponse } = await import('../src/errors')
    const res = errorResponse({ json: (body: unknown, status: number) => ({ body, status }) } as never, Object.assign(new Error('x'), { code: '23P01' }))
    expect(res).toMatchObject({ status: 409, body: { error: { type: 'ConflictError' } } })
  })
})
