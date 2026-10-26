// Migration 0100 (person-identities) against a dev-shaped fixture: roster
// staff with placeholder emails and StyleHR login IDs (one shared), a Google
// user, a real-email user who never used Google, a service account. The test
// database is already migrated, so each test first puts back the pre-upgrade
// shape inside its own rolled-back transaction.
import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { formatPlan, migratePersonIdentities, planPersonIdentities } from '../src/person-identities-migration'
import { pre0101Shape } from './person-migration-fixtures'

// 0100 runs before 0101 (person-rename), so the pre-0101 names are put back
// first (inside the same rolled-back transaction) and 0100 is proven against
// the shape it actually ran on. The chain 0100 → 0101 on real data is proven
// by `cli people:plan --rehearse` against a dev snapshot.
async function preUpgradeShape() {
  await pre0101Shape()
  await sql`delete from user_identity`
  await sql`delete from sign_in_method where kind = 'delegated_password' or row_id = 'google'`
  await sql`update "user" set email = 'admin@example.com' where row_id = 'Administrator'`
  await sql`alter table "user" add column if not exists stylehr_username varchar(140)`
  // 0100 drops social_login after reading it; the pre-upgrade shape has it.
  await sql`alter table "user" add column if not exists social_login varchar(140)`
  await sql`alter table "user" add column if not exists employee_code varchar(140)`
  for (const [field, value] of [
    ['delegated_login_label', 'StyleHR'],
    ['delegated_login_url', 'https://stylehr.example.test/api/login/'],
    ['delegated_login_user_column', 'stylehr_username'],
    ['allowed_login_domains', 'jeyarama.com'],
  ])
    await sql`insert into single_value (table_name, field, value) values ('System Settings', ${field}, ${value})
      on conflict (table_name, field) do update set value = excluded.value`
  const rows: [string, string | null, string | null, string | null, string | null][] = [
    // row_id, email, stylehr_username, employee_code, social_login
    ['RR-0101', 'rr-0101@staff.jeyarama.invalid', 'devi_1000000001', 'RR-0101', null],
    ['30654', '30654@staff.jeyarama.invalid', 'kumar_99', '30654', null],
    ['RR-8001', 'rr-8001@staff.jeyarama.invalid', 'shared_login', 'RR-8001', null],
    ['RR-8002', 'rr-8002@staff.jeyarama.invalid', 'SHARED_LOGIN ', 'RR-8002', null],
    ['RR-9000', 'sm.atk@jeyarama.com', 'sm_atk', 'RR-9000', null],
    ['owner@jeyarama.com', ' Owner@Jeyarama.com ', null, null, 'google'],
    // Google users found by their id before (review A-M3): no email, and a differing one.
    ['admitted@jeyarama.com', null, null, null, 'google'],
    ['alias@jeyarama.com', 'alias.r@jeyarama.com', null, null, 'google'],
    ['svc-bot', 'svc-bot@service.invalid', 'bot_login', null, null],
    // A store mailbox with no other way in: Google by email only today.
    ['SM-cbe', 'sm.cbe@jeyarama.com', null, 'SM-cbe', null],
  ]
  for (const [row_id, email, login, code, social] of rows) {
    await sql`insert into "user" (row_id, email, full_name, enabled, stylehr_username, employee_code, social_login, user_type, created_at, updated_at)
      values (${row_id}, ${email}, ${row_id}, true, ${login}, ${code}, ${social}, ${row_id.startsWith('svc-') ? 'service' : 'human'}, now(), now())
      on conflict (row_id) do nothing`
  }
}

describe('migration 0100: person + linked identities', () => {
  test('every person is migrated or listed, with nothing invented kept', async () => {
    await preUpgradeShape()
    const report = await migratePersonIdentities()
    console.log(formatPlan(report))

    expect(report.methods.map((m) => m.key)).toContain('stylehr')
    const [hr] = await sql`select enabled, settings from sign_in_method where row_id = 'stylehr'`
    expect(hr.enabled).toBe(true)
    expect((hr.settings as { id_field: string }).id_field).toBe('email')
    const emails = await sql`select row_id, email from "user" where row_id in ('RR-0101', '30654', 'RR-8001', 'svc-bot', 'owner@jeyarama.com', 'RR-9000') order by row_id`
    expect(Object.fromEntries(emails.map((r) => [r.row_id, r.email]))).toEqual({
      '30654': null,
      'RR-0101': null,
      'RR-8001': null,
      'RR-9000': 'sm.atk@jeyarama.com',
      'owner@jeyarama.com': 'Owner@Jeyarama.com',
      'svc-bot': null,
    })

    const ids = await sql`select user_id, method, subject, sign_in_name, pending_email from user_identity order by user_id, method`
    const byUser = Object.fromEntries(ids.map((r) => [`${r.user_id}/${r.method}`, r]))
    expect(byUser['RR-0101/stylehr']).toMatchObject({ subject: 'RR-0101', sign_in_name: 'devi_1000000001' })
    expect(byUser['30654/stylehr']).toMatchObject({ subject: '30654', sign_in_name: 'kumar_99' })
    // A login ID two people share is migrated for both, with no sign-in name.
    expect(byUser['RR-8001/stylehr']).toMatchObject({ subject: 'RR-8001', sign_in_name: null })
    expect(byUser['RR-8002/stylehr']).toMatchObject({ subject: 'RR-8002', sign_in_name: null })
    expect(report.duplicateSignInNames.map((p) => `${p.row_id} (${p.detail})`)).toEqual(['RR-8001 (shared_login)', 'RR-8002 (SHARED_LOGIN)'])
    // Only someone who really signed in with Google gets a one-time invite.
    expect(byUser['owner@jeyarama.com/google']).toMatchObject({ subject: null, pending_email: 'owner@jeyarama.com' })
    expect(byUser['RR-9000/google']).toBeUndefined()
    expect(report.listedForGoogleInvite.map((p) => p.row_id)).toContain('RR-9000')
    // A-M3: the id was the Google address and there is no email → invited on it;
    // id and email disagree → invited on the email and listed.
    expect(byUser['admitted@jeyarama.com/google']).toMatchObject({ subject: null, pending_email: 'admitted@jeyarama.com' })
    expect(byUser['alias@jeyarama.com/google']).toMatchObject({ pending_email: 'alias.r@jeyarama.com' })
    expect(report.googleIdEmailDiffer.map((p) => p.row_id)).toEqual(['alias@jeyarama.com'])
    // The seeds invented two addresses; they are gone (review minor 12).
    const seeds = await sql`select row_id, email from "user" where row_id in ('Administrator', 'Guest')`
    expect(seeds.every((r) => r.email == null || !String(r.email).endsWith('@example.com'))).toBe(true)
    // Parity: everyone who could sign in still can, except the named exceptions.
    // RR-9000 keeps StyleHR; SM-cbe could only use Google by email, so is named.
    expect(report.parity.exceptions.map((p) => p.row_id)).toEqual(['SM-cbe'])
    expect(report.parity.keepWayIn + report.parity.exceptions.length).toBe(report.parity.canSignInToday)
    // No service account is ever linked.
    expect(ids.some((r) => r.user_id === 'svc-bot')).toBe(false)

    // The old settings now live in rows, and the old column says so.
    const [google] = await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`
    expect(google.allowed_email_domains).toBe('jeyarama.com')
    const left = await sql`select field from single_value where table_name = 'System Settings' and field like 'delegated_login_%'`
    expect(left).toHaveLength(0)
  })

  test('running it again changes nothing', async () => {
    await preUpgradeShape()
    await migratePersonIdentities()
    const before = await sql`select id, subject, sign_in_name, pending_email from user_identity order by id`
    const again = await migratePersonIdentities()
    expect(again.googleInvites).toHaveLength(0)
    expect(again.delegatedLinks).toHaveLength(0)
    expect(await sql`select id, subject, sign_in_name, pending_email from user_identity order by id`).toEqual(before)
  })

  test('a claimed invite is not re-created on a re-run', async () => {
    await preUpgradeShape()
    await migratePersonIdentities()
    await sql`update user_identity set subject = 'g-owner', pending_email = null where user_id = 'owner@jeyarama.com'`
    await sql`alter table "user" add column if not exists social_login varchar(140)`
    await sql`update "user" set social_login = 'google' where row_id = 'owner@jeyarama.com'`
    const again = await migratePersonIdentities()
    expect(again.googleInvites.map((g) => g.row_id)).not.toContain('owner@jeyarama.com')
  })

  test('the plan is read-only', async () => {
    await preUpgradeShape()
    const before = await sql`select (select count(*) from user_identity)::int as ids,
      (select count(*) from "user" where email like '%.invalid')::int as placeholders,
      (select count(*) from single_value where table_name = 'System Settings' and field like 'delegated_login_%')::int as settings`
    const plan = await planPersonIdentities()
    expect(plan.emailsCleared.map((p) => p.row_id)).toContain('RR-0101')
    expect(plan.delegatedLinks.length).toBeGreaterThan(0)
    const after = await sql`select (select count(*) from user_identity)::int as ids,
      (select count(*) from "user" where email like '%.invalid')::int as placeholders,
      (select count(*) from single_value where table_name = 'System Settings' and field like 'delegated_login_%')::int as settings`
    expect(after).toEqual(before)
  })

  test('an old configuration that was off stays off', async () => {
    await preUpgradeShape()
    await sql`delete from single_value where table_name = 'System Settings' and field = 'delegated_login_user_column'`
    await migratePersonIdentities()
    const [hr] = await sql`select enabled from sign_in_method where row_id = 'stylehr'`
    expect(hr.enabled).toBe(false)
  })

  test('two real addresses that collide ignoring case stop the upgrade, after placeholders are cleared', async () => {
    await preUpgradeShape()
    await sql`drop index if exists featherbase.user_email_lower_uq`
    await sql`insert into "user" (row_id, email, enabled, created_at, updated_at) values
      ('dup-a', 'Dup@jeyarama.com', true, now(), now()), ('dup-b', 'dup@jeyarama.com', true, now(), now()),
      ('ph-a', 'X@staff.jeyarama.invalid', true, now(), now()), ('ph-b', 'x@staff.jeyarama.invalid', true, now(), now())`
    await expect(migratePersonIdentities()).rejects.toThrow(/dup@jeyarama\.com: dup-a, dup-b/)
  })

  // Review: the rehearsal must predict the run exactly.
  test("the plan's counts equal what the migration does", async () => {
    await preUpgradeShape()
    const plan = await planPersonIdentities()
    const before = await sql`select
      (select count(*) from "user" where email is not null)::int as emails,
      (select count(*) from user_identity where subject is null)::int as invites,
      (select count(*) from user_identity where method = 'stylehr')::int as delegated`
    await migratePersonIdentities()
    const after = await sql`select
      (select count(*) from "user" where email is not null)::int as emails,
      (select count(*) from user_identity where subject is null)::int as invites,
      (select count(*) from user_identity where method = 'stylehr')::int as delegated`
    expect(before[0].emails - after[0].emails).toBe(plan.emailsCleared.length)
    expect(after[0].invites - before[0].invites).toBe(plan.googleInvites.length)
    expect(after[0].delegated - before[0].delegated).toBe(plan.delegatedLinks.length)
    expect(plan.seedEmailsCleared.map((p) => p.row_id)).toEqual(['Administrator'])
  })

  test('social_login is dropped once read, and a re-run without it changes nothing', async () => {
    await preUpgradeShape()
    await migratePersonIdentities()
    const [col] = await sql`select 1 from information_schema.columns where table_schema = 'featherbase' and table_name = 'user' and column_name = 'social_login'`
    expect(col).toBeUndefined()
    const again = await migratePersonIdentities()
    expect(again.googleInvites).toHaveLength(0)
  })

  test('a login ID whose account id is not its employee code is listed for relinking', async () => {
    await preUpgradeShape()
    await sql`insert into "user" (row_id, email, full_name, enabled, stylehr_username, employee_code, user_type, created_at, updated_at)
      values ('RR-7000', null, 'Moved Mala', true, 'mala_7', 'RR-7001', 'human', now(), now())`
    const plan = await planPersonIdentities()
    expect(plan.idNotEmployeeCode).toEqual([expect.objectContaining({ row_id: 'RR-7000', detail: 'employee code RR-7001' })])
    expect(formatPlan(plan)).toContain('  account id differs from employee code (relink if wrong):\n    Moved Mala (RR-7000) — employee code RR-7001')
  })

  test('an old provider address that is not a URL migrates as a switched-off method keyed "delegated"', async () => {
    await preUpgradeShape()
    await sql`update single_value set value = 'stylehr login page' where table_name = 'System Settings' and field = 'delegated_login_url'`
    const plan = await migratePersonIdentities()
    expect(plan.methods.find((m) => m.kind === 'delegated_password')).toMatchObject({ key: 'delegated', label: 'StyleHR', enabled: false })
    expect(await sql`select label, enabled, service_url from sign_in_method where row_id = 'delegated'`).toEqual([
      { label: 'StyleHR', enabled: false, service_url: 'stylehr login page' },
    ])
  })

  test('on a database with no sign-in methods or identities it creates both Tables, the rows, and the username and login-audit columns', async () => {
    await preUpgradeShape()
    await sql.unsafe(`drop table featherbase.user_identity, featherbase.sign_in_method cascade`)
    await sql`delete from column_def where parent = 'Sign In Method'`
    await sql`delete from table_def where name = 'Sign In Method'`
    await sql`delete from column_def where (parent, column_name) in (('User', 'username'), ('Activity Log', 'sign_in_method'), ('Activity Log', 'test_mode'))`
    await migratePersonIdentities()
    expect(await sql`select title_column, system from table_def where name = 'Sign In Method'`).toEqual([{ title_column: 'label', system: true }])
    expect(await sql`select row_id, kind, enabled from sign_in_method order by row_id`).toEqual([
      { row_id: 'google', kind: 'google', enabled: true },
      { row_id: 'password', kind: 'password', enabled: true },
      { row_id: 'stylehr', kind: 'delegated_password', enabled: true },
    ])
    expect(await sql`select parent, column_name, column_type, read_only from column_def
      where (parent, column_name) in (('User', 'username'), ('Activity Log', 'sign_in_method'), ('Activity Log', 'test_mode'))
      order by parent, column_name`).toEqual([
      { parent: 'Activity Log', column_name: 'sign_in_method', column_type: 'Data', read_only: true },
      { parent: 'Activity Log', column_name: 'test_mode', column_type: 'Check', read_only: true },
      { parent: 'User', column_name: 'username', column_type: 'Data', read_only: false },
    ])
    expect(await sql`select user_id, method, subject, sign_in_name from user_identity where user_id = 'RR-0101'`).toEqual([
      { user_id: 'RR-0101', method: 'stylehr', subject: 'RR-0101', sign_in_name: 'devi_1000000001' },
    ])
  })

  test('with no connected service configured, no delegated method is made and its login IDs link nobody', async () => {
    await preUpgradeShape()
    await sql`delete from single_value where table_name = 'System Settings' and field = 'delegated_login_url'`
    const plan = await migratePersonIdentities()
    expect(plan.methods.map((m) => m.kind)).not.toContain('delegated_password')
    expect(await sql`select row_id from sign_in_method where kind = 'delegated_password'`).toEqual([])
    expect(await sql`select 1 from user_identity where user_id = 'RR-0101'`).toEqual([])
  })

  test('without the dev mock, Google counts as a way in today only where a Google method already has a client id', async () => {
    vi.stubEnv('ALLOW_MOCK_OAUTH', '0')
    await preUpgradeShape()
    // No client id anywhere: a store mailbox reachable only by Google by email had no way in.
    expect((await planPersonIdentities()).parity.exceptions.map((p) => p.row_id)).toEqual([])
    await sql`insert into sign_in_method (row_id, kind, label, enabled, new_person, client_id)
      values ('google', 'google', 'Google', true, 'refuse', 'cid.apps.googleusercontent.com')`
    expect((await planPersonIdentities()).parity.exceptions.map((p) => p.row_id)).toEqual(['SM-cbe'])
  })
})

afterEach(() => vi.unstubAllEnvs())

