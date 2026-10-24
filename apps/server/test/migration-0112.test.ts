// Migration 0112 (#451): the direct-client login role `app_client` goes. A
// database converges its own objects — policies that targeted only the role
// hold every non-owner role instead, its grants are revoked — and the role is
// dropped unless another database on the cluster still depends on it, in which
// case it can no longer sign in. Runs inside the sandbox transaction, so the
// role changes below roll back with it.
import { readFileSync } from 'node:fs'
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'

const MIGRATION = readFileSync(new URL('../migrations/0112_drop_app_client_role.sql', import.meta.url), 'utf8')

async function thisDatabaseRefs(): Promise<number> {
  const [{ refs }] = await sql`select count(*)::int as refs from pg_shdepend d join pg_roles r on r.oid = d.refobjid
    where r.rolname = 'app_client' and d.dbid = (select oid from pg_database where datname = current_database())`
  return refs as number
}

describe('0112: the app_client role is retired', () => {
  test('retargets its policies, revokes its grants, and drops it or stops it signing in', async () => {
    const [existing] = await sql`select 1 from pg_roles where rolname = 'app_client'`
    if (!existing) await sql.unsafe('create role app_client nologin')
    await sql.unsafe(`create table featherbase.role_drop_probe (id int)`)
    await sql.unsafe(`alter table featherbase.role_drop_probe enable row level security`)
    await sql.unsafe(`create policy fc_select on featherbase.role_drop_probe for select to app_client using (true)`)
    await sql.unsafe(`grant select on featherbase.role_drop_probe to app_client`)
    expect(await thisDatabaseRefs()).toBeGreaterThan(0)

    await sql.unsafe(MIGRATION)

    expect(await thisDatabaseRefs()).toBe(0)
    expect(await sql`select polroles = '{0}'::oid[] as everyone from pg_policy
      where polrelid = 'featherbase.role_drop_probe'::regclass`).toEqual([{ everyone: true }])
    const role = await sql`select rolcanlogin, rolpassword from pg_authid where rolname = 'app_client'`
    // Dropped when nothing else on the cluster depends on it (always so in a
    // dedicated test cluster); otherwise it remains, unable to sign in.
    if (!existing) expect(role).toEqual([])
    else if (role.length) expect(role).toEqual([{ rolcanlogin: false, rolpassword: null }])
  })

  test('passes on a database where the role was never there, or owns nothing', async () => {
    await sql.unsafe(MIGRATION)
    await sql.unsafe(MIGRATION)
    expect(await thisDatabaseRefs()).toBe(0)
  })
})
