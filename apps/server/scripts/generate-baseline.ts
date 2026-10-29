/* Regenerate the migration baseline (#692).
 *
 *   pnpm --filter server baseline:generate [--admin-url <url>] [--out <file>]
 *
 * Migrates a new, empty scratch database with the migrations on disk, then
 * writes what that database holds as one SQL file: pg_dump's schema (the
 * platform's schemas, their extensions and grants), with the seed rows placed
 * between the tables and their indexes, constraints, policies and triggers,
 * the order pg_dump restores in. The scratch database is dropped afterwards.
 * `--admin-url` is a connection that may create databases (default: the local
 * postgres superuser).
 *
 * The file must not depend on where it was generated, so:
 *   - The scratch run has no deployment variables: environment production, no
 *     ADMIN_PASSWORD, no ALLOW_MOCK_OAUTH, no apps. The steps that read them
 *     run after the baseline on every install (0141, 0142).
 *   - Every timestamp in a seed row is the install's own clock, so it is
 *     written as now(). The script refuses a seed timestamp from before the
 *     scratch run started: that one would be a real value.
 *   - It refuses a seed row holding a password hash, secret or token.
 *   - The runner's own records are left out: the migration ledger and the
 *     environment stamp (src/db-environment.ts).
 *   - pg_dump's session settings become transaction-local (a migration runs
 *     in a transaction on a pooled connection); its zero timeouts and its
 *     psql-only \restrict lines are dropped; rows are ordered by primary key.
 * Run twice on the same migrations, it writes the same file.
 *
 * Cutting a NEW baseline later is more than rerunning this: the migrations it
 * absorbs are listed in migrations/baseline-replaces.txt and removed, and
 * src/migrate.ts names the steps after the baseline that an adopted database
 * already has.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url))
const SCHEMAS = ['featherbase', 'meta', 'public']
// The runner's own records, never a migration's.
const RUNNER_TABLES = new Set(['featherbase.migration', 'featherbase.internal_metadata'])
const SECRET_COLUMN = /password|secret|token|hash/i

// The settings pg_dump opens each section with, which this script replaces.
const DUMP_PREAMBLE = [
  'SET statement_timeout = 0;',
  'SET lock_timeout = 0;',
  'SET idle_in_transaction_session_timeout = 0;',
  'SET transaction_timeout = 0;',
  "SET client_encoding = 'UTF8';",
  'SET standard_conforming_strings = on;',
  "SELECT pg_catalog.set_config('search_path', '', false);",
  'SET check_function_bodies = false;',
  'SET xmloption = content;',
  'SET client_min_messages = warning;',
  'SET row_security = off;',
].join('\n')

const LOCAL_PREAMBLE = [
  'SET LOCAL standard_conforming_strings = on;',
  "SELECT pg_catalog.set_config('search_path', '', true);",
  'SET LOCAL check_function_bodies = false;',
  'SET LOCAL xmloption = content;',
  'SET LOCAL client_min_messages = warning;',
  'SET LOCAL row_security = off;',
].join('\n')

// pg_dump objects a fresh database already has, as `Type Name`: public and
// its comment exist in every database; creating an extension sets its
// comment, and COMMENT ON EXTENSION would need its ownership.
const ALREADY_THERE = [/^SCHEMA public$/, /^COMMENT SCHEMA public$/, /^COMMENT EXTENSION /]

function run(command: string, args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, { cwd: SERVER_DIR, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr}${result.stdout}`)
  return result.stdout
}

/** One pg_dump section as baseline text: pg_dump's own blocks (a `-- Name:`
 *  header, then the statement), less its preamble, footer and the objects a
 *  fresh database already has. */
export function cleanSection(dump: string, section: string): string {
  const text = dump.replace(/^\\(un)?restrict .*\n/gm, '')
  const opened = text.indexOf(`${DUMP_PREAMBLE}\n`)
  const closed = text.indexOf('--\n-- PostgreSQL database dump complete\n--')
  if (opened === -1 || closed === -1) throw new Error(`pg_dump's ${section} is not laid out as this script expects; review cleanSection`)
  const blocks = text.slice(opened + DUMP_PREAMBLE.length, closed).split(/\n(?=--\n-- Name: )/).map((b) => b.trim()).filter(Boolean)
  const kept: string[] = []
  for (const block of blocks) {
    const header = /^--\n-- Name: (.*?); Type: (.*?); Schema: .*?; Owner: .*\n--\n/.exec(block)
    if (!header) {
      // Between blocks pg_dump switches two table settings; nothing else.
      const set = /^SET (default_tablespace|default_table_access_method) = (.*);$/.exec(block)
      if (!set) throw new Error(`unexpected text in pg_dump's ${section}: ${block.slice(0, 200)}`)
      kept.push(`SET LOCAL ${set[1]} = ${set[2]};`)
      continue
    }
    const object = `${header[2]} ${header[1]}`
    if (ALREADY_THERE.some((p) => p.test(object))) continue
    // The runner creates featherbase for its ledger before any migration runs.
    kept.push(object === 'SCHEMA featherbase' ? block.replace('CREATE SCHEMA featherbase;', 'CREATE SCHEMA IF NOT EXISTS featherbase;') : block)
  }
  return kept.join('\n\n\n')
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`

/** Every seed row, as INSERTs ordered by primary key, then the sequences. */
async function seedRows(db: postgres.Sql, startedAt: Date): Promise<string> {
  const tables = await db`
    select n.nspname as schema, c.relname as name, c.oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname = any(${SCHEMAS})
    order by 1, 2`
  const out: string[] = []
  for (const t of tables) {
    const relation = `${t.schema}.${t.name}`
    if (RUNNER_TABLES.has(relation)) continue
    const columns = (await db`
      select a.attname as name, a.atttypid in ('timestamptz'::regtype, 'timestamp'::regtype, 'date'::regtype) as is_time
      from pg_attribute a
      where a.attrelid = ${t.oid} and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      order by a.attnum`) as unknown as { name: string; is_time: boolean }[]
    const key = (await db`
      select a.attname as name from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = ${t.oid} and i.indisprimary
      order by array_position(i.indkey, a.attnum)`).map((r) => String(r.name))
    const rows = await db.unsafe(
      `select ${columns.map((c, i) => `quote_nullable(${ident(c.name)}::text) as v${i}` +
        (c.is_time ? `, ${ident(c.name)} < $1 as early${i}` : '')).join(', ')}
       from ${ident(t.schema)}.${ident(t.name)}
       order by ${(key.length ? key : columns.map((c) => c.name)).map(ident).join(', ')}`,
      [startedAt],
    )
    if (!rows.length) continue
    out.push(`--\n-- Data for Name: ${t.name}; Type: TABLE DATA; Schema: ${t.schema}\n--\n`)
    for (const row of rows) {
      const values = columns.map((c, i) => {
        const value = String(row[`v${i}`])
        if (value !== 'NULL' && SECRET_COLUMN.test(c.name))
          throw new Error(`${relation}.${c.name} holds a value in a seed row: a baseline never carries a password, secret or token`)
        if (!c.is_time || value === 'NULL') return value
        if (row[`early${i}`]) throw new Error(`${relation}.${c.name} holds ${value}, from before this install: a seed timestamp must be the install's own`)
        return 'now()'
      })
      out.push(`INSERT INTO ${relation} (${columns.map((c) => ident(c.name)).join(', ')}) VALUES (${values.join(', ')});`)
    }
    out.push('\n')
  }
  for (const s of await db`
    select schemaname, sequencename, last_value from pg_sequences
    where schemaname = any(${SCHEMAS}) and last_value is not null order by 1, 2`)
    out.push(`SELECT pg_catalog.setval('${s.schemaname}.${s.sequencename}', ${s.last_value}, true);`)
  return out.join('\n').trim()
}

export async function generateBaseline(adminUrl: string): Promise<string> {
  const name = `featherbase_baseline_${randomBytes(6).toString('hex')}`
  const target = new URL(adminUrl)
  target.pathname = `/${name}`
  const admin = postgres(adminUrl, { onnotice: () => {}, max: 1 })
  await admin.unsafe(`create database ${ident(name)}`)
  try {
    const db = postgres(target.toString(), { onnotice: () => {}, max: 1 })
    try {
      const [{ now: startedAt }] = await db`select now()`
      // Only what a shell needs to find pnpm and node: no deployment variable.
      run('pnpm', ['exec', 'tsx', 'src/migrate.ts'],
        { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: target.toString(), FEATHERBASE_ENV: 'production' })
      const extensions = (await db`
        select e.extname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
        where n.nspname = any(${SCHEMAS}) order by 1`).map((r) => `--extension=${String(r.extname)}`)
      const dump = (section: string) => cleanSection(run(process.env.PG_DUMP ?? 'pg_dump', [
        '--schema-only', '--no-owner', `--section=${section}`, ...SCHEMAS.map((s) => `--schema=${s}`), ...extensions,
        '--exclude-table=featherbase.migration', `--dbname=${target.toString()}`,
      ], { PATH: process.env.PATH }), section)
      return [
        "-- The platform's schema and seed rows: what the migrations listed in",
        '-- baseline-replaces.txt built on an empty database. Generated, never edited:',
        '-- `pnpm --filter server baseline:generate` (scripts/generate-baseline.ts).',
        '',
        LOCAL_PREAMBLE,
        '',
        '',
        dump('pre-data'),
        '',
        '',
        await seedRows(db, startedAt as Date),
        '',
        '',
        dump('post-data'),
        '',
      ].join('\n')
    } finally {
      await db.end()
    }
  } finally {
    await admin.unsafe(`drop database if exists ${ident(name)}`)
    await admin.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const option = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
  const out = option('--out') ?? resolve(SERVER_DIR, 'migrations/0140_baseline.sql')
  writeFileSync(out, await generateBaseline(option('--admin-url') ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres'))
  console.log(`wrote ${out}`)
}
