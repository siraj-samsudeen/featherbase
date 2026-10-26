// PLAT-004: developer CLI over the row API. One process = one command.
//   cli migrate                       run pending migrations
//   cli patches                       run pending patches
//   cli seed                          (re)apply idempotent core seed data
//   cli create-table --name "X" --field title:Data --field status:Select:Open|Closed [--single]
//   cli create-person <username-or-email> <password> [--full-name "Name"] [--roles "System Manager,All"]
//   cli create-person <email> [--full-name "Name"] [--roles "..."] --expects-google-sign-in
//                                     #473: no password; their first Google sign-in with this address
//                                     links to them (when Google sign-in admits its domain)
//   cli set-password <person-id> --stdin
//                                     break-glass reset (#391): the password is read from stdin, never argv;
//                                     ends the person's sessions and logs the actor `cli`
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
//   cli mail:test <to>                send one test message through the configured transport (SMTP when
//                                     SMTP_HOST is set, otherwise the Email Sink); exits 1 if delivery fails
//   cli settings:set <field> --stdin [--table <Table> --row <row id>]
//                                     set one text field of System Settings (or, with --table and --row,
//                                     of a sign-in method or scheduled job) to the whole of stdin, e.g.
//                                     `cli settings:set privacy_notice --stdin < notice.md`. Break glass
//                                     (#465 D5): it may change a field the instance settings file locked,
//                                     and is logged with actor `cli`
//   cli settings:apply --file <instance-settings.json> [--environment <name>] [--dry-run]
//                     [--revision <sha>] [--run <id>]
//                                     apply an instance settings file (#465): one transaction, actor
//                                     `instance-settings`; --dry-run previews and writes nothing. A
//                                     { "file": "x.md" } value is read from next to the settings file
//   cli settings:export [--dir <folder>]
//                                     print this environment's managed settings in the file's shape
//                                     (never a secret); --dir writes instance-settings.json and
//                                     privacy-notice.md there instead
//   cli seed-pack apply <name>        apply an organisation's identifier systems (e.g. jeyarama); idempotent
//   cli boot-check                    run the server's start-up refusal and the release preflight with this
//                                     process's environment (rehearse a target's real variables); read-only
//   cli leavers:check [--apply [--accept <n>]]
//                                     the daily warehouse exit-date check (leaver-check.ts): with no flag a
//                                     dry run that changes nothing and prints counts only; --apply acts on
//                                     it; --accept <n> lifts the size limit for exactly n people (a large but
//                                     genuine batch), never a stale feed
//   cli console                       REPL with the row API in scope
import { sql } from './db'
import { formatPlan, planPersonIdentities } from './person-identities-migration'
import { createTable } from './table-engine'
import { getDoc, saveDoc } from './document'
import { getList } from './query'
import { getMeta } from './meta'
import { issueAccessToken, listAccessTokens, revokeAccessToken, setPasswordFromShell, setUserPassword } from './auth'
import { MIN_PASSWORD_LENGTH } from './password-reset'
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
  const expectsGoogle = flags['expects-google-sign-in']
  // A bare flag: written before the password it would swallow it as its value.
  if (typeof expectsGoogle === 'string')
    throw new Error('--expects-google-sign-in takes no value; put it after the other arguments')
  if (!name || (!password && expectsGoogle !== true)) throw new Error('create-person requires <username-or-email> <password>')
  if (expectsGoogle === true && !name.includes('@')) throw new Error('--expects-google-sign-in needs an email address')
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
      ...(expectsGoogle === true ? { expects_google_sign_in: true } : {}),
    },
    'Administrator',
    'insert',
  )
  if (password) await setUserPassword(String(created.row_id), password)
  const marked = expectsGoogle === true ? '; expects Google sign-in' : ''
  console.log(`created person ${String(created.row_id)} (${name})${roles.length ? ` with roles: ${roles.join(', ')}` : ''}${marked}`)
}

// #391: argv lands in shell history and the process list, so a password is
// taken from stdin only, and a second positional is refused unread.
async function cmdSetPassword(argv: string[]) {
  const positional = argv.filter((a) => !a.startsWith('--'))
  if (positional.length > 1)
    throw new Error('set-password never takes the password as an argument; pipe it in with --stdin')
  const [person] = positional
  if (!person || !argv.includes('--stdin')) throw new Error('usage: cli set-password <person-id> --stdin  (password piped on stdin)')
  // A terminal would echo what is typed; ask for a pipe instead.
  if (process.stdin.isTTY) throw new Error('set-password --stdin wants the password piped in, not typed')
  // One trailing newline is the pipe's (`echo`, a heredoc), not the password's.
  const password = (await readStdin()).replace(/\r?\n$/, '')
  // The sign-up and reset minimum (index.ts, password-reset.ts).
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  await setPasswordFromShell(person, password)
  console.log(`password set for ${person}; their sessions are ended`)
  // Access tokens are a separate credential and survive by design.
  console.log(`access tokens still work — on a suspected compromise: cli list-tokens ${person}, then cli revoke-token <id>`)
}

/** Spawn the rehearsal as its own process, so --rehearse can point
 *  DATABASE_URL at another database before any connection exists. */
async function cmdPeoplePlan(argv: string[]) {
  const { parsePlanOptions } = await import('./people-plan')
  const opts = parsePlanOptions(argv)
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const script = fileURLToPath(new URL('./people-plan.ts', import.meta.url))
  const { childEnvironment } = await import('./env')
  const env = childEnvironment(opts.rehearse ? { DATABASE_URL: opts.rehearse } : {})
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

// #401: a text field of System Settings, or (#465 D5) of a sign-in method or
// scheduled job row with --table and --row, through saveDoc (validation).
// This is the break-glass path: it runs as the actor `cli`, which may change
// a field the instance settings file locked, and is recorded in the Activity
// Log with actor `cli`. The value is the whole of stdin, unchanged, so a
// reviewed file applies as is.
async function cmdSettingsSet(positional: string[], flags: Record<string, string | string[] | boolean>) {
  const [field] = positional
  if (!field || flags.stdin !== true || positional.length !== 1)
    throw new Error('usage: cli settings:set <field> --stdin [--table <Table> --row <row id>]')
  for (const key of ['table', 'row'] as const)
    if (flags[key] !== undefined && typeof flags[key] !== 'string') throw new Error(`--${key} takes a value`)
  const { INSTANCE_SETTINGS_TABLES } = await import('shared')
  const table = (flags.table as string | undefined) ?? 'System Settings'
  if (!(INSTANCE_SETTINGS_TABLES as readonly string[]).includes(table))
    throw new Error(`settings:set writes ${INSTANCE_SETTINGS_TABLES.slice(0, -1).join(', ')} or ${INSTANCE_SETTINGS_TABLES[INSTANCE_SETTINGS_TABLES.length - 1]}, not ${table}`)
  const meta = await getMeta(table)
  const row = flags.row as string | undefined
  if (meta.kind === 'settings' && row !== undefined) throw new Error(`${table} has one row; leave out --row`)
  if (meta.kind !== 'settings' && row === undefined) throw new Error(`${table} has rows: name one with --row`)
  const column = meta.columns.find((c) => c.column_name === field)
  if (!column) throw new Error(`${table} has no field ${field}`)
  if (!TEXT_TYPES.has(column.column_type))
    throw new Error(`${table} field ${field} is ${column.column_type}; settings:set writes text fields only`)
  const value = await readStdin()
  // The same core controllers the server registers, so a sign-in method's
  // lockout guard runs here too.
  const { loadControllers } = await import('./controllers')
  await loadControllers()
  const { BREAK_GLASS_ACTOR } = await import('./managed-settings')
  const { runAsSystemActor } = await import('./system-actor')
  await runAsSystemActor(BREAK_GLASS_ACTOR, async () => {
    if (row === undefined) {
      await saveDoc(table, { [field]: value }, BREAK_GLASS_ACTOR)
    } else {
      const current = await getDoc(table, row, BREAK_GLASS_ACTOR)
      await saveDoc(table, { row_id: row, [field]: value, updated_at: current.updated_at }, BREAK_GLASS_ACTOR)
    }
  })
  const where = row === undefined ? (table === 'System Settings' ? '' : `${table} `) : `${table} ${row} `
  await logActivity(BREAK_GLASS_ACTOR, `settings_set ${where}${field}`)
  console.log(`${row === undefined ? table : `${table} ${row}`} ${field} set (${value.length} characters)`)
}

/** Every { "file": name } value in a settings file, read from the folder
 *  the settings file is in. A name that leaves that folder is refused. */
async function referencedFiles(value: unknown, folder: string, out: Record<string, string> = {}): Promise<Record<string, string>> {
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  if (Array.isArray(value)) {
    for (const v of value) await referencedFiles(v, folder, out)
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    const name = (value as { file?: unknown }).file
    if (keys.length === 1 && typeof name === 'string') {
      const full = path.resolve(folder, name)
      if (path.relative(folder, full).startsWith('..') || path.isAbsolute(name))
        throw new Error(`${name} is outside the settings file's folder`)
      out[name] = await readFile(full, 'utf8').catch(() => {
        throw new Error(`the settings file names ${name}, which does not exist next to it`)
      })
    } else for (const v of Object.values(value)) await referencedFiles(v, folder, out)
  }
  return out
}

async function cmdSettingsApply(flags: Record<string, string | string[] | boolean>) {
  const file = flags.file
  if (typeof file !== 'string') throw new Error('usage: cli settings:apply --file <instance-settings.json> [--environment <name>] [--dry-run]')
  for (const key of ['environment', 'revision', 'run'] as const)
    if (flags[key] !== undefined && typeof flags[key] !== 'string') throw new Error(`--${key} takes a value`)
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  let settings: unknown
  try {
    settings = JSON.parse(await readFile(file, 'utf8'))
  } catch (err) {
    throw new Error(`cannot read ${file} as JSON: ${(err as Error).message}`)
  }
  // The same core controllers the server registers at start (index.ts), so
  // the CLI enforces what HTTP does: the sign-in lockout guard, a scheduled
  // job's queue re-timing (Codex adversarial, #465).
  const { loadControllers } = await import('./controllers')
  await loadControllers()
  const { applyInstanceSettings } = await import('./instance-settings')
  const result = await applyInstanceSettings(settings, {
    by: 'cli',
    environment: flags.environment as string | undefined,
    dryRun: flags['dry-run'] === true,
    source: { revision: flags.revision as string | undefined, run: flags.run as string | undefined },
    files: await referencedFiles(settings, path.dirname(path.resolve(file))),
  })
  for (const c of result.changes)
    console.log(`${c.table}${c.table === c.row_id ? '' : ` ${c.row_id}`} ${c.field}: ${JSON.stringify(c.old)} -> ${JSON.stringify(c.new)}${c.created ? ' (new row)' : ''}${c.was_default ? ' (was the default)' : ''}`)
  for (const w of result.warnings) console.log(w)
  console.log(`settings:apply: ${result.summary}${result.dry_run ? ' (dry run; nothing was written)' : ''}`)
}

async function cmdSettingsExport(flags: Record<string, string | string[] | boolean>) {
  if (flags.dir !== undefined && typeof flags.dir !== 'string') throw new Error('--dir takes a folder')
  const { exportInstanceSettings } = await import('./instance-settings')
  const { file, withheld } = await exportInstanceSettings()
  // Never on stdout, which may be redirected into the settings file.
  for (const w of withheld) console.error(`settings:export: left out ${w}`)
  if (typeof flags.dir !== 'string') {
    console.log(JSON.stringify(file, null, 2))
    return
  }
  const { mkdir, writeFile } = await import('node:fs/promises')
  const path = await import('node:path')
  await mkdir(flags.dir, { recursive: true })
  const system = file.settings['System Settings'] as Record<string, unknown> | undefined
  if (typeof system?.privacy_notice === 'string') {
    await writeFile(path.join(flags.dir, 'privacy-notice.md'), system.privacy_notice)
    system.privacy_notice = { file: 'privacy-notice.md' }
  }
  await writeFile(path.join(flags.dir, 'instance-settings.json'), `${JSON.stringify(file, null, 2)}\n`)
  console.log(`settings:export: wrote ${path.join(flags.dir, 'instance-settings.json')}`)
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
    case 'set-password':
      await cmdSetPassword(rest)
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
      //  1. the server's start-up refusal (index.ts): the variable registry
      //     (env.ts) — a missing required variable, or a switch on that only
      //     development, test or staging may have;
      //  2. the release preflight (release-preflight.ts): the same registry
      //     with the settings-dependent variables, the database's environment
      //     stamp, its label for test mode, and the access configuration.
      const { assertServerStart } = await import('./env')
      const { delegatedTestMode } = await import('./delegated-login')
      const { config } = await import('./config')
      const { settingsRequirements } = await import('./release-preflight')
      for (const line of assertServerStart(undefined, await settingsRequirements())) if (line.startsWith('WARNING')) console.log(`boot-check: ${line}`)
      console.log(`boot-check: environment ${config.environment}; test mode ${delegatedTestMode() ? 'on' : 'off'}; the server will start`)
      const { preflightRelease } = await import('./release-preflight')
      for (const line of await preflightRelease()) console.log(`boot-check: release preflight — ${line}`)
      break
    }
    case 'mail:test': {
      const [to] = positional
      if (!to) throw new Error('usage: cli mail:test <to>')
      const { readSmtpConfig, sendTestEmail, MailDeliveryError } = await import('./email')
      const smtp = readSmtpConfig()
      try {
        await sendTestEmail(to)
      } catch (err) {
        // The server's own reply says why (a 421 names the command it
        // refused). Every address in it is masked (a relay may echo any
        // envelope address, however the recipient was written), and so are
        // the credentials.
        if (err instanceof MailDeliveryError && err.serverReply) {
          let reply = err.serverReply
          if (smtp?.password) reply = reply.split(smtp.password).join('[password]')
          reply = reply.replace(/[^\s<>()\[\],;:"']+@[^\s<>()\[\],;:"']+/g, '[address]')
          console.error(`mail:test: server reply: ${reply}`)
        }
        throw err
      }
      // The recipient is not echoed: the operator typed it, and output may be
      // captured in deploy logs.
      console.log(smtp ? `mail:test: sent a test message via SMTP ${smtp.host}:${smtp.port}` : 'mail:test: SMTP_HOST is unset; the test message went to the Email Sink')
      break
    }
    case 'settings:set':
      await cmdSettingsSet(positional, flags)
      break
    case 'settings:apply':
      await cmdSettingsApply(flags)
      break
    case 'settings:export':
      await cmdSettingsExport(flags)
      break
    case 'seed-pack': {
      const [verb, name] = positional
      if (verb !== 'apply' || !name) throw new Error('usage: cli seed-pack apply <name>')
      const { applySeedPack } = await import('./seed-packs')
      const r = await applySeedPack(name)
      console.log(`seed pack ${name}: added ${r.added.join(', ') || 'none'}; kept ${r.kept.join(', ') || 'none'}; sign-in methods linked ${r.methodsLinked.join(', ') || 'none'}; people_review ${r.peopleReview}`)
      break
    }
    case 'leavers:check': {
      const { formatLeaverPlan, formatSummaryDelivery, planLeaverCheck, runLeaverCheck } = await import('./leaver-check')
      if (!rest.includes('--apply')) {
        if (flags.accept !== undefined) throw new Error('--accept only means something with --apply')
        console.log(formatLeaverPlan(await planLeaverCheck()))
        console.log('leaver check: dry run; nothing was changed')
        break
      }
      // A bare --accept parses as `true`; Number(true) is 1, so demand digits.
      if (flags.accept !== undefined && !(typeof flags.accept === 'string' && /^[1-9]\d*$/.test(flags.accept)))
        throw new Error('--accept takes the number of people the dry run reported')
      const accept = flags.accept === undefined ? undefined : Number(flags.accept)
      const { assertDatabaseEnvironment } = await import('./db-environment')
      await assertDatabaseEnvironment()
      const run = await runLeaverCheck({ acceptCount: accept })
      console.log(formatLeaverPlan(run.plan, { applied: run.disabled }))
      console.log(formatSummaryDelivery(run))
      break
    }
    case 'console':
      await cmdConsole()
      break
    default:
      console.log('usage: cli <migrate|patches|seed|create-table|create-person|set-password|create-service-account|issue-token|list-tokens|revoke-token|identities:plan|people:plan|leavers:check|settings:set|settings:apply|settings:export|mail:test|seed-pack|boot-check|console> [...]')
      process.exitCode = cmd ? 1 : 0
  }
  await sql.end()
}

main().catch(async (err) => {
  console.error('error:', err instanceof Error ? err.message : err)
  await sql.end().catch(() => {})
  process.exit(1)
})
