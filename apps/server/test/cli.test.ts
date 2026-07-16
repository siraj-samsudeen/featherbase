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
  await sql`delete from tab_has_role where parent = ${USER}`
  await sql`delete from tab_user where name = ${USER}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_cli_test_widget')
}

beforeAll(cleanup)
afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('PLAT-004: developer CLI', () => {
  it('create-doctype builds a DocType with parsed fields', async () => {
    const stdout = cli([
      'create-doctype',
      '--name', DT,
      '--field', 'title:Data',
      '--field', 'status:Select:Open|Closed',
    ])
    expect(stdout).toContain(`created DocType ${DT}`)

    const [dt] = await sql`select name from tab_doctype where name = ${DT}`
    expect(dt).toBeDefined()
    const fields = await sql`select fieldname, fieldtype, options from tab_docfield where parent = ${DT} order by idx`
    expect(fields.map((f) => f.fieldname)).toEqual(['title', 'status'])
    const status = fields.find((f) => f.fieldname === 'status')
    expect(status?.fieldtype).toBe('Select')
    expect(status?.options).toBe('Open\nClosed') // pipe-separated options split to newlines
  }, 60_000)

  it('create-user creates a working login with roles', async () => {
    const stdout = cli([
      'create-user', USER, 'clitestpw123', '--full-name', 'CLI Test', '--roles', 'System Manager',
    ])
    expect(stdout).toContain(`created user ${USER}`)

    const [u] = await sql`select full_name, enabled from tab_user where name = ${USER}`
    expect(u.full_name).toBe('CLI Test')
    expect(u.enabled).toBe(true)
    const roles = await sql`select role from tab_has_role where parent = ${USER}`
    expect(roles.map((r) => r.role)).toContain('System Manager')
  }, 60_000)

  it('console evaluates a piped script with the document API in scope', async () => {
    const stdout = cli(
      ['console'],
      'const d = await getDoc("User","Administrator"); console.log("NAME=" + d.name)\n',
    )
    expect(stdout).toContain('NAME=Administrator')
  }, 60_000)
})
