import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// Frappe wire-format compatibility: sid-cookie sessions, /api/method/login,
// exc_type on error bodies, and the frappe.client.* RPC namespace — so
// Frappe-style clients (frappe-js-sdk, documented curl recipes) work against
// the clone unchanged.

const DT = 'Compat Note'

async function makeDT(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data', reqd: true },
      { fieldname: 'status', fieldtype: 'Select', options: 'Open\nDone', default_value: 'Open' },
    ],
  })
}

describe('Frappe compat: sid-cookie sessions', () => {
  test('/api/method/login answers in Frappe shape and sets an HttpOnly sid cookie', async ({
    api,
  }) => {
    const res = await api.fetch('/api/method/login', {
      method: 'POST',
      body: JSON.stringify({ usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { message: string; full_name: string; home_page: string }
    expect(body.message).toBe('Logged In')
    expect(body.home_page).toBe('/desk')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('sid=')
    expect(cookie).toContain('HttpOnly')
  })

  test('the sid cookie alone authenticates API requests; logout clears it', async ({ api }) => {
    const login = await api.fetch('/api/method/login', {
      method: 'POST',
      body: JSON.stringify({ usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
    })
    const sid = (login.headers.get('set-cookie') ?? '').match(/sid=([^;]+)/)?.[1]
    expect(sid).toBeTruthy()

    // No Authorization header — only the cookie.
    const res = await api.fetch('/api/resource/Role', { headers: { cookie: `sid=${sid}` } })
    expect(res.status).toBe(200)

    const out = await api.fetch('/api/method/logout', { method: 'POST' })
    expect((out.headers.get('set-cookie') ?? '')).toContain('sid=;')

    // Without any credential the same call is refused.
    const anon = await api.fetch('/api/resource/Role')
    expect(anon.status).toBe(401)
  })
})

describe('Frappe compat: exc_type error envelope', () => {
  test('errors carry Frappe exception names alongside the native envelope', async ({
    admin,
    client,
  }) => {
    await makeDT(admin)
    const missing = await admin.fetch(`/api/resource/${encodeURIComponent(DT)}/nope`)
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { exc_type: string }).exc_type).toBe('DoesNotExistError')

    const invalid = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, doc: {} }),
    })
    expect(invalid.status).toBe(417)
    expect(((await invalid.json()) as { exc_type: string }).exc_type).toBe('ValidationError')

    // `client` holds no role with read on DT.
    const forbidden = await client.fetch(`/api/resource/${encodeURIComponent(DT)}`)
    expect(forbidden.status).toBe(403)
    expect(((await forbidden.json()) as { exc_type: string }).exc_type).toBe('PermissionError')
  })
})

describe('Frappe compat: frappe.client.* RPC namespace', () => {
  test('insert / get / get_list / get_count / get_value / set_value / delete round-trip', async ({
    admin,
  }) => {
    await makeDT(admin)
    const inserted = await admin.post<{ message: { name: string } }>(
      '/api/method/frappe.client.insert',
      { doc: { doctype: DT, title: 'first' } },
    )
    const name = inserted.message.name
    expect(name).toBeTruthy()

    const got = await admin.post<{ message: { title: string } }>('/api/method/frappe.client.get', {
      doctype: DT,
      name,
    })
    expect(got.message.title).toBe('first')

    const listed = await admin.post<{ message: { name: string }[] }>(
      '/api/method/frappe.client.get_list',
      { doctype: DT, fields: ['name', 'title'], filters: [['title', '=', 'first']] },
    )
    expect(listed.message.map((r) => r.name)).toContain(name)

    const count = await admin.post<{ message: number }>('/api/method/frappe.client.get_count', {
      doctype: DT,
    })
    expect(count.message).toBe(1)

    const value = await admin.post<{ message: { status: string } }>(
      '/api/method/frappe.client.get_value',
      { doctype: DT, filters: name, fieldname: 'status' },
    )
    expect(value.message.status).toBe('Open')

    const set = await admin.post<{ message: { status: string } }>(
      '/api/method/frappe.client.set_value',
      { doctype: DT, name, fieldname: 'status', value: 'Done' },
    )
    expect(set.message.status).toBe('Done')

    const del = await admin.post<{ message: string }>('/api/method/frappe.client.delete', {
      doctype: DT,
      name,
    })
    expect(del.message).toBe('ok')
    await expect(
      admin.post('/api/method/frappe.client.get', { doctype: DT, name }),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('GET calls parse JSON query params, frappe.ping allows guests, sessions are required otherwise', async ({
    admin,
    api,
  }) => {
    await makeDT(admin)
    await admin.post('/api/save_doc', { doctype: DT, doc: { title: 'q' } })
    const viaGet = await admin.get<{ message: { title: string }[] }>(
      `/api/method/frappe.client.get_list?doctype=${encodeURIComponent(DT)}&fields=${encodeURIComponent(
        '["title"]',
      )}`,
    )
    expect(viaGet.message.some((r) => r.title === 'q')).toBe(true)

    const ping = await api.get<{ message: string }>('/api/method/frappe.ping')
    expect(ping.message).toBe('pong')

    await expect(
      api.post('/api/method/frappe.client.get_list', { doctype: DT }),
    ).rejects.toMatchObject({ status: 401 })
  })

  test('get_value: numeric-looking docnames and dict filters both resolve', async ({
    admin,
  }) => {
    // Hash names are hex and can come out all-digits; a docname string like
    // "1234567890" must not be JSON-parsed into a number and misread as a
    // filter list. Pin it with prompt naming.
    await admin.post('/api/doctype', {
      name: DT + ' Prompt',
      autoname: 'prompt',
      fields: [{ fieldname: 'title', fieldtype: 'Data' }],
    })
    await admin.post('/api/save_doc', {
      doctype: DT + ' Prompt',
      doc: { name: '1234567890', title: 'numeric name' },
    })
    const byName = await admin.post<{ message: { title: string } }>(
      '/api/method/frappe.client.get_value',
      { doctype: DT + ' Prompt', filters: '1234567890', fieldname: 'title' },
    )
    expect(byName.message.title).toBe('numeric name')

    // Frappe's dict filter form.
    const byDict = await admin.post<{ message: { name: string } }>(
      '/api/method/frappe.client.get_value',
      { doctype: DT + ' Prompt', filters: { title: 'numeric name' }, fieldname: 'name' },
    )
    expect(byDict.message.name).toBe('1234567890')
  })

  test('get_doctype returns the meta bundle with child-table metas', async ({ admin }) => {
    await admin.post('/api/doctype', {
      name: DT + ' Child',
      istable: true,
      fields: [{ fieldname: 'note', fieldtype: 'Data' }],
    })
    await admin.post('/api/doctype', {
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data' },
        { fieldname: 'rows', fieldtype: 'Table', options: DT + ' Child' },
      ],
    })
    const bundle = await admin.post<{
      message: { doctype: { name: string }; child_doctypes: { name: string }[] }
    }>('/api/method/frappe.client.get_doctype', { doctype: DT })
    expect(bundle.message.doctype.name).toBe(DT)
    expect(bundle.message.child_doctypes.map((c) => c.name)).toEqual([DT + ' Child'])
  })
})
