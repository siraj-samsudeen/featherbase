// #1336: secrets live only in credential tables.
//
// The warehouse copies Featherbase's own tables out of the `featherbase`
// schema (rama_dw pg_md_cdc/registrations/featherbase.yml: every user Table,
// plus the system tables it names under `system_tables`). Naming one more
// system table there is a one-line change, so a secret in ANY table of the
// platform schema is one line from leaving Featherbase. The list checked here
// is therefore every table the migrations create in that schema (the same set
// as PLATFORM_RELATIONS in src/platform-schema.ts, plus each system Table's
// storage), not only the ones copied today.
//
// A credential table is never copied (rama_dw denies it) and is never a Table:
// no table_def row names it, so the Admin, /api/table and the MCP, which all
// reach rows through a Table, cannot reach it.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'
import { setUserPassword } from '../src/auth'
import { removeOwnPassword } from '../src/identities'
import { PLATFORM_SCHEMA, qualifyPlatformSql, tableName } from '../src/platform-schema'
import { expectStatus } from './fixtures'

const CREDENTIAL_TABLES = ['access_token', 'agent_auth_code', 'agent_refresh_token', 'password_invite', 'password_reset', 'person_credential']

// Each still holds a secret outside a credential table; each names the issue that removes it.
const KNOWN_EXCEPTIONS: Record<string, string> = {
  'person.password_hash': '#1338: the second step of #1336 drops it; the server no longer reads it',
  'webhook.webhook_secret': '#1337',
}

// `*_hash`, `*_secret`, `*token*`, `*password*`.
const LOOKS_SECRET = /(_hash|_secret)$|token|password/

describe('#1336: a secret lives only in a credential table', () => {
  test('no table of the platform schema holds a secret-looking column outside the credential tables', async () => {
    const columns = await sql`
      select c.table_name, c.column_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = ${PLATFORM_SCHEMA} order by 1, 2`
    const found = columns
      .filter((c) => LOOKS_SECRET.test(String(c.column_name)) && !CREDENTIAL_TABLES.includes(String(c.table_name)))
      .map((c) => `${c.table_name}.${c.column_name}`)
    // Exactly the named exceptions: a new one fails, and a fixed one must leave the list.
    expect(found).toEqual(Object.keys(KNOWN_EXCEPTIONS).sort())
  })

  test('every credential table exists, is a platform relation, and no Table names it', async () => {
    const tables = (await sql`select table_name from information_schema.tables where table_schema = ${PLATFORM_SCHEMA}`)
      .map((r) => String(r.table_name))
    const named = new Set((await sql`select name, physical_relation from table_def`)
      .flatMap((d) => [tableName(String(d.name)), String(d.physical_relation ?? '')]))
    for (const table of CREDENTIAL_TABLES) {
      expect(tables, table).toContain(table)
      expect(qualifyPlatformSql(`select 1 from ${table}`), table).toBe(`select 1 from ${PLATFORM_SCHEMA}.${table}`)
      expect(named.has(table), table).toBe(false)
    }
  })

  test('person_credential cannot be reached as a Table, or taken by one', async ({ admin }) => {
    await expectStatus(await admin.fetch('/api/table/Person%20Credential'), 404)
    await expect(
      createTable({ name: 'Person Credential', columns: [{ column_name: 'label', column_type: 'Data' }] }),
    ).rejects.toMatchObject({ type: 'ConflictError' })
  })

  // #1336 step one keeps person.password_hash in step until #1338 drops it:
  // rolled back to the server before #1336, every password still works.
  test('a password set by this server is also in the column the server before #1336 reads', async ({ admin }) => {
    const person = (await admin.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { email: 'rollback-1336@example.com' } })).row_id
    const both = async () => (await sql`select p.password_hash as old_home,
      (select c.password_hash from person_credential c where c.person_id = p.row_id) as new_home
      from person p where p.row_id = ${person}`)[0]
    await setUserPassword(person, 'rollback-pw-1')
    const set = await both()
    expect(set.new_home).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
    expect(set.old_home).toBe(set.new_home)
    // An Admin save of the person writes nothing to either.
    const row = await admin.get<Record<string, unknown>>(`/api/table/Person/${person}`)
    await admin.fetch(`/api/table/Person/${person}`, { method: 'PUT', body: JSON.stringify({ updated_at: row.updated_at, full_name: 'Rolled Back' }) })
    expect(await both()).toEqual(set)
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('uid_rollback_1336', ${person}, 'google', 'g-rollback-1336', 'rollback-1336@example.com', 'self')`
    await removeOwnPassword(person)
    expect(await both()).toEqual({ old_home: null, new_home: null })
  })
})
