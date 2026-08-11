// PLAT-004: developer CLI over the row API. One process = one command.
//   cli migrate                       run pending migrations
//   cli patches                       run pending patches
//   cli seed                          (re)apply idempotent core seed data
//   cli create-doctype --name "X" --field title:Data --field status:Select:Open|Closed [--single]
//   cli create-user <email> <password> [--full-name "Name"] [--roles "System Manager,All"]
//   cli create-service-account <name> [--roles "System Manager"]
//   cli issue-token <principal> [--label "..."] [--expires <days>]
//   cli list-tokens [<principal>]
//   cli revoke-token <token-id>
//   cli console                       REPL with the row API in scope
import { sql } from './db'
import { createTable } from './doctype-engine'
import { getDoc, saveDoc } from './document'
import { getList } from './query'
import { getMeta } from './meta'
import { issueAccessToken, listAccessTokens, revokeAccessToken, setUserPassword } from './auth'
import { createServiceAccount } from './service-accounts'
import { runMigrations } from './migrate'
import { runPatches } from './patches'
import { patches } from '../patches/index'

// --- tiny flag parser: collects --key value, repeatable keys become arrays,
// bare --flags become boolean true, everything else is a positional. --------
function parseArgs(argv: string[]) {
  const flags: Record<string, string | string[] | boolean> = {}
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true
      } else {
        const prev = flags[key]
        if (prev === undefined) flags[key] = next
        else if (Array.isArray(prev)) prev.push(next)
        else flags[key] = [prev as string, next]
        i++
      }
    } else positional.push(a)
  }
  return { flags, positional }
}

function asArray(v: string | string[] | boolean | undefined): string[] {
  if (v === undefined || typeof v === 'boolean') return []
  return Array.isArray(v) ? v : [v]
}

async function cmdCreateTable(flags: Record<string, string | string[] | boolean>) {
  const name = flags.name
  if (typeof name !== 'string') throw new Error('create-doctype requires --name')
  const columns = asArray(flags.field).map((spec) => {
    // column_name:ColumnType[:Opt1|Opt2]
    const [columnName, columnType, choices] = spec.split(':')
    if (!columnName || !columnType) throw new Error(`bad --field "${spec}" (want column_name:ColumnType)`)
    return {
      column_name: columnName,
      column_type: columnType,
      ...(choices ? { choices: choices.split('|').join('\n') } : {}),
    }
  })
  const meta = await createTable({ name, kind: flags.single === true ? 'settings' : 'table', columns })
  console.log(`created Table ${meta.name} with ${meta.columns.length} column(s)`)
}

async function cmdCreateUser(
  positional: string[],
  flags: Record<string, string | string[] | boolean>,
) {
  const [email, password] = positional
  if (!email || !password) throw new Error('create-user requires <email> <password>')
  const roles = asArray(flags.roles).flatMap((r) => r.split(',')).map((r) => r.trim()).filter(Boolean)
  const fullName = typeof flags['full-name'] === 'string' ? (flags['full-name'] as string) : email
  // #135: say plainly that the user exists. saveDoc upserts, so a second
  // create-user would route into the update path and surface the raw
  // optimistic-concurrency error instead. Case-insensitive on name AND email
  // (email is unique): `administrator` must not shadow `Administrator` — the
  // same trap #131 closed for service accounts.
  const [existing] = await sql`
    select name from "user" where lower(name) = lower(${email}) or lower(email) = lower(${email})`
  if (existing) throw new Error(`User ${existing.name as string} already exists`)
  await saveDoc(
    'User',
    {
      name: email,
      email,
      full_name: fullName,
      enabled: true,
      ...(roles.length ? { roles: roles.map((role) => ({ role })) } : {}),
    },
    'Administrator',
  )
  await setUserPassword(email, password)
  console.log(`created user ${email}${roles.length ? ` with roles: ${roles.join(', ')}` : ''}`)
}

// #131: automation credentials, shell-access-is-auth (like create-user).
async function cmdCreateServiceAccount(
  positional: string[],
  flags: Record<string, string | string[] | boolean>,
) {
  const [name] = positional
  if (!name) throw new Error('create-service-account requires <name>')
  const roles = asArray(flags.roles).flatMap((r) => r.split(',')).map((r) => r.trim()).filter(Boolean)
  const account = await createServiceAccount(name, roles, 'Administrator')
  console.log(
    `created service account ${account.name}${account.roles.length ? ` with roles: ${account.roles.join(', ')}` : ''}`,
  )
}

async function cmdIssueToken(
  positional: string[],
  flags: Record<string, string | string[] | boolean>,
) {
  const [principal] = positional
  if (!principal) throw new Error('issue-token requires <principal> (a user or service account name)')
  const label = typeof flags.label === 'string' ? flags.label : `cli ${new Date().toISOString().slice(0, 10)}`
  let expiresAt: Date | null = null
  if (typeof flags.expires === 'string') {
    const days = Number(flags.expires)
    if (!Number.isFinite(days) || days <= 0) throw new Error('--expires wants a positive number of days')
    expiresAt = new Date(Date.now() + days * 86_400_000)
  }
  const issued = await issueAccessToken(principal, label, expiresAt)
  console.log(`issued token ${issued.id} ("${issued.label}") for ${issued.owner}`)
  if (issued.expires_at) console.log(`expires ${new Date(issued.expires_at).toISOString()}`)
  console.log('the secret below is shown ONCE — store it now:')
  console.log(issued.token)
}

async function cmdListTokens(positional: string[]) {
  const tokens = await listAccessTokens(positional[0])
  if (!tokens.length) {
    console.log('no tokens')
    return
  }
  for (const t of tokens) {
    const state = t.revoked_at
      ? 'revoked'
      : t.expires_at && new Date(t.expires_at).getTime() <= Date.now()
        ? 'expired'
        : 'active'
    const lastUsed = t.last_used_at ? new Date(t.last_used_at).toISOString() : 'never used'
    const expiry = t.expires_at ? `expires ${new Date(t.expires_at).toISOString()}` : 'no expiry'
    console.log(`${t.id}  ${state.padEnd(7)}  ${t.owner}  "${t.label}"  ${expiry}  ${lastUsed}`)
  }
}

async function cmdRevokeToken(positional: string[]) {
  const [id] = positional
  if (!id) throw new Error('revoke-token requires <token-id>')
  await revokeAccessToken(id)
  console.log(`revoked ${id}`)
}

async function cmdSeed() {
  // Core seed migrations are written idempotently (ensureTable/ensureDoc),
  // so re-running them is a safe "seed" that repairs missing core data.
  for (const file of ['0005_core_seeds.ts', '0006_admin_password.ts']) {
    const mod = await import(new URL(`../migrations/${file}`, import.meta.url).href)
    await mod.up()
    console.log(`seeded ${file}`)
  }
  console.log('seed complete')
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function cmdConsole() {
  const context = { sql, getDoc, saveDoc, getList, getMeta, createTable }
  // Non-interactive (piped/redirected): run the whole stdin script with the
  // row API in scope and AWAIT it, so async work finishes before the
  // connection closes. Interactive: a normal REPL.
  if (!process.stdin.isTTY) {
    const code = await readStdin()
    if (code.trim()) {
      const fn = new AsyncFunction(...Object.keys(context), code)
      await fn(...Object.values(context))
    }
    return
  }
  const repl = await import('node:repl')
  console.log('featherbase console — row API in scope: sql, getDoc, saveDoc, getList, getMeta, createTable')
  const server = repl.start({ prompt: 'fc> ', useGlobal: true })
  Object.assign(server.context, context)
  await new Promise<void>((resolve) => server.on('exit', resolve))
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { flags, positional } = parseArgs(rest)

  switch (cmd) {
    case 'migrate':
      await runMigrations()
      break
    case 'patches': {
      const newly = await runPatches(patches)
      if (newly.length) for (const n of newly) console.log(`applied patch ${n}`)
      console.log(`patches up to date (${patches.length} total)`)
      break
    }
    case 'seed':
      await cmdSeed()
      break
    case 'create-doctype':
      await cmdCreateTable(flags)
      break
    case 'create-user':
      await cmdCreateUser(positional, flags)
      break
    case 'create-service-account':
      await cmdCreateServiceAccount(positional, flags)
      break
    case 'issue-token':
      await cmdIssueToken(positional, flags)
      break
    case 'list-tokens':
      await cmdListTokens(positional)
      break
    case 'revoke-token':
      await cmdRevokeToken(positional)
      break
    case 'console':
      await cmdConsole()
      break
    default:
      console.log('usage: cli <migrate|patches|seed|create-doctype|create-user|create-service-account|issue-token|list-tokens|revoke-token|console> [...]')
      process.exitCode = cmd ? 1 : 0
  }
  await sql.end()
}

main().catch(async (err) => {
  console.error('error:', err instanceof Error ? err.message : err)
  await sql.end().catch(() => {})
  process.exit(1)
})
