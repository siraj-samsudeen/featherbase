import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

const DT = 'Own Note'
const ROLE = 'Own Role'
const ALICE = 'own-alice@x.com'
const BOB = 'own-bob@x.com'

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

async function cleanup() {
  await sql`delete from tab_docperm where ref_doctype = ${DT}`
  for (const u of [ALICE, BOB]) {
    await sql`delete from tab_has_role where parent = ${u}`
    await sql`delete from tab_user where name = ${u}`
  }
  await sql`delete from tab_role where name = ${ROLE}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_own_note')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: DT, fields: [{ fieldname: 't', fieldtype: 'Data' }] }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'Role', doc: { name: ROLE } }),
  })
  // if_owner grant: read/write/create/delete only on own docs
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'DocPerm',
      doc: {
        ref_doctype: DT,
        role: ROLE,
        if_owner: true,
        can_read: true,
        can_write: true,
        can_create: true,
        can_delete: true,
      },
    }),
  })
  for (const u of [ALICE, BOB]) {
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'User',
        doc: { name: u, email: u, enabled: true, roles: [{ role: ROLE }] },
      }),
    })
    await setUserPassword(u, 'ownpw12')
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr: u, pwd: 'ownpw12' }),
    })
    tokens[u] = ((await login.json()) as { token: string }).token
  }
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('PERM-007: if_owner permissions', () => {
  it('users see only their own docs in lists and detail; cannot touch others', async () => {
    const alice = as(ALICE)
    const bob = as(BOB)

    const mine = (await (
      await alice(`/api/resource/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ t: 'alice doc' }),
      })
    ).json()) as Record<string, unknown>
    expect(mine.owner).toBe(ALICE)
    await bob(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ t: 'bob doc' }),
    })

    // List: alice sees exactly her one doc
    const list = (await (
      await alice(
        `/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name","owner"]')}`,
      )
    ).json()) as { data: { owner: string }[]; total: number }
    expect(list.total).toBe(1)
    expect(list.data[0].owner).toBe(ALICE)

    // Detail: own doc 200, other's 403
    expect((await alice(`/api/resource/${encodeURIComponent(DT)}/${mine.name}`)).status).toBe(200)
    const bobList = (await (
      await bob(`/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name"]')}`)
    ).json()) as { data: { name: string }[] }
    const bobDoc = bobList.data[0].name
    expect((await alice(`/api/resource/${encodeURIComponent(DT)}/${bobDoc}`)).status).toBe(403)

    // Write/delete on other's doc 403; on own doc allowed
    expect(
      (
        await alice(`/api/resource/${encodeURIComponent(DT)}/${bobDoc}`, {
          method: 'PUT',
          body: JSON.stringify({ modified: new Date().toISOString(), t: 'hax' }),
        })
      ).status,
    ).toBe(403)
    expect(
      (await alice(`/api/resource/${encodeURIComponent(DT)}/${bobDoc}`, { method: 'DELETE' }))
        .status,
    ).toBe(403)
    const own = (await (
      await alice(`/api/resource/${encodeURIComponent(DT)}/${mine.name}`)
    ).json()) as Record<string, unknown>
    expect(
      (
        await alice(`/api/resource/${encodeURIComponent(DT)}/${mine.name}`, {
          method: 'PUT',
          body: JSON.stringify({ modified: own.modified, t: 'mine v2' }),
        })
      ).status,
    ).toBe(200)
    expect(
      (await alice(`/api/resource/${encodeURIComponent(DT)}/${mine.name}`, { method: 'DELETE' }))
        .status,
    ).toBe(200)
  })

  it('an unconditional grant overrides if_owner rows', async () => {
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'DocPerm',
        doc: { ref_doctype: DT, role: ROLE, can_read: true },
      }),
    })
    const list = (await (
      await as(ALICE)(
        `/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name","owner"]')}`,
      )
    ).json()) as { total: number }
    expect(list.total).toBeGreaterThanOrEqual(1) // sees bob's doc now too
  })
})
