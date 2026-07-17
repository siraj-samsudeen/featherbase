import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

const TARGET = 'Ls Target'
const ROLE = 'Ls Role'
const ALICE = 'ls-alice@x.com'
const BOB = 'ls-bob@x.com'

const tokens: Record<string, string> = {}
const as =
  (user: string) =>
  (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokens[user]}`,
        ...((init.headers as Record<string, string>) ?? {}),
      },
    })

// The exact query shape a Link autocomplete issues.
const searchQs = (q: string) =>
  `/api/resource/${encodeURIComponent(TARGET)}?${new URLSearchParams({
    filters: JSON.stringify([['name', 'like', `%${q}%`]]),
    fields: JSON.stringify(['name']),
    limit_page_length: '10',
  })}`

async function cleanup() {
  await sql`delete from tab_user_permission where "user" in (${ALICE}, ${BOB})`
  await sql`delete from tab_docperm where ref_doctype = ${TARGET}`
  for (const u of [ALICE, BOB]) {
    await sql`delete from tab_has_role where parent = ${u}`
    await sql`delete from tab_user where name = ${u}`
  }
  await sql`delete from tab_role where name = ${ROLE}`
  await sql`delete from tab_doctype where name = ${TARGET}`
  await sql.unsafe('drop table if exists tab_ls_target')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: TARGET,
      autoname: 'prompt',
      fields: [{ fieldname: 'note', fieldtype: 'Data' }],
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'Role', doc: { name: ROLE } }),
  })
  for (const u of [ALICE, BOB]) {
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'User',
        doc: { name: u, email: u, enabled: true, roles: [{ role: ROLE }] },
      }),
    })
    await setUserPassword(u, 'lspw123')
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr: u, pwd: 'lspw123' }),
    })
    tokens[u] = ((await login.json()) as { token: string }).token
  }
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('PERM-010: link-field search is permission-filtered', () => {
  it('no read permission -> search is 403, not an empty leak-free 200 pretending', async () => {
    expect((await as(ALICE)(searchQs('doc'))).status).toBe(403)
  })

  it('if_owner read -> search returns only own docs', async () => {
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'DocPerm',
        doc: { ref_doctype: TARGET, role: ROLE, if_owner: true, can_read: true, can_create: true },
      }),
    })
    await as(ALICE)(`/api/resource/${encodeURIComponent(TARGET)}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'doc-alice', note: 'a' }),
    })
    await as(BOB)(`/api/resource/${encodeURIComponent(TARGET)}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'doc-bob', note: 'b' }),
    })
    const res = (await (await as(ALICE)(searchQs('doc'))).json()) as {
      data: { name: string }[]
      total: number
    }
    expect(res.total).toBe(1)
    expect(res.data[0].name).toBe('doc-alice')
  })

  it('user permissions further restrict search results', async () => {
    // lift if_owner: grant unconditional read, then pin BOB to doc-alice only
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'DocPerm',
        doc: { ref_doctype: TARGET, role: ROLE, can_read: true },
      }),
    })
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'User Permission',
        doc: { user: BOB, allow: TARGET, for_value: 'doc-alice' },
      }),
    })
    const bobRes = (await (await as(BOB)(searchQs('doc'))).json()) as {
      data: { name: string }[]
      total: number
    }
    expect(bobRes.total).toBe(1)
    expect(bobRes.data[0].name).toBe('doc-alice')

    // alice (no user perms, unconditional read) sees both
    const aliceRes = (await (await as(ALICE)(searchQs('doc'))).json()) as { total: number }
    expect(aliceRes.total).toBe(2)
  })
})
