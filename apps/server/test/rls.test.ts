// NOT sandbox-migrated: verifies NATIVE Postgres RLS through a second
// connection under the app_client PG role — that connection can never see
// the sandbox's uncommitted transaction, so this file needs real commits.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { sql } from '../src/db'
import { areq } from './helpers'

// PERM-004: generated RLS. A direct client (the app_client PG role — the
// local stand-in for supabase-js/PostgREST) can SELECT only rows its
// session user has Permission read access to, and can never write. The app
// server (table owner) bypasses RLS and stays the only write path.

const DT = 'RLS Vault'
const CHILD = 'RLS Vault Item'
const SECRET_DT = 'RLS Hidden'
const ROLE = 'RLS Vault Reader'
const USER = 'rls-vault@x.com'

const direct = postgres(
  process.env.RLS_TEST_URL ?? 'postgres://app_client:app_client@127.0.0.1:5432/featherbase',
  { max: 1, onnotice: () => {} },
)

async function as(user: string | null) {
  await direct`select set_config('app.user', ${user ?? ''}, false)`
}

async function cleanup() {
  await sql`delete from permission where ref_table in (${DT}, ${SECRET_DT})`
  await sql`delete from has_role where parent = ${USER}`
  await sql`delete from "user" where row_id = ${USER}`
  await sql`delete from role where row_id = ${ROLE}`
  await sql`delete from table_def where name in (${DT}, ${CHILD}, ${SECRET_DT})`
  await sql`delete from column_def where parent in (${DT}, ${CHILD}, ${SECRET_DT})`
  await sql.unsafe('drop table if exists rls_vault, rls_vault_item, rls_hidden')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/table_def', {
    method: 'POST',
    body: JSON.stringify({
      name: CHILD,
      kind: 'sub_table',
      columns: [{ column_name: 'part', column_type: 'Data' }],
    }),
  })
  await areq('/api/table_def', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data' },
        { column_name: 'items', column_type: 'Sub-table', row_table: CHILD },
      ],
    }),
  })
  await areq('/api/table_def', {
    method: 'POST',
    body: JSON.stringify({ name: SECRET_DT, columns: [{ column_name: 'code', column_type: 'Data' }] }),
  })
  await areq('/api/save_row', {
    method: 'POST',
    body: JSON.stringify({ table: 'Role', row: { row_id: ROLE } }),
  })
  await areq('/api/save_row', {
    method: 'POST',
    body: JSON.stringify({
      table: 'User',
      row: { row_id: USER, email: USER, roles: [{ role: ROLE }] },
    }),
  })
  await areq('/api/save_row', {
    method: 'POST',
    body: JSON.stringify({
      table: 'Permission',
      row: { ref_table: DT, role: ROLE, tier: 'basic', can_read: true },
    }),
  })
  await areq('/api/save_row', {
    method: 'POST',
    body: JSON.stringify({
      table: DT,
      row: { title: 'w1', items: [{ part: 'p1' }, { part: 'p2' }] },
    }),
  })
  await areq('/api/save_row', {
    method: 'POST',
    body: JSON.stringify({ table: SECRET_DT, row: { code: 's3cret' } }),
  })
})

afterAll(async () => {
  await cleanup()
  await direct.end()
})

describe('PERM-004: generated RLS for direct clients', () => {
  it('permitted Table is selectable; child rows follow the parent perm', async () => {
    await as(USER)
    const rows = await direct`select title from rls_vault`
    expect(rows).toHaveLength(1)
    const children = await direct`select part from rls_vault_item order by part`
    expect(children.map((r) => r.part)).toEqual(['p1', 'p2'])
  })

  it('non-permitted Tables yield zero rows', async () => {
    await as(USER)
    expect(await direct`select * from rls_hidden`).toHaveLength(0)
    expect(await direct`select * from "user"`).toHaveLength(0)
  })

  it('an unauthenticated session (Guest) sees nothing', async () => {
    await as(null)
    expect(await direct`select * from rls_vault`).toHaveLength(0)
  })

  it('Administrator sees everything', async () => {
    await as('Administrator')
    expect(await direct`select * from rls_vault`).toHaveLength(1)
    expect(await direct`select * from rls_hidden`).toHaveLength(1)
  })

  it('every direct write is denied, even on the permitted table', async () => {
    await as(USER)
    await expect(
      direct`insert into rls_vault (row_id, title) values ('hack', 'x')`,
    ).rejects.toThrow(/permission denied/)
    await expect(direct`update rls_vault set title = 'x'`).rejects.toThrow(
      /permission denied/,
    )
    await expect(direct`delete from rls_vault`).rejects.toThrow(/permission denied/)
  })

  it('non-Table bookkeeping tables are not exposed at all', async () => {
    await as('Administrator')
    await expect(direct`select * from migration`).rejects.toThrow(/permission denied/)
  })
})
