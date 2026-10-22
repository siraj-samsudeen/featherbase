// Migration 0100 (person-identities) against a dev-shaped fixture: roster
// staff with placeholder emails and StyleHR login IDs (one shared), a Google
// user, a real-email user who never used Google, a service account. The test
// database is already migrated, so each test first puts back the pre-upgrade
// shape inside its own rolled-back transaction.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { formatPlan, migratePersonIdentities, planPersonIdentities } from '../src/person-identities-migration'

async function preUpgradeShape() {
  await sql`delete from user_identity`
  await sql`delete from sign_in_method where kind = 'delegated_password' or row_id = 'google'`
  await sql`update "user" set email = 'admin@example.com' where row_id = 'Administrator'`
  await sql`alter table "user" add column if not exists stylehr_username varchar(140)`
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
    ['RR-7963', 'rr-7963@staff.jeyarama.invalid', 'anisha_1716708795', 'RR-7963', null],
    ['21654', '21654@staff.jeyarama.invalid', 'kumar_99', '21654', null],
    ['RR-8001', 'rr-8001@staff.jeyarama.invalid', 'shared_login', 'RR-8001', null],
    ['RR-8002', 'rr-8002@staff.jeyarama.invalid', 'SHARED_LOGIN ', 'RR-8002', null],
    ['RR-9000', 'sm.atk@jeyarama.com', 'sm_atk', 'RR-9000', null],
    ['siraj@jeyarama.com', ' Siraj@Jeyarama.com ', null, null, 'google'],
    // Google users found by their id before (review A-M3): no email, and a differing one.
    ['kannan@jeyarama.com', null, null, null, 'google'],
    ['uday@jeyarama.com', 'uday.r@jeyarama.com', null, null, 'google'],
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
    const emails = await sql`select row_id, email from "user" where row_id in ('RR-7963', '21654', 'RR-8001', 'svc-bot', 'siraj@jeyarama.com', 'RR-9000') order by row_id`
    expect(Object.fromEntries(emails.map((r) => [r.row_id, r.email]))).toEqual({
      '21654': null,
      'RR-7963': null,
      'RR-8001': null,
      'RR-9000': 'sm.atk@jeyarama.com',
      'siraj@jeyarama.com': 'Siraj@Jeyarama.com',
      'svc-bot': null,
    })

    const ids = await sql`select user_id, method, subject, sign_in_name, pending_email from user_identity order by user_id, method`
    const byUser = Object.fromEntries(ids.map((r) => [`${r.user_id}/${r.method}`, r]))
    expect(byUser['RR-7963/stylehr']).toMatchObject({ subject: 'RR-7963', sign_in_name: 'anisha_1716708795' })
    expect(byUser['21654/stylehr']).toMatchObject({ subject: '21654', sign_in_name: 'kumar_99' })
    // A login ID two people share is migrated for both, with no sign-in name.
    expect(byUser['RR-8001/stylehr']).toMatchObject({ subject: 'RR-8001', sign_in_name: null })
    expect(byUser['RR-8002/stylehr']).toMatchObject({ subject: 'RR-8002', sign_in_name: null })
    expect(report.duplicateSignInNames.map((p) => `${p.row_id} (${p.detail})`)).toEqual(['RR-8001 (shared_login)', 'RR-8002 (SHARED_LOGIN)'])
    // Only someone who really signed in with Google gets a one-time invite.
    expect(byUser['siraj@jeyarama.com/google']).toMatchObject({ subject: null, pending_email: 'siraj@jeyarama.com' })
    expect(byUser['RR-9000/google']).toBeUndefined()
    expect(report.listedForGoogleInvite.map((p) => p.row_id)).toContain('RR-9000')
    // A-M3: the id was the Google address and there is no email → invited on it;
    // id and email disagree → invited on the email and listed.
    expect(byUser['kannan@jeyarama.com/google']).toMatchObject({ subject: null, pending_email: 'kannan@jeyarama.com' })
    expect(byUser['uday@jeyarama.com/google']).toMatchObject({ pending_email: 'uday.r@jeyarama.com' })
    expect(report.googleIdEmailDiffer.map((p) => p.row_id)).toEqual(['uday@jeyarama.com'])
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
    await sql`update user_identity set subject = 'g-siraj', pending_email = null where user_id = 'siraj@jeyarama.com'`
    await sql`update "user" set social_login = 'google' where row_id = 'siraj@jeyarama.com'`
    const again = await migratePersonIdentities()
    expect(again.googleInvites.map((g) => g.row_id)).not.toContain('siraj@jeyarama.com')
  })

  test('the plan is read-only', async () => {
    await preUpgradeShape()
    const before = await sql`select (select count(*) from user_identity)::int as ids,
      (select count(*) from "user" where email like '%.invalid')::int as placeholders,
      (select count(*) from single_value where table_name = 'System Settings' and field like 'delegated_login_%')::int as settings`
    const plan = await planPersonIdentities()
    expect(plan.emailsCleared.map((p) => p.row_id)).toContain('RR-7963')
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
})
