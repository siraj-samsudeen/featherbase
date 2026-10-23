// PLAT-004: developer CLI over the row API. One process = one command.
//   cli migrate                       run pending migrations
//   cli patches                       run pending patches
//   cli seed                          (re)apply idempotent core seed data
//   cli create-table --name "X" --field title:Data --field status:Select:Open|Closed [--single]
//   cli create-person <username-or-email> <password> [--full-name "Name"] [--roles "System Manager,All"]
//   cli create-service-account <name> [--roles "System Manager"]
//   cli issue-token <principal> [--label "..."] [--expires <days>]
//   cli list-tokens [<principal>]
//   cli revoke-token <token-id>
//   cli identities:plan               print what migration 0100 (person-identities) will do; read-only
//   cli people:plan [--map] [--columns] [--check-sign-in <code>] [--rehearse <dsn>]
//                                     rehearse the person migrations (0100–0102) rolled back; prints the
//                                     id map, every text column's classification and the scan
//   cli people:resolve <csv> [--dry-run]
//                                     after the person release: move each StyleHR sign-in from its
//                                     employee code to its record number (warehouse file); idempotent
//   cli settings:set <field> --stdin set one System Settings text field to the whole of stdin, e.g.
//                                     `cli settings:set privacy_notice --stdin < notice.md`
//   cli seed-pack apply <name>        apply an organisation's identifier systems (e.g. jeyarama); idempotent
//   cli boot-check                    run the server's start-up refusal and the release preflight with this
//                                     process's environment (rehearse a target's real variables); read-only
//   cli console                       REPL with the row API in scope
import { sql } from './db'
import { formatPlan, planPersonIdentities } from './person-identities-migration'
import { createTable } from './table-engine'
import { getDoc, saveDoc } from './document'
import { getList } from './query'
import { getMeta } from './meta'
import { issueAccessToken, listAccessTokens, revokeAccessToken, setUserPassword } from './auth'
import { createServiceAccount } from './service-accounts'
import { logActivity } from './audit'
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
  if (typeof name !== 'string') throw new Error('create-table requires --name')
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

async function cmdCreatePerson(
  positional: string[],
  flags: Record<string, string | string[] | boolean>,
) {
  const [name, password] = positional
  if (!name || !password) throw new Error('create-person requires <username-or-email> <password>')
  const roles = asArray(flags.roles).flatMap((r) => r.split(',')).map((r) => r.trim()).filter(Boolean)
  const fullName = typeof flags['full-name'] === 'string' ? (flags['full-name'] as string) : name
  // #135: say plainly that the person exists. Case-insensitive on id,
  // username AND email: `administrator` must not shadow `Administrator`.
  const [existing] = await sql`
    select row_id from person
    where lower(row_id) = lower(${name}) or lower(username) = lower(${name}) or lower(email) = lower(${name})`
  if (existing) throw new Error(`Person ${existing.row_id as string} already exists`)
  // person-rename: the id is minted (`psn_…`); an address is kept as the
  // email, anything else as the username.
  const isEmail = name.includes('@')
  const created = await saveDoc(
    'Person',
    {
      ...(isEmail ? { email: name } : { username: name.toLowerCase() }),
      full_name: fullName,
      enabled: true,
      ...(roles.length ? { roles: roles.map((role) => ({ role })) } : {}),
    },
    'Administrator',
    'insert',
  )
  await setUserPassword(String(created.row_id), password)
  console.log(`created person ${String(created.row_id)} (${name})${roles.length ? ` with roles: ${roles.join(', ')}` : ''}`)
}

/** Spawn the rehearsal as its own process, so --rehearse can point
 *  DATABASE_URL at another database before any connection exists. */
async function cmdPeoplePlan(argv: string[]) {
  const { parsePlanOptions } = await import('./people-plan')
  const opts = parsePlanOptions(argv)
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const script = fileURLToPath(new URL('./people-plan.ts', import.meta.url))
  const env = { ...process.env, ...(opts.rehearse ? { DATABASE_URL: opts.rehearse } : {}) }
  const args = argv.flatMap((a, i, all) => (a === '--rehearse' || all[i - 1] === '--rehearse' ? [] : [a]))
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { stdio: 'inherit', env })
  if (result.status !== 0) process.exitCode = result.status ?? 1
}

// #131: automation credentials, shell-access-is-auth (like create-person).
async function cmdCreateServiceAccount(
  positional: string[],
  flags: Record<string, string | string[] | boolean>,
) {
  const [name] = positional
  if (!name) throw new Error('create-service-account requires <name>')
  // person-rename: <name> is the account's label; its id is minted (`svc_…`).
  const roles = asArray(flags.roles).flatMap((r) => r.split(',')).map((r) => r.trim()).filter(Boolean)
  const account = await createServiceAccount(name, roles, 'Administrator')
  console.log(
    `created service account ${account.row_id} ("${account.label}")${account.roles.length ? ` with roles: ${account.roles.join(', ')}` : ''}`,
  )
}

async function cmdIssueToken(
  positional: string[],
  flags: Record<string, string | string[] | boolean>,
) {
  const [principal] = positional
  if (!principal) throw new Error('issue-token requires <principal> (a person id or a service account id)')
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

/** person-rename: after 0101 the shipped 0005 seed would recreate a `User`
 *  Table, so the repair seeds today's shape instead — the three core roles
 *  and the two built-in persons, which keep their ids. */
async function seedBuiltInPersons() {
  for (const role of ['System Manager', 'All', 'Guest']) {
    const [have] = await sql`select 1 from role where row_id = ${role}`
    if (!have) await saveDoc('Role', { row_id: role }, 'Administrator', 'insert')
  }
  for (const [rowId, roles] of [['Administrator', ['System Manager']], ['Guest', []]] as const) {
    const [have] = await sql`select 1 from person where row_id = ${rowId}`
    if (have) continue
    await sql`insert into person ${sql({ row_id: rowId, full_name: rowId, enabled: true, built_in: true } as unknown as Record<string, never>)}`
    for (const [i, role] of roles.entries())
      await sql`insert into has_role ${sql({
        row_id: `${rowId.toLowerCase()}-${i}`, parent: rowId, parenttype: 'Person', parentfield: 'roles', role, position: i + 1,
      } as unknown as Record<string, never>)}`
  }
}

async function cmdSeed() {
  const [renamed] = await sql`select to_regclass('featherbase.person') as r`
  if (renamed?.r) await seedBuiltInPersons()
  // Core seed migrations are written idempotently (ensureTable/ensureDoc),
  // so re-running them is a safe "seed" that repairs missing core data.
  for (const file of renamed?.r ? [] : ['0005_core_seeds.ts']) {
    const mod = await import(new URL(`../migrations/${file}`, import.meta.url).href)
    await mod.up()
    console.log(`seeded ${file}`)
  }
  const { bootstrapAdministrator, diagnoseAdminBootstrap } = await import('./admin-bootstrap')
  await bootstrapAdministrator()
  await diagnoseAdminBootstrap()
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

// stdin is text, taken unchanged: typed fields (Check, Int, Choice …) and
// layout or child-table columns are set in the System Settings form instead.
const TEXT_TYPES = new Set(['Data', 'Text', 'Long Text'])

// #401: System Settings text fields only, through saveDoc (validation), and
// recorded in the Activity Log with actor `cli`.
// The value is the whole of stdin, unchanged, so a reviewed file applies as is.
async function cmdSettingsSet(positional: string[], flags: Record<string, string | string[] | boolean>) {
  const [field] = positional
  if (!field || flags.stdin !== true || positional.length !== 1) throw new Error('usage: cli settings:set <field> --stdin')
  const meta = await getMeta('System Settings')
  const column = meta.columns.find((c) => c.column_name === field)
  if (!column) throw new Error(`System Settings has no field ${field}`)
  if (!TEXT_TYPES.has(column.column_type))
    throw new Error(`System Settings field ${field} is ${column.column_type}; settings:set writes text fields only`)
  const value = await readStdin()
  await saveDoc('System Settings', { [field]: value }, 'Administrator')
  await logActivity('cli', `settings_set ${field}`)
  console.log(`System Settings ${field} set (${value.length} characters)`)
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
    case 'create-table':
      await cmdCreateTable(flags)
      break
    case 'create-person':
      await cmdCreatePerson(positional, flags)
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
    case 'identities:plan':
      // Read-only (review minor 10): computes what migration 0100 would do from
      // the data as it is, with the parity check, and changes nothing.
      console.log(formatPlan(await planPersonIdentities()))
      break
    case 'people:plan':
      await cmdPeoplePlan(rest)
      break
    case 'people:resolve': {
      // The flag may come before or after the file.
      const file = rest.find((a) => !a.startsWith('--'))
      if (!file) throw new Error('usage: cli people:resolve <stylehr_record_ids.csv> [--dry-run]')
      const dryRun = rest.includes('--dry-run')
      const { assertDatabaseEnvironment } = await import('./db-environment')
      await assertDatabaseEnvironment()
      const { formatResolveReport, runPeopleResolve } = await import('./people-resolve')
      console.log(formatResolveReport(await runPeopleResolve(file, { dryRun }), { dryRun }))
      break
    }
    case 'boot-check': {
      // Read-only. Exactly these, with the target's real variables:
      //  1. the server's one start-up refusal (index.ts): test mode outside
      //     development/test/staging;
      //  2. the release preflight (release-preflight.ts): the database's
      //     environment stamp matches, its label allows test mode, and
      //     btree_gist can be created when 0102 is pending.
      const { assertTestModeAllowed, delegatedTestMode } = await import('./delegated-login')
      const { config } = await import('./config')
      assertTestModeAllowed()
      console.log(`boot-check: environment ${config.environment}; test mode ${delegatedTestMode() ? 'on' : 'off'}; the server will start`)
      const { preflightRelease } = await import('./release-preflight')
      for (const line of await preflightRelease()) console.log(`boot-check: release preflight — ${line}`)
      break
    }
    case 'settings:set':
      await cmdSettingsSet(positional, flags)
      break
    case 'seed-pack': {
      const [verb, name] = positional
      if (verb !== 'apply' || !name) throw new Error('usage: cli seed-pack apply <name>')
      const { applySeedPack } = await import('./seed-packs')
      const r = await applySeedPack(name)
      console.log(`seed pack ${name}: added ${r.added.join(', ') || 'none'}; kept ${r.kept.join(', ') || 'none'}; sign-in methods linked ${r.methodsLinked.join(', ') || 'none'}; people_review ${r.peopleReview}`)
      break
    }
    case 'console':
      await cmdConsole()
      break
    default:
      console.log('usage: cli <migrate|patches|seed|create-table|create-person|create-service-account|issue-token|list-tokens|revoke-token|identities:plan|people:plan|settings:set|seed-pack|boot-check|console> [...]')
      process.exitCode = cmd ? 1 : 0
  }
  await sql.end()
}

main().catch(async (err) => {
  console.error('error:', err instanceof Error ? err.message : err)
  await sql.end().catch(() => {})
  process.exit(1)
})
