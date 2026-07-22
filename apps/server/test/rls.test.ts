// NOT sandbox-migrated: verifies NATIVE Postgres RLS through a second
// connection under the desk_client PG role — that connection can never see
// the sandbox's uncommitted transaction, so this file needs real commits.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { sql } from '../src/db'
import { areq } from './helpers'

// PERM-004: generated RLS. A direct client (the desk_client PG role — the
// local stand-in for supabase-js/PostgREST) can SELECT only rows its
// session user has DocPerm read access to, and can never write. The app
// server (table owner) bypasses RLS and stays the only write path.

const DT = 'RLS Vault'
const CHILD = 'RLS Vault Item'
const SECRET_DT = 'RLS Hidden'
const ROLE = 'RLS Vault Reader'
const USER = 'rls-vault@x.com'

const direct = postgres(
  process.env.RLS_TEST_URL ?? 'postgres://desk_client:desk_client@127.0.0.1:5432/featherbase',
  { max: 1, onnotice: () => {} },
)

async function as(user: string | null) {
  await direct`select set_config('app.user', ${user ?? ''}, false)`
}

async function cleanup() {
  await sql`delete from tab_docperm where ref_doctype in (${DT}, ${SECRET_DT})`
  await sql`delete from tab_has_role where parent = ${USER}`
  await sql`delete from tab_user where name = ${USER}`
  await sql`delete from tab_role where name = ${ROLE}`
  await sql`delete from tab_doctype where name in (${DT}, ${CHILD}, ${SECRET_DT})`
  await sql`delete from tab_docfield where parent in (${DT}, ${CHILD}, ${SECRET_DT})`
  await sql.unsafe('drop table if exists tab_rls_vault, tab_rls_vault_item, tab_rls_hidden')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: CHILD,
      istable: true,
      fields: [{ fieldname: 'part', fieldtype: 'Data' }],
    }),
  })
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data' },
        { fieldname: 'items', fieldtype: 'Table', options: CHILD },
      ],
    }),
  })
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: SECRET_DT, fields: [{ fieldname: 'code', fieldtype: 'Data' }] }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'Role', doc: { name: ROLE } }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User',
      doc: { name: USER, email: USER, roles: [{ role: ROLE }] },
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'DocPerm',
      doc: { ref_doctype: DT, role: ROLE, permlevel: 0, can_read: true },
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: DT,
      doc: { title: 'w1', items: [{ part: 'p1' }, { part: 'p2' }] },
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: SECRET_DT, doc: { code: 's3cret' } }),
  })
})

afterAll(async () => {
  await cleanup()
  await direct.end()
})

describe('PERM-004: generated RLS for direct clients', () => {
  it('permitted DocType is selectable; child rows follow the parent perm', async () => {
    await as(USER)
    const rows = await direct`select title from tab_rls_vault`
    expect(rows).toHaveLength(1)
    const children = await direct`select part from tab_rls_vault_item order by part`
    expect(children.map((r) => r.part)).toEqual(['p1', 'p2'])
  })

  it('non-permitted DocTypes yield zero rows', async () => {
    await as(USER)
    expect(await direct`select * from tab_rls_hidden`).toHaveLength(0)
    expect(await direct`select * from tab_user`).toHaveLength(0)
  })

  it('an unauthenticated session (Guest) sees nothing', async () => {
    await as(null)
    expect(await direct`select * from tab_rls_vault`).toHaveLength(0)
  })

  it('Administrator sees everything', async () => {
    await as('Administrator')
    expect(await direct`select * from tab_rls_vault`).toHaveLength(1)
    expect(await direct`select * from tab_rls_hidden`).toHaveLength(1)
  })

  it('every direct write is denied, even on the permitted table', async () => {
    await as(USER)
    await expect(
      direct`insert into tab_rls_vault (name, title) values ('hack', 'x')`,
    ).rejects.toThrow(/permission denied/)
    await expect(direct`update tab_rls_vault set title = 'x'`).rejects.toThrow(
      /permission denied/,
    )
    await expect(direct`delete from tab_rls_vault`).rejects.toThrow(/permission denied/)
  })

  it('non-DocType bookkeeping tables are not exposed at all', async () => {
    await as('Administrator')
    await expect(direct`select * from migration`).rejects.toThrow(/permission denied/)
  })
})
