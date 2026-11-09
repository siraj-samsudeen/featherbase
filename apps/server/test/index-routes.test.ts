// HTTP routes in src/index.ts whose handlers are thin wiring over a module
// tested elsewhere: each test drives the route itself, so what is proven here
// is the route's own promise — its validation, its permission gate and the
// shape of its answer — not the module underneath.
import { afterEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { deleteStored } from '../src/storage'
import { requestPasswordReset } from '../src/password-reset'
import { _setInvitationHooksForTests } from '../src/invitation-email'
import { expectApiError, expectRefused, expectStatus, makePerson } from './fixtures'
import { configureDelegated, configureGoogle, linkDelegated, setPasswordMethod } from './identity-fixtures'

afterEach(() => _setInvitationHooksForTests(null))

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('invalid route arguments leave stored state alone', () => {
  test('an absent password cannot replace a person’s current password', async ({ admin }) => {
    const person = await makePerson({ full_name: 'Password shape' })
    await admin.post('/api/set_password', { user: person, password: 'shape-original-password' })
    const before = await sql`select password_hash from person where row_id = ${person}`
    await expectApiError(admin.post('/api/set_password', { user: person }), {
      status: 417, type: 'ValidationError', message: expect.stringContaining('Expected { password }'),
    })
    expect(await sql`select password_hash from person where row_id = ${person}`).toEqual(before)
  })

  test('missing identifier search terms are reported without revealing people', async ({ admin }) => {
    for (const query of ['', '?system=phone', '?value=9847012345']) {
      await expectApiError(admin.get(`/api/identifiers${query}`), {
        status: 417, type: 'ValidationError', fields: { system: 'required', value: 'required' },
        message: expect.stringContaining('Expected ?system=&value='),
      })
    }
  })

  test('truncated identifier edits retain the complete stored history', async ({ admin }) => {
    const person = await makePerson({ full_name: 'History shape' })
    const { identifier } = await admin.post<{ identifier: { id: string } }>(`/api/people/${person}/identifiers`, {
      system: 'phone', value: '9847012345', note: 'keep this note',
    })
    const before = await sql`select * from person_identifier where id = ${identifier.id}`
    const audit = await sql`select operation from activity_log where operation like ${`%${identifier.id}%`} order by row_id`
    const edit = await admin.fetch(`/api/identifiers/${identifier.id}`, { method: 'PATCH', body: '{"valid_to":' })
    await expectStatus(edit, 200)
    expect(await edit.json()).toMatchObject({ result: 'unchanged', identifier: { id: identifier.id } })
    const add = await admin.fetch(`/api/people/${person}/identifiers`, { method: 'POST', body: '{"system":' })
    await expectStatus(add, 404)
    expect(await add.json()).toMatchObject({ error: { type: 'NotFoundError', message: 'Identifier system  not found' } })
    expect(await sql`select * from person_identifier where person_id = ${person}`).toEqual(before)
    expect(await sql`select operation from activity_log where operation like ${`%${identifier.id}%`} order by row_id`).toEqual(audit)
  })

  test('truncated identity edits retain the existing linked sign-in', async ({ admin }) => {
    await configureDelegated()
    const person = await makePerson({ full_name: 'Identity shape' })
    const identity = await linkDelegated(person, 'shape-link')
    const before = await sql`select * from sign_in_identity where id = ${identity}`
    const response = await admin.fetch(`/api/identities/${identity}`, { method: 'PATCH', body: '{"person_id":' })
    await expectStatus(response, 200)
    expect(await response.json()).toMatchObject({ id: identity, person_id: person, sign_in_name: 'shape-link' })
    expect(await sql`select * from sign_in_identity where id = ${identity}`).toEqual(before)
  })

  test('a variable report refuses an unreadable key without returning fingerprints', async ({ admin }) => {
    const response = await admin.fetch('/api/instance-settings/variables', { method: 'POST', body: '{"key":' })
    await expectStatus(response, 417)
    const result = await response.json()
    expect(result).toMatchObject({ error: { type: 'ValidationError', fields: { key: 'at least 32 characters' } } })
    expect(result).not.toHaveProperty('variables')
    expect(result).not.toHaveProperty('key_id')
  })

  test('a report chart refuses truncated JSON before running any report', async ({ admin }) => {
    const response = await admin.fetch('/api/report_chart', { method: 'POST', body: '{"report":' })
    await expectStatus(response, 417)
    expect(await response.json()).toMatchObject({ error: { type: 'ValidationError', message: 'Expected { report }' } })
  })

  test('missing file references cannot mint a signed URL', async ({ admin }) => {
    await expectApiError(admin.get('/api/signed_url'), {
      status: 417, type: 'ValidationError', message: expect.stringContaining('Expected file_url'),
    })
    await expectApiError(admin.get('/api/signed_url?file_url=%2Fprivate%2Ffiles%2Fabsent'), {
      status: 404, type: 'NotFoundError', message: expect.stringContaining('File not found: /private/files/absent'),
    })
  })

  test('a missing person has no sign-in panel', async ({ admin }) => {
    await expectApiError(admin.get('/api/people/no-such-person/identities'), {
      status: 404, type: 'NotFoundError', message: expect.stringContaining('Person no-such-person not found'),
    })
  })

  test('Google linking cannot begin when the method disallows self-linking', async ({ createUser }) => {
    const person = await createUser({ email: 'link-disabled@x.test' })
    const before = await sql`select id from sign_in_identity where person_id = ${person.user}`
    for (const enabled of [true, false]) {
      await configureGoogle({ enabled, self_link: false })
      const response = await person.fetch('/api/oauth/google/link')
      await expectStatus(response, 403)
      expect(await response.json()).toMatchObject({ error: { type: 'PermissionError', message: 'Linking Google is not available' } })
      expect(response.headers.getSetCookie()).toEqual([])
      expect(await sql`select id from sign_in_identity where person_id = ${person.user}`).toEqual(before)
    }
  })

  test('a Table without a configured workflow offers no transitions', async ({ admin }) => {
    const person = await makePerson({ full_name: 'No workflow' })
    expect(await admin.get(`/api/workflow/Person/${person}`)).toEqual({ workflow: null })
  })

  test('open signup still refuses truncated JSON without creating a person or session', async ({ api }) => {
    await setPasswordMethod({ new_person: 'create' })
    const [before] = await sql`select (select count(*)::int from person) as people, (select count(*)::int from activity_log where operation = 'login') as logins`
    const response = await api.fetch('/api/signup', { method: 'POST', body: '{"username":' })
    await expectStatus(response, 417)
    expect(await response.json()).toMatchObject({ error: { type: 'ValidationError', fields: { username: 'invalid' } } })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(await sql`select (select count(*)::int from person) as people, (select count(*)::int from activity_log where operation = 'login') as logins`).toEqual([before])
  })

  test('truncated handoff JSON cannot issue a session or cookie', async ({ api }) => {
    const [before] = await sql`select count(*)::int as n from activity_log where operation = 'login'`
    const response = await api.fetch('/api/oauth/session', { method: 'POST', body: '{"code":' })
    await expectStatus(response, 401)
    expect(await response.json()).toMatchObject({ error: { type: 'AuthenticationError', message: 'Invalid or expired sign-in code' } })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(await sql`select count(*)::int as n from activity_log where operation = 'login'`).toEqual([before])
  })

  test('metadata route shape checks preserve the existing definition and values', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Route Shape', columns: [{ column_name: 'title', column_type: 'Data' }] })
    const row = await admin.post<{ row_id: string }>('/api/table/Route%20Shape', { title: 'kept' })
    for (const [method, path, body, message] of [
      ['POST', '/api/table_def/Route%20Shape/rename_column', { from: 'title', to: 7 }, 'Expected { from, to }'],
      ['PUT', '/api/table_def/Route%20Shape', { remove_columns: ['title', 7] }, 'remove_columns must be a list of column names'],
      ['POST', '/api/set_app_enabled', { name: 'other', enabled: 'false' }, 'Expected { name, enabled: boolean }'],
      ['POST', '/api/enqueue_job', {}, 'Expected { method }'],
      ['POST', '/api/access_tokens', { label: 'not issued', expires_at: 'not a date' }, 'expires_at must be an ISO date-time'],
    ] as const) {
      const response = await admin.fetch(path, { method, body: JSON.stringify(body) })
      await expectStatus(response, 417)
      expect(await response.json()).toMatchObject({ error: { type: 'ValidationError', message } })
    }
    expect(await admin.get(`/api/table/Route%20Shape/${row.row_id}`)).toMatchObject({ title: 'kept' })
    expect(await sql`select column_name from column_def where parent = 'Route Shape'`).toEqual([{ column_name: 'title' }])
    expect(await sql`select 1 from access_token where label = 'not issued'`).toHaveLength(0)
  })
})

describe('password reset through HTTP', () => {
  test('a reset link sets the new password, and a request without a key or password is refused', async ({ api, admin }) => {
    const person = (await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person', row: { email: 'routes.reset@x.com', full_name: 'Reset Route', enabled: true },
    })).row_id
    await admin.post('/api/set_password', { user: person, password: 'old-route-pw1' })
    const token = (await requestPasswordReset('routes.reset@x.com')) as string

    await expectApiError(api.post('/api/reset_password', { key: token }), {
      status: 417, type: 'ValidationError', message: expect.stringContaining('Expected { key, new_password }'),
    })
    expect(await api.post('/api/reset_password', { key: token, new_password: 'new-route-pw1' })).toEqual({ ok: true })
    const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'routes.reset@x.com', pwd: 'new-route-pw1' }) })
    await expectStatus(login, 200)
  })
})

describe('instance settings apply', () => {
  test('a request that is not the expected shape is refused naming each offending field', async ({ admin }) => {
    await expectApiError(admin.post('/api/instance-settings/apply', { file: {}, dry_run: 'yes', surprise: 1 }), {
      status: 417,
      type: 'ValidationError',
      fields: { dry_run: expect.any(String), body: expect.stringContaining('surprise') },
    })
    const notJson = await admin.fetch('/api/instance-settings/apply', { method: 'POST', body: 'not json' })
    await expectStatus(notJson, 417)
    expect(await notJson.json()).toMatchObject({ error: { fields: { body: expect.any(String) } } })
  })
})

describe('inviting a Google address', () => {
  test('an invitation email that cannot be prepared still answers 201 and reports the email as failed', async ({ admin }) => {
    await configureGoogle({ enabled: true })
    const person = await makePerson({ full_name: 'Invite Route' })
    _setInvitationHooksForTests({ beforeClaim: async () => { throw new Error('settings unavailable') } })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await admin.fetch(`/api/people/${encodeURIComponent(person)}/identities`, {
        method: 'POST', body: JSON.stringify({ method: 'google', email: 'invite.route@example.com' }),
      })
      await expectStatus(res, 201)
      expect(await res.json()).toMatchObject({
        invitation_email: { status: 'failed', error: 'The invitation email was not sent' },
        invitation_sent_at: null,
      })
      expect(logged.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('"type":"InternalError"')
    } finally {
      logged.mockRestore()
    }
    // The invite itself was kept.
    expect(await sql`select 1 from sign_in_identity where person_id = ${person} and pending_email = 'invite.route@example.com'`).toHaveLength(1)
  })
})

describe('removing one of my own sign-in methods', () => {
  test('a person with a password can remove a linked method, which ends that link', async ({ api, admin }) => {
    await configureDelegated()
    const person = await makePerson({ username: 'routes.unlink' })
    await admin.post('/api/set_password', { user: person, password: 'unlink-route-pw1' })
    const linked = await linkDelegated(person, 'tl_routes', { subject: 'RT-1' })
    const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'routes.unlink', pwd: 'unlink-route-pw1' }) })
    const { token } = (await login.json()) as { token: string }

    const res = await api.fetch(`/api/me/identities/${linked}`, { method: 'DELETE', headers: bearer(token) })
    await expectStatus(res, 200)
    expect(await res.json()).toEqual({ ok: true })
    const [row] = await sql`select ended_reason from sign_in_identity where id = ${linked}`
    expect(row.ended_reason).toBe('unlinked')
  })
})

describe('signed URLs for files', () => {
  async function upload(admin: TestClient, isPrivate: boolean) {
    const form = new FormData()
    form.append('file', new File(['route bytes'], 'route.txt', { type: 'text/plain' }))
    if (isPrivate) form.append('is_private', '1')
    const res = await admin.fetch('/api/upload_file', { method: 'POST', body: form })
    return ((await res.json()) as { file_url: string }).file_url
  }

  test('a private file attached to no row is signed after the File row itself is read', async ({ api, admin, createUser }) => {
    const url = await upload(admin, true)
    try {
      const { signed_url } = await admin.get<{ signed_url: string }>(`/api/signed_url?file_url=${encodeURIComponent(url)}`)
      expect(signed_url.startsWith(`${url}?`)).toBe(true)
      // The signed URL serves without a session.
      const served = await api.fetch(signed_url)
      await expectStatus(served, 200)
      expect(await served.text()).toBe('route bytes')
      const outsider = await createUser({ roles: [] })
      await expectRefused(outsider.get(`/api/signed_url?file_url=${encodeURIComponent(url)}`), 403)
    } finally {
      await deleteStored(url).catch(() => {})
    }
  })

  test('a public file needs no signature and is returned as it is', async ({ admin }) => {
    const url = await upload(admin, false)
    try {
      expect(await admin.get(`/api/signed_url?file_url=${encodeURIComponent(url)}`)).toEqual({ signed_url: url })
    } finally {
      await deleteStored(url).catch(() => {})
    }
  })
})

describe('customizations export and import', () => {
  test('a System Manager exports a Table’s custom fields and imports them back; anyone else is refused', async ({ admin, createUser }) => {
    await admin.post('/api/table_def', { name: 'Routes Cust', columns: [{ column_name: 'title', column_type: 'Data' }] })
    await admin.post('/api/save_row', {
      table: 'Custom Field',
      row: { row_id: 'Routes Cust-tag', dt: 'Routes Cust', column_name: 'tag', label: 'Tag', column_type: 'Data' },
    })
    const bundle = await admin.get<{ custom_fields: { column_name: string }[] }>('/api/export_customizations/Routes%20Cust')
    expect(bundle.custom_fields.map((f) => f.column_name)).toEqual(['tag'])

    await sql`delete from custom_field where row_id = 'Routes Cust-tag'`
    await admin.post('/api/import_customizations', bundle)
    expect(await sql`select column_name from custom_field where dt = 'Routes Cust'`).toEqual([{ column_name: 'tag' }])

    const clerk = await createUser({ roles: [] })
    await expectRefused(clerk.get('/api/export_customizations/Routes%20Cust'), 403)
    await expectRefused(clerk.post('/api/import_customizations', bundle), 403)
  })

  test('re-applying custom fields answers how many records it applied', async ({ admin, createUser }) => {
    const [{ n }] = await sql`select count(*)::int as n from custom_field`
    expect(await admin.post('/api/reapply_custom_fields', {})).toEqual({ ok: true, count: n })
    const clerk = await createUser({ roles: [] })
    await expectRefused(clerk.post('/api/reapply_custom_fields', {}), 403)
  })
})

describe('email routes', () => {
  test('a test email goes to the address given; without one it is refused', async ({ admin }) => {
    expect(await admin.post('/api/send_test_email', { to: 'routes.test@x.com' })).toEqual({ ok: true })
    const [mail] = await sql`select subject from email_sink where mail_to = 'routes.test@x.com'`
    expect(mail.subject).toBe('Test email from Featherbase')
    await expectApiError(admin.post('/api/send_test_email', {}), {
      status: 417, type: 'ValidationError', message: expect.stringContaining('Expected { to }'),
    })
  })

  test('queueing an email stores it for the worker with what was sent; without an address it is refused', async ({ admin, createUser }) => {
    const { name } = await admin.post<{ name: string }>('/api/queue_email', {
      to: 'routes.queue@x.com', subject: 'Queued by route', body: 'Hello',
    })
    const [row] = await sql`select recipient, subject, body, send_status from email_queue where row_id = ${name}`
    expect(row).toEqual({ recipient: 'routes.queue@x.com', subject: 'Queued by route', body: 'Hello', send_status: 'queued' })
    await expectApiError(admin.post('/api/queue_email', { subject: 'nobody' }), { status: 417, type: 'ValidationError' })
    const clerk = await createUser({ roles: [] })
    await expectRefused(clerk.post('/api/queue_email', { to: 'x@x.com' }), 403)
  })
})

describe('counting rows', () => {
  test('a filters parameter that is not JSON is refused', async ({ admin }) => {
    await expectApiError(admin.get('/api/table/Person:count?filters=not-json'), {
      status: 400, type: 'BadRequestError', message: expect.stringContaining('filters must be valid JSON'),
    })
  })
})
