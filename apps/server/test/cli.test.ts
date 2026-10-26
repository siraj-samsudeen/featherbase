// NOT sandbox-migrated: spawns the CLI as a SUBPROCESS, which opens its own
// Postgres connection — a per-test transaction in this process cannot cover it.
import { execFileSync } from 'node:child_process'
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { issueAccessToken, issueSession, resolveToken, setUserPassword, verifyPassword } from '../src/auth'
import { createServiceAccount } from '../src/service-accounts'
import { requestPasswordReset, resetPassword } from '../src/password-reset'

// PLAT-004: the developer CLI runs real commands against the dev database.
// We spawn it as a subprocess (its own connection) and assert the DB effects.

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(serverDir, 'src', 'cli.ts')
const TSX = join(serverDir, 'node_modules', '.bin', 'tsx')
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

// execFileSync (not async execFile) so the `input` stdin option is honored.
function cli(args: string[], input = ''): string {
  try {
    accessSync(TSX, constants.X_OK)
  } catch {
    throw new Error(`Missing executable ${TSX}; run pnpm install before CLI tests`)
  }
  return execFileSync(TSX, [CLI, ...args], {
    cwd: serverDir,
    timeout: 60_000,
    input,
    encoding: 'utf8',
  })
}

// Case-insensitive: a run that fails mid-way can leave a case-variant row
// behind, and an exact-match delete would strand it for every later run.
// person-rename: ids are minted, so the people are found by email/username
// and the service account by its label.
async function cleanup() {
  const people = await sql`select row_id from person where lower(email) in ${sql([USER, DUP_USER, PW_EMAIL, GOOGLE_USER])} or lower(username) in ${sql([NAME_USER, PW_USER, PW_OTHER])}`
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
afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('PLAT-004: developer CLI', () => {
  it('create-table builds a Table with parsed columns', async () => {
    const stdout = cli([
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
    const stdout = cli([
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
  it('create-person --expects-google-sign-in needs no password and sets the mark', async () => {
    const stdout = cli(['create-person', GOOGLE_USER, '--roles', 'System Manager', '--expects-google-sign-in'])
    const [u] = await sql`select row_id, expects_google_sign_in, password_hash is not null as has_pw from person where email = ${GOOGLE_USER}`
    expect(u).toMatchObject({ expects_google_sign_in: true, has_pw: false })
    expect(stdout).toContain(`created person ${u.row_id as string} (${GOOGLE_USER})`)
    expect(stdout).toContain('expects Google sign-in')
    const roles = await sql`select role from has_role where parent = ${u.row_id as string}`
    expect(roles.map((r) => r.role)).toContain('System Manager')
  }, 60_000)

  it('create-person still needs a password without the mark, and the mark needs an address', () => {
    const fails = (args: string[]) => {
      try {
        cli(args)
        return ''
      } catch (err) {
        return String((err as { stderr?: string }).stderr)
      }
    }
    expect(fails(['create-person', 'cli-no-pw-user'])).toContain('create-person requires <username-or-email> <password>')
    expect(fails(['create-person', 'cli-no-email', '--expects-google-sign-in'])).toContain('--expects-google-sign-in needs an email address')
  }, 60_000)

  // person-identities: a username is not an address, so no email is stored;
  // a service account gets none either.
  it('create-person with a plain username stores no email', async () => {
    cli(['create-person', NAME_USER, 'clitestpw123'])
    const [u] = await sql`select email, password_hash is not null as has_pw from person where username = ${NAME_USER}`
    expect(u).toEqual({ email: null, has_pw: true })
    const [byEmail] = await sql`select email from person where email = ${USER}`
    expect(byEmail.email).toBe(USER)
  }, 60_000)

  it('service-account + token lifecycle: create, issue, list, revoke (#131)', async () => {
    const created = cli(['create-service-account', SVC, '--roles', 'System Manager'])
    // person-rename R2: its own table, a minted svc_ id, no person row.
    const [u] = await sql`select row_id, enabled from service_account where label = ${SVC}`
    expect(created).toContain(`created service account ${u.row_id as string} ("${SVC}")`)
    expect(u.row_id).toMatch(/^svc_[a-z2-7]{20}$/)
    expect(u.enabled).toBe(true)
    expect(await sql`select 1 from person where row_id = ${u.row_id as string}`).toHaveLength(0)
    const id = u.row_id as string

    const issued = cli(['issue-token', id, '--label', 'cli suite', '--expires', '30'])
    const secret = issued.trim().split('\n').at(-1)!
    expect(secret).toMatch(/^fbt_[A-Za-z0-9_-]{43}$/)
    const [tok] = await sql`select id, label, expires_at, token_hash from access_token where service_account = ${id}`
    expect(tok.label).toBe('cli suite')
    expect(tok.expires_at).not.toBeNull()
    expect(issued).not.toContain(tok.token_hash as string) // hash never printed

    const listed = cli(['list-tokens', id])
    expect(listed).toContain(tok.id as string)
    expect(listed).toContain('active')
    expect(listed).not.toContain(secret) // the secret is shown once, at issue time only

    const revoked = cli(['revoke-token', tok.id as string])
    expect(revoked).toContain(`revoked ${tok.id}`)
    expect(cli(['list-tokens', id])).toContain('revoked')
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

    const attempt = (spelling: string) => {
      try {
        cli(['create-person', spelling, 'clitestpw123'])
        return null
      } catch (err) {
        return err as { status?: number; stderr?: string }
      }
    }

    for (const spelling of [DUP_USER, DUP_USER.toUpperCase()]) {
      const failure = attempt(spelling)
      expect(failure, `create-person ${spelling} should have failed`).not.toBeNull()
      expect(failure?.status).toBe(1)
      expect(failure?.stderr).toContain(`Person ${String(existing.row_id)} already exists`)
      // Not the internal concurrency protocol leaking out (#135).
      expect(failure?.stderr).not.toContain('updated_at')
    }

    // One account, untouched — no overwrite and no case-variant shadow.
    const rows = await sql`select row_id, full_name from person where lower(email) = ${DUP_USER}`
    expect(rows).toHaveLength(1)
    expect(rows[0].row_id).toBe(existing.row_id)
    expect(rows[0].full_name).toBe('Already Here')
  }, 60_000)

  it('console evaluates a piped script with the document API in scope', async () => {
    const stdout = cli(
      ['console'],
      'const d = await getDoc("Person","Administrator"); console.log("NAME=" + d.row_id)\n',
    )
    expect(stdout).toContain('NAME=Administrator')
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
      await sql`delete from person where row_id = ${id}`
    }
    const hashOf = async (id: string) =>
      String((await sql`select password_hash from person where row_id = ${id}`)[0].password_hash)
    // Session cut-offs are whole seconds (src/auth.ts): step into the next
    // second so a session issued just before the reset is strictly older.
    const nextSecond = () => new Promise((r) => setTimeout(r, 1000 - (Date.now() % 1000) + 50))
    const attempt = (args: string[], input = '') => {
      try {
        return { ok: cli(args, input) }
      } catch (err) {
        return { err: err as { status?: number; stdout?: string; stderr?: string } }
      }
    }

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

        const out = cli(['set-password', id, '--stdin'], `${NEW}\n`)
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
        cli(['set-password', id, '--stdin'], `${NEW}\n`)
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
        const { err } = attempt(['set-password', id, NEW])
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
        expect(attempt(['set-password', id], `${NEW}\n`).err?.stderr).toContain('--stdin')
        expect(attempt(['set-password', id, '--stdin'], '\n').err?.stderr).toContain('at least 6 characters')
        expect(attempt(['set-password', id, '--stdin'], 'abc\n').err?.stderr).toContain('at least 6 characters')
        expect(await hashOf(id)).toBe(before)
        expect(attempt(['set-password', 'psn_nobodyhere391', '--stdin'], `${NEW}\n`).err?.stderr).toContain(
          'Person psn_nobodyhere391 not found',
        )
      } finally {
        await dropPerson(id)
      }
    }, 60_000)

    it('refuses a service account', async () => {
      const svc = await createServiceAccount(PW_SVC, [], 'Administrator')
      try {
        const { err } = attempt(['set-password', svc.row_id, '--stdin'], `${NEW}\n`)
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

  function failure(args: string[], input = '') {
    try {
      cli(args, input)
      return null
    } catch (err) {
      return err as { status?: number; stderr?: string }
    }
  }

  it('sets a System Settings field to the whole of stdin', async () => {
    const notice = '# Example Org privacy notice\n\nWe hold your **name**.\n'
    const stdout = cli(['settings:set', 'privacy_notice', '--stdin'], notice)
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
    try {
      const f = failure(['settings:set', name, '--stdin'], 'x')
      expect(f?.status).toBe(1)
      expect(f?.stderr).toContain(`System Settings field ${name} is Section Break; settings:set writes text, Check and Choice fields only`)
    } finally {
      if (!layout) await sql`delete from column_def where parent = 'System Settings' and column_name = ${name}`
    }
  }, 60_000)

  it('refuses a field System Settings does not have', async () => {
    const f = failure(['settings:set', 'no_such_field', '--stdin'], 'x')
    expect(f?.status).toBe(1)
    expect(f?.stderr).toContain('System Settings has no field no_such_field')
  }, 60_000)

  // Codex P2: stdin is text, so a typed field would take a stray newline.
  // #465 D5 (Codex adversarial): a switch or choice the settings file can
  // lock is reachable too, taking exactly true/false or one choice; other
  // typed fields are still set in the form.
  it('refuses a switch given anything but true or false, and a typed field it does not carry', async () => {
    const f = failure(['settings:set', 'allow_signup', '--stdin'], 'yes')
    expect(f?.status).toBe(1)
    expect(f?.stderr).toContain('System Settings field allow_signup is a switch: send true or false')
    const g = failure(['settings:set', 'session_hours', '--stdin'], '8')
    expect(g?.status).toBe(1)
    expect(g?.stderr).toContain('System Settings field session_hours is Int; settings:set writes text, Check and Choice fields only')
  }, 60_000)

  it('flips a locked scheduled job switch', async () => {
    const [before] = await sql`select enabled from scheduled_job where row_id = 'disable_leavers'`
    await sql`delete from instance_settings_apply`
    await sql`insert into instance_settings_apply ${sql({ applied_by: 'cli-test', managed_paths: sql.json([{ table: 'Scheduled Job', row_id: 'disable_leavers', field: 'enabled' }]) })}`
    try {
      const target = !before.enabled
      const out = cli(['settings:set', 'enabled', '--stdin', '--table', 'Scheduled Job', '--row', 'disable_leavers'], `${target}\n`)
      expect(out).toContain(`Scheduled Job disable_leavers enabled set (${target})`)
      const [after] = await sql`select enabled from scheduled_job where row_id = 'disable_leavers'`
      expect(after.enabled).toBe(target)
    } finally {
      await sql`delete from instance_settings_apply`
      await sql`update scheduled_job set enabled = ${before.enabled} where row_id = 'disable_leavers'`
      await sql`delete from activity_log where "user" = 'cli' and operation like 'settings_set Scheduled Job%'`
    }
  }, 60_000)

  it('refuses without --stdin', async () => {
    const f = failure(['settings:set', 'privacy_notice', 'inline value'])
    expect(f?.status).toBe(1)
    expect(f?.stderr).toContain('usage: cli settings:set <field> --stdin')
  }, 60_000)

  // #465 D5: the break-glass path. A field the last apply locked is still
  // changed here, and the change is recorded as `cli`.
  it('changes a field the instance settings file locked, recorded as cli', async () => {
    await sql`delete from instance_settings_apply`
    await sql`insert into instance_settings_apply ${sql({ applied_by: 'cli-test', managed_paths: sql.json([{ table: 'System Settings', row_id: 'System Settings', field: 'privacy_notice' }]) })}`
    try {
      cli(['settings:set', 'privacy_notice', '--stdin'], 'Emergency notice\n')
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
      const out = cli(['settings:set', 'allowed_email_domains', '--stdin', '--table', 'Sign In Method', '--row', 'google'], 'example.com')
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
    const outside = failure(['settings:set', 'full_name', '--stdin', '--table', 'Person', '--row', 'x'], 'x')
    expect(outside?.status).toBe(1)
    expect(outside?.stderr).toContain('settings:set writes System Settings, Sign In Method or Scheduled Job, not Person')
    const noRow = failure(['settings:set', 'label', '--stdin', '--table', 'Sign In Method'], 'x')
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
    const out = cli(['settings:export', '--dir', dir])
    expect(out).toContain('instance-settings.json')
    const file = JSON.parse(readFileSync(join(dir, 'instance-settings.json'), 'utf8'))
    expect(Object.keys(file.settings)).toEqual(['System Settings', 'Sign In Method', 'Scheduled Job'])
    const applied = cli(['settings:apply', '--file', join(dir, 'instance-settings.json'), '--revision', 'cli-test'])
    expect(applied).toContain('settings:apply: nothing changed')
  }, 60_000)

  it('a dry run names the change and writes nothing; a file it names is read from beside it', async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'notice.md'), '# A notice only the dry run sees\n')
    writeFileSync(join(dir, 'preview.json'), JSON.stringify({ settings: { 'System Settings': { privacy_notice: { file: 'notice.md' } } } }))
    const before = await sql`select value from single_value where table_name = 'System Settings' and field = 'privacy_notice'`
    const out = cli(['settings:apply', '--file', join(dir, 'preview.json'), '--dry-run'])
    expect(out).toContain('System Settings privacy_notice:')
    expect(out).toContain('"# A notice only the dry run sees\\n"')
    expect(out).toContain('settings:apply: 1 setting would change (dry run; nothing was written)')
    expect(await sql`select value from single_value where table_name = 'System Settings' and field = 'privacy_notice'`).toEqual(before)
  }, 60_000)

  it('runs the same safety controllers as the server: a sign-in method cannot change kind', () => {
    writeFileSync(join(dir, 'kind.json'), JSON.stringify({ settings: { 'Sign In Method': [{ row_id: 'google', kind: 'password' }] } }))
    let stderr = ''
    try {
      cli(['settings:apply', '--file', join(dir, 'kind.json'), '--dry-run'])
    } catch (err) {
      stderr = (err as { stderr: string }).stderr
    }
    expect(stderr).toContain('A sign-in method cannot change kind')
  }, 60_000)

  it('refuses a file reference outside the settings file\'s folder', () => {
    writeFileSync(join(dir, 'escape.json'), JSON.stringify({ settings: { 'System Settings': { privacy_notice: { file: '../package.json' } } } }))
    let stderr = ''
    try {
      cli(['settings:apply', '--file', join(dir, 'escape.json'), '--dry-run'])
    } catch (err) {
      stderr = (err as { stderr: string }).stderr
    }
    expect(stderr).toContain("../package.json is outside the settings file's folder")
  }, 60_000)
})
