// NOT sandbox-migrated: spawns the CLI as a SUBPROCESS, which opens its own
// Postgres connection — a per-test transaction in this process cannot cover it.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'

// PLAT-004: the developer CLI runs real commands against the dev database.
// We spawn it as a subprocess (its own connection) and assert the DB effects.

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(serverDir, 'src', 'cli.ts')
const DT = 'Cli Test Widget'
const USER = 'cli-test-user@x.com'
const SVC = 'svc-cli-test'

// execFileSync (not async execFile) so the `input` stdin option is honored.
function cli(args: string[], input = ''): string {
  return execFileSync('npx', ['tsx', CLI, ...args], {
    cwd: serverDir,
    timeout: 60_000,
    input,
    encoding: 'utf8',
  })
}

async function cleanup() {
  await sql`delete from has_role where parent = ${USER}`
  await sql`delete from "user" where name = ${USER}`
  await sql`delete from has_role where parent = ${SVC}`
  await sql`delete from "user" where name = ${SVC}` // cascades its access_token rows
  await sql`delete from table_def where name = ${DT}`
  await sql.unsafe('drop table if exists cli_test_widget')
}

beforeAll(cleanup)
afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('PLAT-004: developer CLI', () => {
  it('create-doctype builds a Table with parsed columns', async () => {
    const stdout = cli([
      'create-doctype',
      '--name', DT,
      '--field', 'title:Data',
      '--field', 'stage:Choice:Open|Closed',
    ])
    expect(stdout).toContain(`created Table ${DT}`)

    const [dt] = await sql`select name from table_def where name = ${DT}`
    expect(dt).toBeDefined()
    const columns = await sql`select column_name, column_type, choices from column_def where parent = ${DT} order by position`
    expect(columns.map((f) => f.column_name)).toEqual(['title', 'stage'])
    const status = columns.find((f) => f.column_name === 'stage')
    expect(status?.column_type).toBe('Choice')
    expect(status?.choices).toBe('Open\nClosed') // pipe-separated choices split to newlines
  }, 60_000)

  it('create-user creates a working login with roles', async () => {
    const stdout = cli([
      'create-user', USER, 'clitestpw123', '--full-name', 'CLI Test', '--roles', 'System Manager',
    ])
    expect(stdout).toContain(`created user ${USER}`)

    const [u] = await sql`select full_name, enabled from "user" where name = ${USER}`
    expect(u.full_name).toBe('CLI Test')
    expect(u.enabled).toBe(true)
    const roles = await sql`select role from has_role where parent = ${USER}`
    expect(roles.map((r) => r.role)).toContain('System Manager')
  }, 60_000)

  it('service-account + token lifecycle: create, issue, list, revoke (#131)', async () => {
    const created = cli(['create-service-account', SVC, '--roles', 'System Manager'])
    expect(created).toContain(`created service account ${SVC}`)
    const [u] = await sql`select enabled, user_type, password_hash from "user" where name = ${SVC}`
    expect(u.user_type).toBe('service')
    expect(u.enabled).toBe(true)
    expect(u.password_hash).toBeNull()

    const issued = cli(['issue-token', SVC, '--label', 'cli suite', '--expires', '30'])
    const secret = issued.trim().split('\n').at(-1)!
    expect(secret).toMatch(/^fbt_[A-Za-z0-9_-]{43}$/)
    const [tok] = await sql`select id, label, expires_at, token_hash from access_token where owner = ${SVC}`
    expect(tok.label).toBe('cli suite')
    expect(tok.expires_at).not.toBeNull()
    expect(issued).not.toContain(tok.token_hash as string) // hash never printed

    const listed = cli(['list-tokens', SVC])
    expect(listed).toContain(tok.id as string)
    expect(listed).toContain('active')
    expect(listed).not.toContain(secret) // the secret is shown once, at issue time only

    const revoked = cli(['revoke-token', tok.id as string])
    expect(revoked).toContain(`revoked ${tok.id}`)
    expect(cli(['list-tokens', SVC])).toContain('revoked')
  }, 120_000)

  it('console evaluates a piped script with the document API in scope', async () => {
    const stdout = cli(
      ['console'],
      'const d = await getDoc("User","Administrator"); console.log("NAME=" + d.name)\n',
    )
    expect(stdout).toContain('NAME=Administrator')
  }, 60_000)
})
