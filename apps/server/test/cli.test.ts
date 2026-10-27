// The developer CLI (PLAT-004) driven in this process through `main(argv, io)`
// (ADR 0012). These cases commit, as an operator's command does, and clean up
// after themselves; the cases further down run inside a rolled-back sandbox.
// One case still spawns the CLI as a process, to prove its entry point.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { issueAccessToken, issueSession, resolveToken, setUserPassword, verifyPassword } from '../src/auth'
import { createServiceAccount } from '../src/service-accounts'
import { requestPasswordReset, resetPassword } from '../src/password-reset'
import { main } from '../src/cli'
import { invalidateMeta } from '../src/meta'
import { captureIO, runMain } from './command-io'
import { test } from './pg-test'
import { configureDelegated } from './identity-fixtures'

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const DT = 'Cli Test Widget'
const USER = 'cli-test-user@x.com'
const SVC = 'svc-cli-test'
const DUP_USER = 'cli-dup-user@x.com'
const NAME_USER = 'cli-name-only'
const PW_USER = 'cli-pw-user'
const PW_OTHER = 'cli-pw-other'
const PW_EMAIL = 'cli-pw-link@x.com'
const PW_SVC = 'svc-cli-pw-test'
const GOOGLE_USER = 'cli-google-user@x.com'
const MIXED_USER = 'cli-mixed-case@x.com'

interface CliFailure {
  status: number
  stdout: string
  stderr: string
}

/** One command, in this process: its stdout, or (exit code not 0) a thrown
 *  CliFailure carrying the exit code and both streams. */
async function cli(args: string[], input = ''): Promise<string> {
  const r = await runMain(main, args, input)
  if (r.code !== 0) throw { status: r.code, stdout: r.stdout, stderr: r.stderr } satisfies CliFailure
  return r.stdout
}

/** The failure of a command expected to fail, or null if it succeeded. */
async function failure(args: string[], input = ''): Promise<CliFailure | null> {
  try {
    await cli(args, input)
    return null
  } catch (err) {
    return err as CliFailure
  }
}

// Case-insensitive: a run that fails mid-way can leave a case-variant row
// behind, and an exact-match delete would strand it for every later run.
// person-rename: ids are minted, so the people are found by email/username
// and the service account by its label.
async function cleanup() {
  const people = await sql`select row_id from person where lower(trim(email)) in ${sql([USER, DUP_USER, PW_EMAIL, GOOGLE_USER, MIXED_USER])} or lower(username) in ${sql([NAME_USER, PW_USER, PW_OTHER])}`
  const services = await sql`select row_id from service_account where lower(label) in ${sql([SVC, PW_SVC])}`
  const ids = [...people, ...services].map((r) => String(r.row_id))
  if (ids.length) {
    await sql`delete from access_token where person in ${sql(ids)} or service_account in ${sql(ids)}`
    await sql`delete from has_role where parent in ${sql(ids)}`
    await sql`delete from password_reset where "user" in ${sql(ids)}`
    for (const id of ids) await sql`delete from activity_log where operation = ${`password_set for ${id}`}`
    await sql`delete from person_identifier where person_id in ${sql(ids)}`
    await sql`delete from person where row_id in ${sql(ids)}`
    await sql`delete from service_account where row_id in ${sql(ids)}`
  }
  await sql`delete from table_def where name = ${DT}`
  await sql.unsafe('drop table if exists featherbase.cli_test_widget')
}

beforeAll(cleanup)
afterEach(() => {
  vi.unstubAllEnvs()
})
afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('PLAT-004: developer CLI', () => {
  it('create-table builds a Table with parsed columns', async () => {
    const stdout = await cli([
      'create-table',
      '--name', DT,
      '--field', 'title:Data',
      '--field', 'stage:Choice:Open|Closed',
    ])
    expect(stdout).toContain(`created Table ${DT}`)

    const [dt] = await sql`select name from table_def where name = ${DT}`
    expect(dt).toEqual({ name: DT })
    const columns = await sql`select column_name, column_type, choices from column_def where parent = ${DT} order by position`
    expect(columns.map((f) => f.column_name)).toEqual(['title', 'stage'])
    const status = columns.find((f) => f.column_name === 'stage')
    expect(status?.column_type).toBe('Choice')
    expect(status?.choices).toBe('Open\nClosed') // pipe-separated choices split to newlines
  }, 60_000)

  it('create-person creates a working login with roles', async () => {
    const stdout = await cli([
      'create-person', USER, 'clitestpw123', '--full-name', 'CLI Test', '--roles', 'System Manager',
    ])
    const [u] = await sql`select row_id, full_name, enabled from person where email = ${USER}`
    expect(stdout).toContain(`created person ${u.row_id as string} (${USER})`)
    expect(u.row_id).toMatch(/^psn_[a-z2-7]{20}$/)
    expect(u.full_name).toBe('CLI Test')
    expect(u.enabled).toBe(true)
    const roles = await sql`select role from has_role where parent = ${u.row_id as string}`
    expect(roles.map((r) => r.role)).toContain('System Manager')
  }, 60_000)

  // #473: a person who will sign in with Google needs no password; the mark
  // lets their first Google sign-in with this address link to them.
  // #534: run as a process, where nothing has booted the server and loaded
  // its controllers, so the Person rules run only if the command line loads them.
  it('create-person run as a process applies the Person rules: the email is trimmed and recorded as an identifier; a bad username is refused', () => {
    const run = (...args: string[]) => {
      try {
        return { code: 0, output: execFileSync(process.execPath, ['--import', 'tsx', join(serverDir, 'src', 'cli.ts'), 'create-person', ...args], {
          cwd: serverDir, timeout: 60_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        }) }
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string }
        return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
      }
    }
    expect(run('  CLI-Mixed-Case@X.com ', 'clitestpw123')).toMatchObject({ code: 0, output: expect.stringContaining('created person psn_') })
    expect(run('no', 'clitestpw123')).toEqual({ code: 1, output: expect.stringContaining('A username is 3–64 lowercase letters') })
    return (async () => {
      expect(await sql`select 1 from person where username = 'no'`).toEqual([])
      const [person] = await sql`select row_id, email from person where lower(email) = ${MIXED_USER}`
      expect(person.email).toBe('CLI-Mixed-Case@X.com')
      const identifiers = await sql`select value from person_identifier where person_id = ${String(person.row_id)} and source = 'person-email'`
      expect(identifiers.map((r) => r.value)).toEqual([MIXED_USER])
    })()
  }, 60_000)

  it('create-person --expects-google-sign-in needs no password and sets the mark', async () => {
    const stdout = await cli(['create-person', GOOGLE_USER, '--roles', 'System Manager', '--expects-google-sign-in'])
    const [u] = await sql`select row_id, expects_google_sign_in, password_hash is not null as has_pw from person where email = ${GOOGLE_USER}`
    expect(u).toMatchObject({ expects_google_sign_in: true, has_pw: false })
    expect(stdout).toContain(`created person ${u.row_id as string} (${GOOGLE_USER})`)
    expect(stdout).toContain('expects Google sign-in')
    const roles = await sql`select role from has_role where parent = ${u.row_id as string}`
    expect(roles.map((r) => r.role)).toContain('System Manager')
  }, 60_000)

  it('create-person still needs a password without the mark, and the mark needs an address', async () => {
    expect((await failure(['create-person', 'cli-no-pw-user']))?.stderr).toContain('create-person requires <username-or-email> <password>')
    expect((await failure(['create-person', 'cli-no-email', '--expects-google-sign-in']))?.stderr).toContain('--expects-google-sign-in needs an email address')
  }, 60_000)

  // person-identities: a username is not an address, so no email is stored;
  // a service account gets none either.
  it('create-person with a plain username stores no email', async () => {
    await cli(['create-person', NAME_USER, 'clitestpw123'])
    const [u] = await sql`select email, password_hash is not null as has_pw from person where username = ${NAME_USER}`
    expect(u).toEqual({ email: null, has_pw: true })
    const [byEmail] = await sql`select email from person where email = ${USER}`
    expect(byEmail.email).toBe(USER)
  }, 60_000)

  it('service-account + token lifecycle: create, issue, list, revoke (#131)', async () => {
    const created = await cli(['create-service-account', SVC, '--roles', 'System Manager'])
    // person-rename R2: its own table, a minted svc_ id, no person row.
    const [u] = await sql`select row_id, enabled from service_account where label = ${SVC}`
    expect(created).toContain(`created service account ${u.row_id as string} ("${SVC}")`)
    expect(u.row_id).toMatch(/^svc_[a-z2-7]{20}$/)
    expect(u.enabled).toBe(true)
    expect(await sql`select 1 from person where row_id = ${u.row_id as string}`).toHaveLength(0)
    const id = u.row_id as string

    const issued = await cli(['issue-token', id, '--label', 'cli suite', '--expires', '30'])
    const secret = issued.trim().split('\n').at(-1)!
    expect(secret).toMatch(/^fbt_[A-Za-z0-9_-]{43}$/)
    const [tok] = await sql`select id, label, expires_at, token_hash from access_token where service_account = ${id}`
    expect(tok.label).toBe('cli suite')
    expect(tok.expires_at).not.toBeNull()
    expect(issued).not.toContain(tok.token_hash as string) // hash never printed

    const listed = await cli(['list-tokens', id])
    expect(listed).toContain(tok.id as string)
    expect(listed).toContain('active')
    expect(listed).not.toContain(secret) // the secret is shown once, at issue time only

    const revoked = await cli(['revoke-token', tok.id as string])
    expect(revoked).toContain(`revoked ${tok.id}`)
    expect(await cli(['list-tokens', id])).toContain('revoked')
  }, 120_000)

  // #135, both halves. Same spelling: saveDoc upserts, so without the guard
  // this routed into the update path and reported the raw optimistic-
  // concurrency error. Different case: `name` and the unique index on `email`
  // are both case-sensitive, so it silently created a SECOND account shadowing
  // the first — the trap #131 closed for service accounts.
  it('create-person refuses an email that already exists, whatever its case', async () => {
    const existing = await saveDoc(
      'Person',
      { email: DUP_USER, full_name: 'Already Here', enabled: true },
      'Administrator',
      'insert',
    )

    const attempt = (spelling: string) => failure(['create-person', spelling, 'clitestpw123'])

    for (const spelling of [DUP_USER, DUP_USER.toUpperCase()]) {
      const failed = await attempt(spelling)
      expect(failed, `create-person ${spelling} should have failed`).not.toBeNull()
      expect(failed?.status).toBe(1)
      expect(failed?.stderr).toContain(`Person ${String(existing.row_id)} already exists`)
      // Not the internal concurrency protocol leaking out (#135).
      expect(failed?.stderr).not.toContain('updated_at')
    }

    // One account, untouched — no overwrite and no case-variant shadow.
    const rows = await sql`select row_id, full_name from person where lower(email) = ${DUP_USER}`
    expect(rows).toHaveLength(1)
    expect(rows[0].row_id).toBe(existing.row_id)
    expect(rows[0].full_name).toBe('Already Here')
  }, 60_000)

  // The script's own console.log goes to this process's console, so what it
  // found is carried out in an error message instead.
  it('console evaluates a piped script with the document API in scope', async () => {
    const f = await failure(
      ['console'],
      'const d = await getDoc("Person","Administrator"); throw new Error("NAME=" + d.row_id)\n',
    )
    expect(f).toMatchObject({ status: 1, stderr: 'error: NAME=Administrator\n' })
    // An empty script does nothing and succeeds.
    expect(await cli(['console'], '  \n')).toBe('')
  }, 60_000)

  // #391: break-glass reset. The password arrives on stdin only, is never
  // printed, ends the person's sessions and leaves an Activity Log entry.
  describe('set-password (#391)', () => {
    const OLD = 'old-pw-391'
    const NEW = 'new-pw-391-secret'

    async function makePerson(username = PW_USER, email?: string) {
      const p = await saveDoc('Person', { username, ...(email ? { email } : {}), full_name: 'PW Test', enabled: true }, 'Administrator', 'insert')
      const id = String(p.row_id)
      await setUserPassword(id, OLD)
      return id
    }
    async function dropPerson(id: string) {
      await sql`delete from access_token where person = ${id}`
      await sql`delete from password_reset where "user" = ${id}`
      await sql`delete from activity_log where operation = ${`password_set for ${id}`}`
      // In this process the Person controller is loaded (the sandbox fixture
      // boots the app), so an address also left an email identifier row.
      await sql`delete from person_identifier where person_id = ${id}`
      await sql`delete from person where row_id = ${id}`
    }
    const hashOf = async (id: string) =>
      String((await sql`select password_hash from person where row_id = ${id}`)[0].password_hash)
    // Session cut-offs are whole seconds (src/auth.ts): step into the next
    // second so a session issued just before the reset is strictly older.
    const nextSecond = () => new Promise((r) => setTimeout(r, 1000 - (Date.now() % 1000) + 50))
    const attempt = async (args: string[], input = '') => ({ err: await failure(args, input) })

    it('sets the password from stdin, refuses the old one, ends sessions and logs the actor cli', async () => {
      const id = await makePerson()
      const other = await makePerson(PW_OTHER)
      try {
        const before = await hashOf(id)
        const { token } = await issueSession(id)
        const { token: otherToken } = await issueSession(other)
        const accessToken = (await issueAccessToken(id, 'cli 391', null)).token
        await expect(resolveToken(`Bearer ${token}`)).resolves.toMatchObject({ row_id: id })
        await nextSecond()

        const out = await cli(['set-password', id, '--stdin'], `${NEW}\n`)
        expect(out).toContain(`password set for ${id}`)
        expect(out).toContain(`cli list-tokens ${id}`)
        expect(out).not.toContain(NEW)

        const after = await hashOf(id)
        expect(after).not.toBe(before)
        expect(verifyPassword(NEW, after)).toBe(true) // the trailing newline is not part of it
        expect(verifyPassword(OLD, after)).toBe(false)
        await expect(resolveToken(`Bearer ${token}`)).rejects.toThrow('Invalid or expired session')

        // Only the sessions issued before the reset, and only this person's:
        // a sign-in right after it (same second) works, another person's
        // session is untouched, and access tokens survive by design.
        const fresh = (await issueSession(id)).token
        await expect(resolveToken(`Bearer ${fresh}`)).resolves.toMatchObject({ row_id: id })
        await expect(resolveToken(`Bearer ${otherToken}`)).resolves.toMatchObject({ row_id: other })
        await expect(resolveToken(`Bearer ${accessToken}`)).resolves.toMatchObject({ row_id: id })

        // The actor is `cli`; the person it was done to is in the operation.
        const logs = await sql`select "user", created_by from activity_log where operation = ${`password_set for ${id}`}`
        expect(logs).toEqual([{ user: 'cli', created_by: 'cli' }])
      } finally {
        await dropPerson(id)
        await dropPerson(other)
      }
    }, 60_000)

    // Codex review on #397: an emailed link from before the break-glass reset
    // must not be able to undo it.
    it('revokes reset links issued before it', async () => {
      const id = await makePerson(PW_USER, PW_EMAIL)
      try {
        const link = await requestPasswordReset(PW_EMAIL)
        expect(link).toMatch(/^[0-9a-f]{48}$/)
        await cli(['set-password', id, '--stdin'], `${NEW}\n`)
        expect(await sql`select 1 from password_reset where "user" = ${id}`).toHaveLength(0)
        await expect(resetPassword(link as string, 'link-pw-391')).rejects.toThrow('invalid or has expired')
        expect(verifyPassword(NEW, await hashOf(id))).toBe(true)
      } finally {
        await dropPerson(id)
      }
    }, 60_000)

    it('refuses a password given as an argument, and never echoes it', async () => {
      const id = await makePerson()
      try {
        const before = await hashOf(id)
        const { err } = await attempt(['set-password', id, NEW])
        expect(err?.status).toBe(1)
        expect(err?.stderr).toContain('--stdin')
        expect(`${err?.stdout}${err?.stderr}`).not.toContain(NEW)
        expect(await hashOf(id)).toBe(before)
      } finally {
        await dropPerson(id)
      }
    }, 60_000)

    it('refuses without --stdin, an empty or short password, and an unknown person', async () => {
      const id = await makePerson()
      try {
        const before = await hashOf(id)
        expect((await attempt(['set-password', id], `${NEW}\n`)).err?.stderr).toContain('--stdin')
        expect((await attempt(['set-password', id, '--stdin'], '\n')).err?.stderr).toContain('at least 6 characters')
        expect((await attempt(['set-password', id, '--stdin'], 'abc\n')).err?.stderr).toContain('at least 6 characters')
        expect(await hashOf(id)).toBe(before)
        expect((await attempt(['set-password', 'psn_nobodyhere391', '--stdin'], `${NEW}\n`)).err?.stderr).toContain(
          'Person psn_nobodyhere391 not found',
        )
      } finally {
        await dropPerson(id)
      }
    }, 60_000)

    it('refuses a service account', async () => {
      const svc = await createServiceAccount(PW_SVC, [], 'Administrator')
      try {
        const { err } = await attempt(['set-password', svc.row_id, '--stdin'], `${NEW}\n`)
        expect(err?.status).toBe(1)
        expect(err?.stderr).toContain('Service accounts have no password')
        const logs = await sql`select 1 from activity_log where operation = ${`password_set for ${svc.row_id}`}`
        expect(logs).toHaveLength(0)
      } finally {
        await sql`delete from service_account where row_id = ${svc.row_id}`
      }
    }, 60_000)
  })
})

// #401: an operator applies the instance's privacy notice from a reviewed file
// (`cli settings:set privacy_notice --stdin < notice.md`). Only System
// Settings fields; the value is the whole of stdin, unchanged.
describe('#401: cli settings:set', () => {
  let original: string | null = null
  beforeAll(async () => {
    const [row] = await sql`select value from single_value where table_name = 'System Settings' and field = 'privacy_notice'`
    original = (row?.value as string | undefined) ?? null
  })
  afterAll(async () => {
    await sql`delete from activity_log where "user" = 'cli' and operation like 'settings_set %'`
    await sql`delete from single_value where table_name = 'System Settings' and field = 'privacy_notice'`
    if (original !== null)
      await sql`insert into single_value ${sql({ table_name: 'System Settings', field: 'privacy_notice', value: original })}`
  })

  it('sets a System Settings field to the whole of stdin', async () => {
    const notice = '# Example Org privacy notice\n\nWe hold your **name**.\n'
    const stdout = await cli(['settings:set', 'privacy_notice', '--stdin'], notice)
    expect(stdout).toContain('privacy_notice')
    const [row] = await sql`select value from single_value where table_name = 'System Settings' and field = 'privacy_notice'`
    expect(row.value).toBe(notice)
    // Audited like other administrative changes: actor `cli`.
    const [log] = await sql`select "user", operation from activity_log
      where "user" = 'cli' and operation = 'settings_set privacy_notice' order by created_at desc limit 1`
    expect(log).toEqual({ user: 'cli', operation: 'settings_set privacy_notice' })
  }, 60_000)

  it('refuses a layout or child-table field', async () => {
    const [layout] = await sql`select column_name from column_def
      where parent = 'System Settings' and column_type in ('Section Break', 'Column Break', 'Tab Break', 'Sub-table', 'Table') limit 1`
    // System Settings has none today; any such column type must still be refused.
    const name = (layout?.column_name as string | undefined) ?? 'cli_test_section'
    if (!layout)
      await sql`insert into column_def ${sql({ parent: 'System Settings', position: 999, column_name: name, label: null, column_type: 'Section Break',
        reqd: false, unique: false, default_value: null, read_only: false, hidden: false, in_list_view: false, tier: 'basic' })}`
    // This process caches Table metadata; a raw insert does not reach it.
    invalidateMeta()
    try {
      const f = await failure(['settings:set', name, '--stdin'], 'x')
      expect(f?.status).toBe(1)
      expect(f?.stderr).toContain(`System Settings field ${name} is Section Break; settings:set writes text, Check and Choice fields only`)
    } finally {
      if (!layout) await sql`delete from column_def where parent = 'System Settings' and column_name = ${name}`
      invalidateMeta()
    }
  }, 60_000)

  it('refuses a field System Settings does not have', async () => {
    const f = await failure(['settings:set', 'no_such_field', '--stdin'], 'x')
    expect(f?.status).toBe(1)
    expect(f?.stderr).toContain('System Settings has no field no_such_field')
  }, 60_000)

  // Codex P2: stdin is text, so a typed field would take a stray newline.
  // #465 D5 (Codex adversarial): a switch or choice the settings file can
  // lock is reachable too, taking exactly true/false or one choice; other
  // typed fields are still set in the form.
  it('refuses a switch given anything but true or false, and a typed field it does not carry', async () => {
    const f = await failure(['settings:set', 'allow_signup', '--stdin'], 'yes')
    expect(f?.status).toBe(1)
    expect(f?.stderr).toContain('System Settings field allow_signup is a switch: send true or false')
    const g = await failure(['settings:set', 'session_hours', '--stdin'], '8')
    expect(g?.status).toBe(1)
    expect(g?.stderr).toContain('System Settings field session_hours is Int; settings:set writes text, Check and Choice fields only')
  }, 60_000)

  it('flips a locked scheduled job switch', async () => {
    const [before] = await sql`select enabled from scheduled_job where row_id = 'disable_leavers'`
    await sql`delete from instance_settings_apply`
    await sql`insert into instance_settings_apply ${sql({ applied_by: 'cli-test', managed_paths: sql.json([{ table: 'Scheduled Job', row_id: 'disable_leavers', field: 'enabled' }]) })}`
    try {
      const target = !before.enabled
      const out = await cli(['settings:set', 'enabled', '--stdin', '--table', 'Scheduled Job', '--row', 'disable_leavers'], `${target}\n`)
      expect(out).toContain(`Scheduled Job disable_leavers enabled set (${target})`)
      const [after] = await sql`select enabled from scheduled_job where row_id = 'disable_leavers'`
      expect(after.enabled).toBe(target)
    } finally {
      // Back through the same path, so the job queue is re-timed back too and
      // no queued run leaks into the job tests.
      await cli(['settings:set', 'enabled', '--stdin', '--table', 'Scheduled Job', '--row', 'disable_leavers'], String(before.enabled))
      await sql`delete from instance_settings_apply`
      await sql`delete from activity_log where "user" = 'cli' and operation like 'settings_set Scheduled Job%'`
    }
  }, 60_000)

  it('refuses without --stdin', async () => {
    const f = await failure(['settings:set', 'privacy_notice', 'inline value'])
    expect(f?.status).toBe(1)
    expect(f?.stderr).toContain('usage: cli settings:set <field> --stdin')
  }, 60_000)

  // #465 D5: the break-glass path. A field the last apply locked is still
  // changed here, and the change is recorded as `cli`.
  it('changes a field the instance settings file locked, recorded as cli', async () => {
    await sql`delete from instance_settings_apply`
    await sql`insert into instance_settings_apply ${sql({ applied_by: 'cli-test', managed_paths: sql.json([{ table: 'System Settings', row_id: 'System Settings', field: 'privacy_notice' }]) })}`
    try {
      await cli(['settings:set', 'privacy_notice', '--stdin'], 'Emergency notice\n')
      const [row] = await sql`select value from single_value where table_name = 'System Settings' and field = 'privacy_notice'`
      expect(row.value).toBe('Emergency notice\n')
      const [version] = await sql`select created_by from version where ref_table = 'System Settings' order by created_at desc limit 1`
      expect(version.created_by).toBe('cli')
    } finally {
      await sql`delete from instance_settings_apply`
    }
  }, 60_000)

  it('sets a sign-in method text field with --table and --row, even when locked', async () => {
    const [before] = await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`
    await sql`delete from instance_settings_apply`
    await sql`insert into instance_settings_apply ${sql({ applied_by: 'cli-test', managed_paths: sql.json([{ table: 'Sign In Method', row_id: 'google', field: 'allowed_email_domains' }]) })}`
    try {
      const out = await cli(['settings:set', 'allowed_email_domains', '--stdin', '--table', 'Sign In Method', '--row', 'google'], 'example.com')
      expect(out).toContain('Sign In Method google allowed_email_domains set')
      const [after] = await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`
      expect(after.allowed_email_domains).toBe('example.com')
      const [log] = await sql`select "user" from activity_log where operation = 'settings_set Sign In Method google allowed_email_domains' order by created_at desc limit 1`
      expect(log.user).toBe('cli')
    } finally {
      await sql`delete from instance_settings_apply`
      await sql`update sign_in_method set allowed_email_domains = ${before.allowed_email_domains} where row_id = 'google'`
      await sql`delete from activity_log where "user" = 'cli' and operation like 'settings_set Sign In Method%'`
    }
  }, 60_000)

  it('refuses a Table the settings file does not manage, and a row Table without --row', async () => {
    const outside = await failure(['settings:set', 'full_name', '--stdin', '--table', 'Person', '--row', 'x'], 'x')
    expect(outside?.status).toBe(1)
    expect(outside?.stderr).toContain('settings:set writes System Settings, Sign In Method, Scheduled Job or App Setting, not Person')
    const noRow = await failure(['settings:set', 'label', '--stdin', '--table', 'Sign In Method'], 'x')
    expect(noRow?.status).toBe(1)
    expect(noRow?.stderr).toContain('Sign In Method has rows: name one with --row')
  }, 60_000)
})

// #465 (D3, D9): the settings file from the command line. Export, then apply
// the export, must report "nothing changed"; a dry run writes nothing.
describe('#465: cli settings:export and settings:apply', () => {
  const dir = mkdtempSync(join(tmpdir(), 'featherbase-settings-cli-'))
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    await sql`delete from activity_log where "user" = 'instance-settings' and full_name = 'instance settings file, applied by cli'`
    await sql`delete from instance_settings_apply`
  })

  it('exports this environment, and applying the export changes nothing', async () => {
    const out = await cli(['settings:export', '--dir', dir])
    expect(out).toContain('instance-settings.json')
    const file = JSON.parse(readFileSync(join(dir, 'instance-settings.json'), 'utf8'))
    expect(Object.keys(file.settings)).toEqual(['System Settings', 'Sign In Method', 'Scheduled Job', 'App Setting'])
    const applied = await cli(['settings:apply', '--file', join(dir, 'instance-settings.json'), '--revision', 'cli-test'])
    expect(applied).toContain('settings:apply: nothing changed')
  }, 60_000)

  it('a dry run names the change and writes nothing; a file it names is read from beside it', async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'notice.md'), '# A notice only the dry run sees\n')
    writeFileSync(join(dir, 'preview.json'), JSON.stringify({ settings: { 'System Settings': { privacy_notice: { file: 'notice.md' } } } }))
    const before = await sql`select value from single_value where table_name = 'System Settings' and field = 'privacy_notice'`
    const out = await cli(['settings:apply', '--file', join(dir, 'preview.json'), '--dry-run'])
    expect(out).toContain('System Settings privacy_notice:')
    expect(out).toContain('"# A notice only the dry run sees\\n"')
    expect(out).toContain('settings:apply: 1 setting would change (dry run; nothing was written)')
    expect(await sql`select value from single_value where table_name = 'System Settings' and field = 'privacy_notice'`).toEqual(before)
  }, 60_000)

  it('runs the same safety controllers as the server: a sign-in method cannot change kind', async () => {
    writeFileSync(join(dir, 'kind.json'), JSON.stringify({ settings: { 'Sign In Method': [{ row_id: 'google', kind: 'password' }] } }))
    const f = await failure(['settings:apply', '--file', join(dir, 'kind.json'), '--dry-run'])
    expect(f?.stderr).toContain('A sign-in method cannot change kind')
  }, 60_000)

  it('refuses a file reference outside the settings file\'s folder', async () => {
    writeFileSync(join(dir, 'escape.json'), JSON.stringify({ settings: { 'System Settings': { privacy_notice: { file: '../package.json' } } } }))
    const f = await failure(['settings:apply', '--file', join(dir, 'escape.json'), '--dry-run'])
    expect(f?.stderr).toContain("../package.json is outside the settings file's folder")
  }, 60_000)
})

// Running an Instance: rehearse an environment's start-up checks with the
// variables this test names.
describe('Running an Instance: rehearse an environment\'s start-up checks', () => {
  test('a configuration that would start says so and lists what the release checks passed', async () => {
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    const out = await cli(['boot-check'])
    expect(out).toMatch(/boot-check: environment test; test mode off; the server will start/)
    expect(out).toMatch(/boot-check: release preflight — database environment matches "test"/)
  })

  // #467: the rehearsal shows the same warning the release would.
  test('a set ADMIN_PASSWORD that is not the live password is warned of, and the server will still start', async () => {
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    await setUserPassword('Administrator', 'the-live-password-467')
    vi.stubEnv('ADMIN_PASSWORD', 'not-the-live-password-467')
    const out = await cli(['boot-check'])
    expect(out).toMatch(/boot-check: release preflight — WARNING: ADMIN_PASSWORD is set but is not the Administrator's live password/)
    expect(out).toMatch(/the server will start/)
    expect(out).not.toContain('not-the-live-password-467')
  })

  test('a production configuration with a forbidden switch on fails and names the switch', async () => {
    vi.stubEnv('FEATHERBASE_ENV', 'production')
    vi.stubEnv('ALLOW_MOCK_OAUTH', '1')
    const f = await failure(['boot-check'])
    expect(f?.status).toBe(1)
    expect(f?.stderr).toMatch(/ALLOW_MOCK_OAUTH is set on a "production" server/)
    expect(`${f?.stdout}`).not.toMatch(/the server will start/)
  })
})

describe('Running an Instance: the command line lists what it can do', () => {
  // The one case run as a process: it proves the entry point runs main, prints
  // to the real streams and exits with main's code.
  it('an unknown command lists the commands and fails', () => {
    let code = 0
    let output = ''
    try {
      output = execFileSync(process.execPath, ['--import', 'tsx', join(serverDir, 'src', 'cli.ts'), 'no-such-command'], {
        cwd: serverDir, timeout: 60_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string }
      code = e.status ?? 1
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    expect(code).toBe(1)
    expect(output).toMatch(/usage: cli <migrate\|patches\|/)
  }, 60_000)

  test('no command lists the commands and succeeds', async () => {
    expect(await cli([])).toMatch(/^usage: cli <migrate\|patches\|/)
  })
})

// Every other command and refusal, each inside a rolled-back sandbox.
describe('the command line, command by command', () => {
  test('create-table refuses a missing name and a malformed field; --single makes a settings Table', async () => {
    expect((await failure(['create-table']))?.stderr).toBe('error: create-table requires --name\n')
    expect((await failure(['create-table', '--name', 'Cli Bad', '--field', 'title']))?.stderr)
      .toBe('error: bad --field "title" (want column_name:ColumnType)\n')
    expect(await cli(['create-table', '--name', 'Cli Single', '--single', '--field', 'a:Data', '--field', 'b:Data', '--field', 'c:Int']))
      .toBe('created Table Cli Single with 3 column(s)\n')
    expect(await sql`select kind from table_def where name = 'Cli Single'`).toEqual([{ kind: 'settings' }])
  })

  test('create-person refuses --expects-google-sign-in given a value', async () => {
    expect((await failure(['create-person', '--expects-google-sign-in', 'a@example.com', 'pw123456']))?.stderr)
      .toBe('error: --expects-google-sign-in takes no value; put it after the other arguments\n')
  })

  test('create-service-account needs a name; issue-token needs a principal and a positive expiry', async () => {
    expect((await failure(['create-service-account']))?.stderr).toBe('error: create-service-account requires <name>\n')
    expect((await failure(['issue-token']))?.stderr).toBe('error: issue-token requires <principal> (a person id or a service account id)\n')
    expect((await failure(['issue-token', 'Administrator', '--expires', '0']))?.stderr).toBe('error: --expires wants a positive number of days\n')
    expect((await failure(['revoke-token']))?.stderr).toBe('error: revoke-token requires <token-id>\n')
  })

  test('list-tokens says when there are none, and names a token past its expiry as expired', async () => {
    const svc = await createServiceAccount('svc-cli-list', [], 'Administrator')
    expect(await cli(['list-tokens', svc.row_id])).toBe('no tokens\n')
    // No --label: the token is labelled with the day it was issued.
    const issued = await cli(['issue-token', svc.row_id])
    expect(issued).toMatch(new RegExp(`^issued token \\S+ \\("cli \\d{4}-\\d{2}-\\d{2}"\\) for ${svc.row_id}\\nthe secret below`))
    await sql`update access_token set expires_at = now() - interval '1 day', last_used_at = now() where service_account = ${svc.row_id}`
    expect(await cli(['list-tokens', svc.row_id])).toMatch(/ expired .* expires \d{4}-.*Z {2}\d{4}-.*Z\n$/)
  })

  test('set-password refuses a password typed at a terminal', async () => {
    const c = captureIO('', { tty: true })
    expect(await main(['set-password', 'Administrator', '--stdin'], c.io)).toBe(1)
    expect(c.stderr()).toBe('error: set-password --stdin wants the password piped in, not typed\n')
  })

  test('seed puts back the core roles and the built-in persons', async () => {
    await sql`delete from has_role where parent in ('Administrator', 'Guest')`
    await sql`delete from person_identifier where person_id in ('Administrator', 'Guest')`
    await sql`delete from person where row_id in ('Administrator', 'Guest')`
    await sql`delete from role where row_id = 'Guest'`
    expect(await cli(['seed'])).toBe('seed complete\n')
    expect(await sql`select row_id, built_in from person where row_id in ('Administrator', 'Guest') order by row_id`)
      .toEqual([{ row_id: 'Administrator', built_in: true }, { row_id: 'Guest', built_in: true }])
    expect(await sql`select role from has_role where parent = 'Administrator'`).toEqual([{ role: 'System Manager' }])
    expect(await sql`select 1 from role where row_id = 'Guest'`).toHaveLength(1)
  })

  test('migrate on an up-to-date database applies nothing and succeeds', async () => {
    const [before] = await sql`select count(*)::int as n from migration`
    expect(await runMain(main, ['migrate'])).toMatchObject({ code: 0, stderr: '' })
    expect(await sql`select count(*)::int as n from migration`).toEqual([before])
  })

  test('patches applies a patch not yet recorded, and reports the patch that fails', async () => {
    await sql`delete from patch_log where patch = '0001_file_ref_index'`
    await sql.unsafe('drop index if exists featherbase.file_ref_idx')
    expect(await cli(['patches'])).toBe('applied patch 0001_file_ref_index\npatches up to date (1 total)\n')
    expect(await sql`select to_regclass('featherbase.file_ref_idx') is not null as made`).toEqual([{ made: true }])
    expect(await cli(['patches'])).toBe('patches up to date (1 total)\n')
    await sql`delete from patch_log where patch = '0001_file_ref_index'`
    await sql.unsafe('alter table featherbase.file rename to file_moved')
    const f = await failure(['patches'])
    expect(f?.stderr).toBe('error: relation "featherbase.file" does not exist\n')
  })

  test('identities:plan prints what migration 0100 would do, on a database before it', async () => {
    // The pre-0101 names this plan reads (migration-0100.test.ts has the full shape).
    await sql.unsafe(`alter table featherbase.person rename to "user";
      alter table featherbase."user" add column user_type varchar(140) not null default 'human'`)
    const out = await cli(['identities:plan'])
    expect(out).toMatch(/^person-identities/)
  })

  test('migrate:rehearse runs in its own process: a bad argument, the database here, and a database that is not there', async () => {
    expect((await failure(['migrate:rehearse', '--bogus']))?.stderr).toBe('error: migrate:rehearse: unknown argument --bogus\n')
    expect((await runMain(main, ['migrate:rehearse'])).code).toBe(0)
    const missing = new URL(String(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/featherbase_test'))
    missing.pathname = '/featherbase_no_such_database_cli'
    expect((await runMain(main, ['migrate:rehearse', '--database-url', missing.toString()])).code).toBe(1)
  }, 120_000)

  test('people:resolve needs a file, and a dry run of an empty one moves nobody', async () => {
    expect((await failure(['people:resolve', '--dry-run']))?.stderr).toBe('error: usage: cli people:resolve <stylehr_record_ids.csv> [--dry-run]\n')
    const dir = mkdtempSync(join(tmpdir(), 'featherbase-resolve-cli-'))
    try {
      writeFileSync(join(dir, 'ids.csv'), 'employee_code,assigner,stylehr_record_id\n')
      await configureDelegated()
      const out = await cli(['people:resolve', '--dry-run', join(dir, 'ids.csv')])
      expect(out).toMatch(/^people:resolve \(dry run — rolled back\): 0 live StyleHR sign-ins\n {2}moved to the record number: 0 none\n/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('seed-pack applies a named pack, and needs `apply <name>`', async () => {
    expect((await failure(['seed-pack', 'jeyarama']))?.stderr).toBe('error: usage: cli seed-pack apply <name>\n')
    expect(await cli(['seed-pack', 'apply', 'jeyarama'])).toMatch(/^seed pack jeyarama: added .*; kept .*; sign-in methods linked .*; people_review \w+\n$/)
  })

  test('leavers:check is a dry run unless --apply, and --accept takes a count', async () => {
    expect(await cli(['leavers:check'])).toMatch(/\nleaver check: dry run; nothing was changed\n$/)
    expect((await failure(['leavers:check', '--accept', '3']))?.stderr).toBe('error: --accept only means something with --apply\n')
    expect((await failure(['leavers:check', '--apply', '--accept']))?.stderr).toBe('error: --accept takes the number of people the dry run reported\n')
    expect(await cli(['leavers:check', '--apply', '--accept', '3'])).toMatch(/^leaver check: .*\nleaver check: .*\n$/)
  })

  test('console runs a piped script to the end, writing through the row API', async () => {
    expect(await cli(['console'], 'await saveDoc("Role", { row_id: "Cli Console Role" }, "Administrator", "insert")\n')).toBe('')
    expect(await sql`select row_id from role where row_id = 'Cli Console Role'`).toEqual([{ row_id: 'Cli Console Role' }])
  })

  test('console at a terminal opens a REPL with the row API in scope', async () => {
    const c = captureIO('', { tty: true })
    const running = main(['console'], c.io)
    c.input.write('typeof getDoc\n')
    c.input.write('.exit\n')
    expect(await running).toBe(0)
    expect(c.stdout()).toContain('featherbase console — row API in scope: sql, getDoc, saveDoc, getList, getMeta, createTable\n')
    expect(c.stdout()).toContain("'function'")
  })

  test('settings:set refuses a bare --table, a --row on System Settings, and sets a switch and a choice', async () => {
    expect((await failure(['settings:set', 'label', '--stdin', '--table']))?.stderr).toBe('error: --table takes a value\n')
    expect((await failure(['settings:set', 'app_name', '--stdin', '--row', 'x'], 'x'))?.stderr).toBe('error: System Settings has one row; leave out --row\n')
    expect(await cli(['settings:set', 'allow_signup', '--stdin'], 'true\n')).toBe('System Settings allow_signup set (true)\n')
    expect(await cli(['settings:set', 'currency', '--stdin'], 'EUR\n')).toBe('System Settings currency set (3 characters)\n')
    expect(await sql`select field, value from single_value where table_name = 'System Settings' and field in ('allow_signup', 'currency') order by field`)
      .toEqual([{ field: 'allow_signup', value: '1' }, { field: 'currency', value: 'EUR' }])
  })

  test('settings:apply needs a readable JSON file and every file it names; it prints the warnings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'featherbase-apply-cli-'))
    try {
      expect((await failure(['settings:apply']))?.stderr).toBe('error: usage: cli settings:apply --file <instance-settings.json> [--environment <name>] [--dry-run]\n')
      expect((await failure(['settings:apply', '--file', 'x.json', '--environment']))?.stderr).toBe('error: --environment takes a value\n')
      writeFileSync(join(dir, 'broken.json'), '{ not json')
      expect((await failure(['settings:apply', '--file', join(dir, 'broken.json')]))?.stderr).toMatch(/^error: cannot read .*broken\.json as JSON: /)
      writeFileSync(join(dir, 'missing.json'), JSON.stringify({ settings: { 'System Settings': { privacy_notice: { file: 'notice.md' } } } }))
      expect((await failure(['settings:apply', '--file', join(dir, 'missing.json')]))?.stderr)
        .toBe('error: the settings file names notice.md, which does not exist next to it\n')
      vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
      writeFileSync(join(dir, 'google.json'), JSON.stringify({ settings: { 'Sign In Method': [{ row_id: 'google', enabled: true, client_id: 'cli.apps.googleusercontent.com' }] } }))
      const out = await cli(['settings:apply', '--file', join(dir, 'google.json'), '--dry-run'])
      expect(out).toContain('WARNING: GOOGLE_CLIENT_SECRET is not set on this "test" server')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('settings:export prints the file, says on stderr what it left out, and writes the privacy notice beside it', async () => {
    expect((await failure(['settings:export', '--dir']))?.stderr).toBe('error: --dir takes a folder\n')
    await sql`update sign_in_method set service_url = 'https://bot:hunter2@hr.example.com/login' where row_id = 'google'`
    const r = await runMain(main, ['settings:export'])
    expect(r.code).toBe(0)
    expect(Object.keys(JSON.parse(r.stdout).settings)).toEqual(['System Settings', 'Sign In Method', 'Scheduled Job', 'App Setting'])
    expect(r.stderr).toBe('settings:export: left out Sign In Method.google.service_url: a web address with credentials in it\n')
    await sql`insert into single_value (table_name, field, value) values ('System Settings', 'privacy_notice', '# Notice\n')
      on conflict (table_name, field) do update set value = excluded.value`
    const dir = mkdtempSync(join(tmpdir(), 'featherbase-export-cli-'))
    try {
      expect(await cli(['settings:export', '--dir', dir])).toBe(`settings:export: wrote ${join(dir, 'instance-settings.json')}\n`)
      expect(readFileSync(join(dir, 'privacy-notice.md'), 'utf8')).toBe('# Notice\n')
      expect(JSON.parse(readFileSync(join(dir, 'instance-settings.json'), 'utf8')).settings['System Settings'].privacy_notice).toEqual({ file: 'privacy-notice.md' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
