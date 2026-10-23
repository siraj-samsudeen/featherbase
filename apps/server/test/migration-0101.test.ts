// Migration 0101 (person-rename) against a dev-shaped fixture: trial staff
// keyed by employee code, a Google person keyed by address, a #371 `usr_`
// person, and a service account still living in `person` with its token,
// role, data scope, share and rate limit. The test database is already
// migrated, so each test first puts back the pre-split shape inside its own
// rolled-back transaction, then runs the split and the re-id exactly as the
// migration does. The full chain on real dev data is the rehearsal
// (`cli people:plan --rehearse`).
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { classifyColumns, type ClassifiedColumn } from '../src/person-registry'
import { migratePersonRename, reidPrincipals, splitPrincipals } from '../src/person-rename-migration'

const USR = 'usr_0123456789abcdef0123'

async function preSplitShape() {
  await sql.unsafe(`
    alter table featherbase.person drop constraint person_id_namespace;
    alter table featherbase.person add column user_type varchar(140) not null default 'human';
    alter table featherbase.access_token drop constraint access_token_one_principal;
    alter table featherbase.access_token add column owner varchar(140);
    alter table featherbase.access_token drop column person, drop column service_account;
    alter table featherbase.data_scope drop constraint data_scope_one_principal;
    alter table featherbase.data_scope add column "user" varchar(140);
    alter table featherbase.data_scope drop column person, drop column service_account;
    alter table featherbase.share drop constraint share_one_principal;
    alter table featherbase.share add column "user" varchar(140);
    alter table featherbase.share drop column person, drop column service_account;
    alter table featherbase.has_role drop column person, drop column service_account;
    drop table featherbase.service_account;
    truncate featherbase.person_id_map;
  `)
  await sql`delete from column_def where parent in ('Data Scope', 'Share') and column_name in ('person', 'service_account')`
  await sql`delete from column_def where parent = 'Service Account'`
  await sql`delete from table_def where name = 'Service Account'`
  for (const table of ['Data Scope', 'Share'])
    await sql`insert into column_def ${sql({
      parent: table, position: 99, column_name: 'user', label: 'User', column_type: 'Reference', reference_table: 'Person',
      reqd: false, unique: false, read_only: false, hidden: false, in_list_view: true, tier: 'basic',
    } as unknown as Record<string, never>)}`
  invalidateMeta()

  const people: [string, string | null, string][] = [
    // row_id, email, user_type
    ['RR-7963', null, 'human'],
    ['21654', null, 'human'],
    ['siraj@jeyarama.com', 'siraj@jeyarama.com', 'human'],
    [USR, null, 'human'],
    ['svc-bot', null, 'service'],
  ]
  for (const [row_id, email, user_type] of people)
    await sql`insert into person (row_id, email, full_name, enabled, user_type, api_rate_limit)
      values (${row_id}, ${email}, ${row_id === 'svc-bot' ? 'Installer Bot' : row_id}, true, ${user_type}, ${row_id === 'svc-bot' ? 7 : null})`
  // Roles, through the child table the generic save writes.
  for (const [parent, role] of [['RR-7963', 'All'], ['svc-bot', 'System Manager']])
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${'hr-' + parent}, ${parent}, 'Person', 'roles', ${role})`
  // Tokens.
  await sql`insert into access_token (id, label, owner, token_hash) values ('tok_bot', 'bot', 'svc-bot', ${'a'.repeat(64)}), ('tok_rr', 'rr', 'RR-7963', ${'b'.repeat(64)})`
  // Data scope: a person row, a service-account row, and the conditional pair.
  await sql`insert into data_scope (row_id, "user", allow_table, for_value) values
    ('ds-1', 'RR-7963', 'Store', 'ATK'),
    ('ds-2', 'svc-bot', 'Store', 'KNP'),
    ('ds-3', 'siraj@jeyarama.com', 'Person', 'RR-7963'),
    ('ds-4', 'siraj@jeyarama.com', 'Employee Code', 'RR-7963')`
  await sql`insert into share (row_id, "user", share_table, share_name, read) values
    ('sh-1', 'svc-bot', 'Note', 'n-1', true),
    ('sh-2', '21654', 'Person', '21654', true),
    ('sh-3', '21654', 'Note', '21654', true)`
  // History, settings, JSON and the code / free-text columns that merely CONTAIN old ids.
  await sql`insert into comment (row_id, created_by, updated_by, ref_table, ref_name, content) values
    ('c-1', 'RR-7963', 'RR-7963', 'Person', '21654', 'RR-7963 asked 21654 about svc-bot')`
  await sql`insert into notification_log (row_id, for_user, subject, ref_table, ref_name, read) values
    ('n-1', '21654', 'RR-7963 mentioned you', 'Comment', 'c-1', false)`
  await sql`insert into activity_log (row_id, "user", operation) values ('a-1', 'RR-7963', 'login as RR-7963')`
  await sql`insert into user_settings ("user", table_name, settings) values ('RR-7963', 'Note', '{"pin":"21654"}')`
  await sql`insert into saved_view (row_id, created_by, updated_by, ref_table, label, filters) values
    ('sv-1', 'RR-7963', 'RR-7963', 'ToDo', 'mine', ${sql.json([['allocated_to', '=', 'RR-7963'], ['description', 'like', '%RR-7963%'], ['description', '=', 'RR-7963']])})`
  // A JavaScript expression naming an old id: free text, listed, never edited.
  await sql`insert into assignment_rule (row_id, ref_table, assign_condition) values ('ar-1', 'ToDo', 'doc.owner == "21654"')`
  await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by) values
    ('uid_rr', 'RR-7963', 'password', 'RR-7963', 'anisha', 'migration')
    on conflict do nothing`
  await sql`insert into password_reset (token, "user", expires_at) values ('pr-1', ${USR}, now() + interval '1 hour')`
}

async function columns(): Promise<ClassifiedColumn[]> {
  const c = await classifyColumns()
  expect(c.unclassified).toEqual([])
  return c.classified
}

async function migrated() {
  await preSplitShape()
  const moved = await splitPrincipals()
  const result = await reidPrincipals(await columns(), { serviceLabels: moved.serviceLabels })
  const id = (old: string) =>
    [...result.personMap, ...result.serviceMap].find((m) => m.old_id === old)?.new_id as string
  return { moved, result, id }
}

describe('migration 0101: person-rename', () => {
  test('a service account keeps its token, role, data scope, share and rate limit', async () => {
    const { id } = await migrated()
    const bot = id('svc-bot')
    expect(bot).toMatch(/^svc_[a-z2-7]{20}$/)
    // The name is the old id — a unique slug — not the copied full name (review A-m6).
    expect((await sql`select label, api_rate_limit::int as api_rate_limit from service_account where row_id = ${bot}`)).toEqual([{ label: 'svc-bot', api_rate_limit: 7 }])
    expect(await sql`select 1 from person where row_id in (${bot}, 'svc-bot')`).toHaveLength(0)
    expect(await sql`select person, service_account from access_token where id = 'tok_bot'`).toEqual([{ person: null, service_account: bot }])
    expect(await sql`select role, person, service_account from has_role where parent = ${bot}`).toEqual([
      { role: 'System Manager', person: null, service_account: bot },
    ])
    expect(await sql`select service_account, for_value from data_scope where row_id = 'ds-2'`).toEqual([{ service_account: bot, for_value: 'KNP' }])
    expect(await sql`select service_account from share where row_id = 'sh-1'`).toEqual([{ service_account: bot }])
    expect(await sql`select 1 from information_schema.columns where table_schema = 'featherbase' and table_name = 'person' and column_name = 'user_type'`).toHaveLength(0)
  })

  test('every person gets an opaque id; usr_ is converted; built-ins keep theirs; nothing registered keeps an old id', async () => {
    const { id, result } = await migrated()
    expect(result.conditionsNamingOldIds).toEqual([{ rule: 'ar-1', ids: ['21654'] }])
    expect(await sql`select assign_condition from assignment_rule where row_id = 'ar-1'`).toEqual([{ assign_condition: 'doc.owner == "21654"' }])
    for (const old of ['RR-7963', '21654', 'siraj@jeyarama.com', USR]) expect(id(old)).toMatch(/^psn_[a-z2-7]{20}$/)
    expect(result.personMap.map((m) => m.old_id)).not.toContain('Administrator')
    expect(await sql`select row_id from person where row_id in ('Administrator', 'Guest') order by row_id`).toHaveLength(2)
    expect(result.scan).toEqual([])
    const rr = id('RR-7963')
    const k = id('21654')
    // id columns follow
    expect(await sql`select person from access_token where id = 'tok_rr'`).toEqual([{ person: rr }])
    expect(await sql`select person from has_role where row_id = 'hr-RR-7963'`).toEqual([{ person: rr }])
    expect(await sql`select created_by from comment where row_id = 'c-1'`).toEqual([{ created_by: rr }])
    expect(await sql`select for_user from notification_log where row_id = 'n-1'`).toEqual([{ for_user: k }])
    expect(await sql`select "user" from activity_log where row_id = 'a-1'`).toEqual([{ user: rr }])
    expect(await sql`select "user" from user_settings where table_name = 'Note' and "user" = ${rr}`).toHaveLength(1)
    expect(await sql`select person_id from sign_in_identity where id = 'uid_rr'`).toEqual([{ person_id: rr }])
    expect(await sql`select "user" from password_reset where token = 'pr-1'`).toEqual([{ user: id(USR) }])
    // conditional ids follow only under Person
    expect(await sql`select for_value from data_scope where row_id in ('ds-3', 'ds-4') order by row_id`).toEqual([
      { for_value: rr },
      { for_value: 'RR-7963' },
    ])
    expect(await sql`select share_name from share where row_id in ('sh-2', 'sh-3') order by row_id`).toEqual([
      { share_name: k },
      { share_name: '21654' },
    ])
    expect(await sql`select ref_name from comment where row_id = 'c-1'`).toEqual([{ ref_name: k }])
    // JSON: leaves equal to an old id follow; a substring does not
    const [view] = await sql`select filters from saved_view where row_id = 'sv-1'`
    // Only a principal column's value follows; an exact old id under any
    // other column is left alone (review A-m3).
    expect(view.filters).toEqual([['allocated_to', '=', rr], ['description', 'like', '%RR-7963%'], ['description', '=', 'RR-7963']])
    // codes and free text keep the old values untouched
    expect(await sql`select subject from sign_in_identity where id = 'uid_rr'`).toEqual([{ subject: 'RR-7963' }])
    expect(await sql`select content from comment where row_id = 'c-1'`).toEqual([{ content: 'RR-7963 asked 21654 about svc-bot' }])
    expect(await sql`select subject from notification_log where row_id = 'n-1'`).toEqual([{ subject: 'RR-7963 mentioned you' }])
    expect(await sql`select operation from activity_log where row_id = 'a-1'`).toEqual([{ operation: 'login as RR-7963' }])
    // the map is written, and every principal FK still exists and holds
    expect(await sql`select count(*)::int as n from person_id_map`).toEqual([{ n: 5 }])
    const fks = await sql`select conname from pg_constraint where conname in
      ('access_token_person_fkey', 'access_token_service_account_fkey', 'data_scope_person_fkey', 'share_person_fkey',
       'has_role_person_fkey', 'has_role_service_account_fkey') and condeferrable`
    expect(fks).toHaveLength(6)
    await sql`set constraints all immediate`
  })

  test('the re-id runs with the principal foreign keys live: the key changes before its references, checked together', async () => {
    await preSplitShape()
    await splitPrincipals()
    // A key changed alone breaks a deferred FK at the check, not before.
    await sql`select set_config('featherbase.allow_person_id_change', 'on', true)`
    await expect(
      sql.begin(async (tx) => {
        await tx`set constraints all deferred`
        await tx`update person set row_id = 'psn_aaaaaaaaaaaaaaaaaaaa' where row_id = 'RR-7963'`
        await tx`set constraints all immediate`
      }),
    ).rejects.toThrow(/foreign key/)
  })

  test('the scan aborts on an old id a handler missed — a plain id column and each conditional pair', async () => {
    for (const missed of [
      (c: ClassifiedColumn) => c.relation === 'comment' && c.column === 'created_by',
      (c: ClassifiedColumn) => c.relation === 'data_scope' && c.column === 'for_value',
      (c: ClassifiedColumn) => c.relation === 'share' && c.column === 'share_name',
    ]) {
      await expect(
        sql.begin(async () => {
          await preSplitShape()
          await splitPrincipals()
          const all = await columns()
          await reidPrincipals(all, { rewrite: all.filter((c) => !missed(c)) })
        }),
      ).rejects.toThrow(/old ids survive/)
    }
  })

  test('a data scope row naming no account aborts the split (never fail-open)', async () => {
    await preSplitShape()
    await sql`insert into data_scope (row_id, "user", allow_table, for_value) values ('ds-ghost', 'nobody', 'Store', 'ATK')`
    await expect(sql.begin(() => splitPrincipals())).rejects.toThrow(/ds-ghost → nobody/)
  })

  test('running it again changes nothing', async () => {
    const again = await migratePersonRename()
    expect(again.alreadyApplied).toBe(true)
  })
})
