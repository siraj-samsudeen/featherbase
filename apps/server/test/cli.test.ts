// NOT sandbox-migrated: spawns the CLI as a SUBPROCESS, which opens its own
// Postgres connection — a per-test transaction in this process cannot cover it.
import { execFileSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'

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
  const people = await sql`select row_id from person where lower(email) in ${sql([USER, DUP_USER])} or lower(username) = ${NAME_USER}`
  const services = await sql`select row_id from service_account where lower(label) = ${SVC}`
  const ids = [...people, ...services].map((r) => String(r.row_id))
  if (ids.length) {
    await sql`delete from access_token where person in ${sql(ids)} or service_account in ${sql(ids)}`
    await sql`delete from has_role where parent in ${sql(ids)}`
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
  }, 60_000)

  it('refuses a field System Settings does not have', async () => {
    const f = failure(['settings:set', 'no_such_field', '--stdin'], 'x')
    expect(f?.status).toBe(1)
    expect(f?.stderr).toContain('System Settings has no field no_such_field')
  }, 60_000)

  it('refuses without --stdin', async () => {
    const f = failure(['settings:set', 'privacy_notice', 'inline value'])
    expect(f?.status).toBe(1)
    expect(f?.stderr).toContain('usage: cli settings:set <field> --stdin')
  }, 60_000)
})
