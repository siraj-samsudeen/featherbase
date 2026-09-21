import { describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { qualifyPlatformSql } from '../src/platform-schema'

describe('platform SQL relation mapping', () => {
  // @spec platform_storage_is_explicit.fresh_and_upgrade_converge_to_same_shape
  it('PKG-R5: a fresh install owns core storage and hardened functions while public retains only the site registry', async () => {
    const [shape] = await sql`
      select to_regclass('featherbase.table_def') is not null as core,
        to_regclass('public.table_def') is null as no_legacy_core,
        to_regclass('public.site') is not null as site_registry,
        to_regclass('featherbase.site') is null as no_core_site,
        has_schema_privilege('app_client', 'featherbase', 'usage') as client_usage,
        not has_schema_privilege('app_client', 'featherbase', 'create') as no_client_create`
    expect(shape).toEqual({
      core: true,
      no_legacy_core: true,
      site_registry: true,
      no_core_site: true,
      client_usage: true,
      no_client_create: true,
    })

    const functions = await sql`
      select p.proname, p.prosecdef, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'featherbase'
        and p.proname in ('fc_session_user', 'fc_has_read')
      order by p.proname`
    expect(functions).toEqual([
      { proname: 'fc_has_read', prosecdef: true, proconfig: ['search_path=pg_catalog'] },
      { proname: 'fc_session_user', prosecdef: false, proconfig: ['search_path=pg_catalog'] },
    ])
  })

  it('qualifies core relation operands without changing values, comments, or app relations', () => {
    const input = `
      select u.row_id from "user" u
      join role r on r.row_id = 'role'
      join tasker.task t on true
      where u.full_name = 'from user'
      -- from permission
      /* join table_def */`
    expect(qualifyPlatformSql(input)).toBe(`
      select u.row_id from "featherbase"."user" u
      join "featherbase".role r on r.row_id = 'role'
      join tasker.task t on true
      where u.full_name = 'from user'
      -- from permission
      /* join table_def */`)
  })

  it('routes runtime action results to private platform storage without capturing app relations', () => {
    const mapped = qualifyPlatformSql(`
      select r.result, t.title
      from runtime_action_result r
      join tasker.task t on true`)

    expect(mapped).toBe(`
      select r.result, t.title
      from "featherbase".runtime_action_result r
      join tasker.task t on true`)
    expect(mapped).not.toContain('public.runtime_action_result')
  })

  it('qualifies DDL targets and references but leaves the public site registry explicit', () => {
    expect(qualifyPlatformSql(
      'create table if not exists role (id text references "user"); create unique index role_id on role(id); select * from public.site',
    )).toBe(
      'create table if not exists "featherbase".role (id text references "featherbase"."user"); create unique index role_id on "featherbase".role(id); select * from public.site',
    )
  })
})
