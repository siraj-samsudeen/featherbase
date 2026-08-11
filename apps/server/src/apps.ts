import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { createTable, tableName } from './doctype-engine'
import { ensureHomePageForTable } from './home-pages'
import { invalidateMeta } from './meta'
import { saveDoc, deleteDoc } from './document'
import { reflectTables } from './sources/reflect'
import { invalidateSources } from './sources/registry'
import { enqueue, registerJob, type JobHandler } from './jobs'
import { swapMethod, type MethodDef, type ServerMethod } from './methods'
import {
  registerController,
  unregisterController,
  type TableController,
  type Hook,
  type HookEvent,
} from './controllers'

// PLAT-001/002: the app system. An app is a code-defined manifest that can
// declare Tables and doc_events (lifecycle hooks on ANY Table, including
// ones it doesn't own). Installing an app materializes its Tables and wires
// its hooks; uninstalling tears its Tables down and unwires its hooks —
// without disturbing the core controllers or other apps on the same Table.
//
// App CODE (manifests + hook functions) lives in the process; the
// `installed_app` table records which apps are installed and what each
// install created (Tables, roles, grants), so state survives restarts.

export interface SchedulerEvent {
  // The job method name (registered in the job registry; must be unique).
  method: string
  handler: JobHandler
  every_seconds: number
}

// PLAT-004 (#54): a role grant an app declares on a Table. `table` may
// name a Table the app does not own — the same latitude doc_events has.
export interface AppPermission {
  table: string
  role: string
  tier?: 'basic' | 'restricted'
  own_rows_only?: boolean
  can_read?: boolean
  can_write?: boolean
  can_create?: boolean
  can_delete?: boolean
  can_submit?: boolean
  can_cancel?: boolean
  can_amend?: boolean
}

// PLAT-006 (#78): fixture documents an app ships — workflows, email rules,
// server scripts, SLAs, web forms, sample rows. Anything saveDoc can save.
export interface AppFixture {
  table: string
  rows: Record<string, unknown>[]
}

// EDS/M3: a Data Source the app needs, plus which of its relations to
// reflect. This is how a source-bound deployment becomes reproducible from
// git: the manifest declares WHAT to connect and reflect, reflection derives
// the column shape from the live source at install time (so a schema change
// upstream is picked up, not frozen into the manifest).
//
// Credentials never appear here — `url_env` names an environment variable,
// exactly as the Data Source Table itself requires (spec BV7!).
export interface AppSource {
  name: string
  engine: 'postgres' | 'duckdb' | 'csv-folder'
  url_env?: string
  root_path?: string
  default_schema?: string
  access?: 'read_only' | 'read_write'
  table_allowlist?: string
  // Relations to reflect once the source is connected. Table names may be
  // schema-qualified; ambiguous bare names are refused by the reflector.
  reflect?: {
    schema?: string
    prefix?: string
    module?: string
    tables: string[]
  }
}

export interface AppManifest {
  name: string
  // Data Sources this app connects, and the relations it reflects from them.
  // Materialized FIRST — the app's own tables may be bound to them.
  sources?: AppSource[]
  // Table definitions this app owns (same shape accepted by createTable).
  tables?: unknown[]
  // Roles this app needs. An existing role of the same name is adopted, not
  // redefined — roles are shared between apps and users.
  roles?: string[]
  // Permission grants this app declares. An existing grant of the same
  // identity (table, role, tier) is adopted as-is — overwriting a
  // pre-existing grant's flags would be worse than ignoring a redundant
  // declaration.
  permissions?: AppPermission[]
  // Fixture documents (PLAT-006, #78), materialized through the normal
  // saveDoc lifecycle AFTER tables/roles/permissions, in declaration order —
  // declare a Workflow before rows that reference it. A named row that
  // already exists is adopted, not recreated and not recorded (same
  // discipline as roles), so uninstall can never remove a row that predated
  // the app.
  fixtures?: AppFixture[]
  // Lifecycle hooks keyed by target Table then event. The target need not be
  // owned by this app — that is the whole point of doc_events (PLAT-002). The
  // "*" key hooks EVERY Table (Frappe's doc_events["*"]).
  doc_events?: Record<string, Partial<Record<HookEvent, Hook>>>
  // Recurring jobs this app schedules (Frappe's scheduler_events). Wired as
  // job handlers + a guarded recurring enqueue while the app is installed.
  scheduler_events?: SchedulerEvent[]
  // Replacements for whitelisted RPC methods (Frappe's
  // override_whitelisted_methods). The original is restored on uninstall.
  override_whitelisted_methods?: Record<string, ServerMethod>
}

// Registry of apps KNOWN to this process (installed or not).
const available = new Map<string, AppManifest>()
// Controllers currently wired for each installed app, for clean removal.
const wired = new Map<string, TableController[]>()
// Method overrides per app, with the previous definition for restore.
const overridden = new Map<string, { path: string; prev: MethodDef | undefined }[]>()

export function registerApp(manifest: AppManifest): void {
  available.set(manifest.name, manifest)
}

export function getAvailableApps(): string[] {
  return [...available.keys()]
}

// The jsonb ledger columns (tables/roles/perms) round-trip as arrays, but
// tolerate a stored JSON string too (defensive against double-encoding).
function asNameList(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[]
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? (parsed as string[]) : []
    } catch {
      return []
    }
  }
  return []
}

// A fixture row's identity in the install ledger: enough to delete exactly
// that row on uninstall, nothing more.
interface FixtureRef {
  table: string
  name: string
}

function asFixtureRefs(v: unknown): FixtureRef[] {
  const raw = typeof v === 'string' ? (() => { try { return JSON.parse(v) } catch { return [] } })() : v
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (r): r is FixtureRef =>
      r != null && typeof r === 'object' &&
      typeof (r as FixtureRef).table === 'string' && typeof (r as FixtureRef).name === 'string',
  )
}

// Wire an app's doc_events into the controller registry, tracking the created
// controllers so uninstall can remove exactly them.
function wireHooks(manifest: AppManifest): void {
  const controllers: TableController[] = []
  for (const [table, hooks] of Object.entries(manifest.doc_events ?? {})) {
    const controller: TableController = { table, hooks }
    registerController(controller)
    controllers.push(controller)
  }
  wired.set(manifest.name, controllers)

  // scheduler_events: register the handlers; the recurring enqueue itself is
  // ensured separately (install + boot) so a dead row gets re-seeded.
  for (const ev of manifest.scheduler_events ?? []) registerJob(ev.method, ev.handler)

  // override_whitelisted_methods: swap handlers in, keeping the previous
  // definition (and its guest setting) for restore on uninstall.
  const swaps: { path: string; prev: MethodDef | undefined }[] = []
  for (const [path, fn] of Object.entries(manifest.override_whitelisted_methods ?? {})) {
    const prev = swapMethod(path, { fn, allowGuest: false, effect: 'write' })
    if (prev) swapMethod(path, { fn, allowGuest: prev.allowGuest, effect: prev.effect })
    swaps.push({ path, prev })
  }
  overridden.set(manifest.name, swaps)
}

function unwireHooks(name: string): void {
  for (const controller of wired.get(name) ?? []) unregisterController(controller)
  wired.delete(name)
  for (const { path, prev } of overridden.get(name) ?? []) swapMethod(path, prev)
  overridden.delete(name)
}

// Ensure each scheduler_event has a live recurring job row (guarded so
// restarts don't stack duplicates) — same pattern as the boot-seeded jobs.
async function ensureSchedulerJobs(manifest: AppManifest): Promise<void> {
  for (const ev of manifest.scheduler_events ?? []) {
    const [pending] = await sql`
      select 1 from background_job
      where method = ${ev.method} and job_status in ('queued', 'running') limit 1`
    if (!pending) await enqueue(ev.method, {}, { repeatEvery: ev.every_seconds })
  }
}

// Remove an uninstalled app's pending recurring jobs so they stop firing.
async function dropSchedulerJobs(manifest: AppManifest): Promise<void> {
  for (const ev of manifest.scheduler_events ?? []) {
    await sql`delete from background_job where method = ${ev.method} and job_status = 'queued'`
  }
}

// PLAT-004 (#54): materialize the manifest's roles and Permissions. Returns
// only what this install genuinely CREATED — adopted (pre-existing) roles
// and grants are not recorded, so uninstall can never remove something that
// predated the app.
async function provisionAccess(manifest: AppManifest): Promise<{ roles: string[]; perms: string[] }> {
  const roles: string[] = []
  for (const role of manifest.roles ?? []) {
    const [have] = await sql`select 1 from role where row_id = ${role}`
    if (have) continue
    await saveDoc('Role', { name: role })
    roles.push(role)
  }
  const perms: string[] = []
  for (const p of manifest.permissions ?? []) {
    const [role] = await sql`select 1 from role where row_id = ${p.role}`
    if (!role)
      throw new AppError(
        'ValidationError',
        `Permission on ${p.table} names unknown role ${p.role} — declare it in the manifest's roles`,
      )
    if (p.can_create && !p.can_write)
      console.warn(
        `[apps] ${manifest.name}: grant for ${p.role} on ${p.table} has can_create without can_write — ` +
          `inserts strip every column the role cannot write, so created rows will be empty (add can_write)`,
      )
    const tier = p.tier ?? 'basic'
    const [have] = await sql`
      select 1 from permission
      where ref_table = ${p.table} and role = ${p.role} and tier = ${tier}`
    if (have) continue
    const saved = await saveDoc('Permission', {
      ref_table: p.table,
      role: p.role,
      tier,
      own_rows_only: p.own_rows_only ?? false,
      can_read: p.can_read ?? false,
      can_write: p.can_write ?? false,
      can_create: p.can_create ?? false,
      can_delete: p.can_delete ?? false,
      can_submit: p.can_submit ?? false,
      can_cancel: p.can_cancel ?? false,
      can_amend: p.can_amend ?? false,
    })
    perms.push(String(saved.row_id))
  }
  return { roles, perms }
}

// Remove the grants an install created, then any of its roles that nothing
// references any more — a role survives while any Permission still links to
// it or any user still holds it (shared roles outlive one app's uninstall).
async function teardownAccess(roles: string[], perms: string[]): Promise<void> {
  for (const name of perms) await sql`delete from permission where row_id = ${name}`
  for (const role of roles) {
    const [inPerm] = await sql`select 1 from permission where role = ${role} limit 1`
    if (inPerm) continue
    const [held] = await sql`select 1 from has_role where role = ${role} limit 1`
    if (held) continue
    await sql`delete from role where row_id = ${role}`
  }
}

// PLAT-006 (#78): materialize the manifest's fixture documents through the
// NORMAL saveDoc lifecycle — validation, automation triggers, id patterns and
// sub-tables all run, exactly as if an admin had saved each row. Declaration
// order is the dependency order (a Workflow before rows that reference it).
// Returns only the rows this install genuinely CREATED: a declared row whose
// name already exists is adopted as-is, not overwritten and not recorded, so
// uninstall can never remove (or an install redefine) a row that predated
// the app — the same discipline provisionAccess applies to roles and grants.
async function provisionFixtures(manifest: AppManifest): Promise<FixtureRef[]> {
  const created: FixtureRef[] = []
  for (const fixture of manifest.fixtures ?? []) {
    for (const row of fixture.rows) {
      const name = row.row_id == null ? '' : String(row.row_id).trim()
      if (name) {
        const [have] = await sql`
          select 1 from ${sql(tableName(fixture.table))} where name = ${name}`
        if (have) continue
      }
      const saved = await saveDoc(fixture.table, { ...row }, 'Administrator', 'insert')
      created.push({ table: fixture.table, name: String(saved.row_id) })
    }
  }
  return created
}

// Remove the fixture rows an install created, newest-first (reverse of
// declaration order, so dependents go before what they reference) and BEFORE
// the app's tables drop — a fixture may live on an app-owned table. Runs the
// real delete lifecycle (on_trash hooks, child-row cleanup). A row the user
// already deleted is skipped quietly — the goal state is "gone" either way.
async function teardownFixtures(fixtures: FixtureRef[]): Promise<void> {
  for (const ref of [...fixtures].reverse()) {
    try {
      await deleteDoc(ref.table, ref.name)
    } catch (err) {
      if (err instanceof AppError && err.type === 'NotFoundError') continue
      throw err
    }
  }
}

export async function isInstalled(name: string): Promise<boolean> {
  const [row] = await sql`select 1 from installed_app where name = ${name}`
  return Boolean(row)
}

export async function listInstalledApps(): Promise<{ name: string; tables: string[]; installed_at: Date }[]> {
  const rows = await sql`select name, tables, installed_at from installed_app order by installed_at asc`
  return rows.map((r) => ({
    name: r.name as string,
    tables: asNameList(r.tables),
    installed_at: r.installed_at as Date,
  }))
}

type InstallResult = {
  name: string
  tables: string[]
  roles: string[]
  perms: string[]
  fixtures: FixtureRef[]
  // Data Sources this install CREATED (adopted ones are not listed).
  sources: string[]
}

// Shared install path: create the app's Tables (each goes through the
// normal engine → table), then its roles and grants — in that order, since a
// Permission links to a Role and may target a Table the app just created —
// then its fixture documents, which may depend on all of the above.
// `stored` is the declarative manifest to persist, or null for a code app.
// Create the app's Data Sources and reflect what it declares. Runs BEFORE
// the app's own tables so a manifest table may be bound to a source it
// brings. An existing source of the same name is ADOPTED, not redefined and
// not recorded — the same discipline roles follow, so uninstall can never
// remove a source that predated the app.
async function provisionSources(
  manifest: AppManifest,
): Promise<{ sources: string[]; tables: string[] }> {
  const sources: string[] = []
  const tables: string[] = []
  for (const src of manifest.sources ?? []) {
    const [existing] = await sql`select 1 from data_source where row_id = ${src.name}`
    if (!existing) {
      await saveDoc('Data Source', {
        name: src.name,
        engine: src.engine,
        url_env: src.url_env ?? null,
        root_path: src.root_path ?? null,
        default_schema: src.default_schema ?? null,
        access: src.access ?? 'read_only',
        table_allowlist: src.table_allowlist ?? null,
      })
      sources.push(src.name)
    }
    if (!src.reflect?.tables?.length) continue
    // Reflection needs the source to answer — an unreachable source fails
    // the install loudly rather than leaving a half-configured app.
    const result = await reflectTables(src.name, {
      schema: src.reflect.schema,
      tables: src.reflect.tables,
      module: src.reflect.module,
      prefix: src.reflect.prefix,
    })
    for (const c of result.created) tables.push(c.name)
    // "Already reflected" is adoption, not failure; anything else is a
    // manifest that does not match the source and must not install silently.
    const bad = result.skipped.filter((s) => !/Already reflected/.test(s.reason))
    if (bad.length)
      throw new AppError(
        'ValidationError',
        `App ${manifest.name}: cannot reflect from ${src.name} — ` +
          bad.map((s) => `${s.table} (${s.reason})`).join('; '),
      )
  }
  return { sources, tables }
}

async function materialize(manifest: AppManifest, stored: unknown): Promise<InstallResult> {
  if (await isInstalled(manifest.name))
    throw new AppError('ConflictError', `App ${manifest.name} is already installed`)
  const provisioned = await provisionSources(manifest)
  // Reflected Tables are the app's tables for teardown purposes.
  const created: string[] = [...provisioned.tables]
  for (const def of manifest.tables ?? []) {
    // App tables are user-space: they group under the app's own module in the
    // sidebar. `system` marks tables created by the migration chain and is
    // rejected on POST /api/doctype — an app manifest gets the same refusal,
    // not a silent bypass.
    if ((def as { system?: unknown })?.system === true)
      throw new AppError(
        'ValidationError',
        `App table declares system: true — the system flag belongs to the migration chain, app tables are user-space`,
      )
    const meta = await createTable(def)
    created.push(meta.name)
    // #80: app tables group under the app's own module in navigation, same
    // as builder-created tables — the module's home page is created on
    // demand and the table's link appended.
    if (meta.kind !== 'sub_table') await ensureHomePageForTable(meta.name, meta.module)
  }
  const access = await provisionAccess(manifest)
  // Wire its doc_events, scheduler jobs, and method overrides BEFORE the
  // fixtures materialize, so fixture saves run under the app's own hooks the
  // same way any later save would. (A declarative manifest has none of these
  // — the loop bodies simply never run.)
  wireHooks(manifest)
  await ensureSchedulerJobs(manifest)
  let fixtures: FixtureRef[]
  try {
    fixtures = await provisionFixtures(manifest)
  } catch (err) {
    // A fixture that fails validation aborts the install; unwire the hooks so
    // a half-installed app leaves no live code behind. (Created tables/roles
    // remain, as with any mid-install failure — there is no ledger row yet.)
    unwireHooks(manifest.name)
    throw err
  }
  // Cast the JSON text to jsonb explicitly — passing a JS string to a jsonb
  // column would otherwise double-encode it as a JSON string.
  await sql`
    insert into installed_app (name, tables, roles, perms, fixtures, sources, manifest)
    values (${manifest.name}, ${sql.json(created)}, ${sql.json(access.roles)},
            ${sql.json(access.perms)}, ${sql.json(fixtures as never)},
            ${sql.json(provisioned.sources)},
            ${stored == null ? null : sql.json(stored as never)})`
  return {
    name: manifest.name,
    tables: created,
    roles: access.roles,
    perms: access.perms,
    fixtures,
    sources: provisioned.sources,
  }
}

export async function installApp(name: string): Promise<InstallResult> {
  const manifest = available.get(name)
  if (!manifest) throw new AppError('ValidationError', `Unknown app: ${name}`, { name: 'Not registered' })
  return materialize(manifest, null)
}

// PLAT-005 (#55): install an app from a JSON manifest with no code in this
// process. Only data can survive JSON — Tables, roles, permissions.
const CODE_ONLY_KEYS = ['doc_events', 'scheduler_events', 'override_whitelisted_methods'] as const

const appPermissionSchema = z
  .object({
    table: z.string().min(1),
    role: z.string().min(1),
    tier: z.enum(['basic', 'restricted']).optional(),
    own_rows_only: z.boolean().optional(),
    can_read: z.boolean().optional(),
    can_write: z.boolean().optional(),
    can_create: z.boolean().optional(),
    can_delete: z.boolean().optional(),
    can_submit: z.boolean().optional(),
    can_cancel: z.boolean().optional(),
    can_amend: z.boolean().optional(),
  })
  .strict()

// Fixtures are pure data — they survive JSON, so a declarative manifest may
// carry them (PLAT-006, #78).
const appFixtureSchema = z
  .object({
    table: z.string().min(1),
    rows: z.array(z.record(z.unknown())),
  })
  .strict()

const appSourceSchema = z
  .object({
    name: z.string().min(1),
    engine: z.enum(['postgres', 'duckdb', 'csv-folder']),
    // A manifest names an ENV VAR, never a connection string (BV7!).
    url_env: z.string().min(1).optional(),
    root_path: z.string().min(1).optional(),
    default_schema: z.string().optional(),
    access: z.enum(['read_only', 'read_write']).optional(),
    table_allowlist: z.string().optional(),
    reflect: z
      .object({
        schema: z.string().optional(),
        prefix: z.string().optional(),
        module: z.string().optional(),
        tables: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .optional(),
  })
  .strict()

const declarativeManifestSchema = z
  .object({
    name: z.string().min(1),
    sources: z.array(appSourceSchema).optional(),
    tables: z.array(z.unknown()).optional(),
    roles: z.array(z.string().min(1)).optional(),
    permissions: z.array(appPermissionSchema).optional(),
    fixtures: z.array(appFixtureSchema).optional(),
  })
  .strict()

export async function installAppFromManifest(input: unknown): Promise<InstallResult> {
  // Functions cannot survive JSON. Silently installing an app with its
  // behaviour missing would be the worst outcome, so name the key and point
  // at the code path instead of letting .strict() swallow it generically.
  if (input && typeof input === 'object') {
    for (const key of CODE_ONLY_KEYS) {
      if (key in (input as Record<string, unknown>))
        throw new AppError(
          'ValidationError',
          `A declarative manifest cannot carry ${key} — hooks are code and do not survive JSON. ` +
            `Ship the app's code and register it with registerApp() instead`,
        )
    }
  }
  const parsed = declarativeManifestSchema.safeParse(input)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || 'manifest'] = issue.message
    throw new AppError('ValidationError', 'Invalid app manifest', fields)
  }
  // A name owned by a code-registered app must be installed by name, so the
  // declarative row can never shadow (or later tear down) the code app.
  if (available.has(parsed.data.name))
    throw new AppError(
      'ConflictError',
      `App ${parsed.data.name} is registered in code — install it with { name } instead`,
    )
  return materialize(parsed.data as AppManifest, parsed.data)
}

export async function uninstallApp(name: string): Promise<{ name: string; removed: string[] }> {
  const [row] = await sql`
    select tables, roles, perms, fixtures, sources from installed_app where name = ${name}`
  if (!row) throw new AppError('ValidationError', `App ${name} is not installed`)
  const tables = asNameList(row.tables)

  // Unwire hooks first so no lifecycle event fires against a half-dropped table.
  unwireHooks(name)
  const manifest = available.get(name)
  if (manifest) await dropSchedulerJobs(manifest)

  // Fixture rows go first — reverse declaration order, and before the app's
  // tables drop, since a fixture may live on (or reference) an app table.
  await teardownFixtures(asFixtureRefs(row.fixtures))

  for (const t of tables) {
    const tbl = tableName(t)
    await sql`delete from column_def where parent = ${t}`
    await sql`delete from table_def where name = ${t}`
    await sql.unsafe(`drop table if exists ${tbl} cascade`)
    invalidateMeta(t)
  }
  // Access teardown works from the install ledger, so it removes exactly what
  // this install created — adopted roles/grants were never recorded.
  await teardownAccess(asNameList(row.roles), asNameList(row.perms))
  // Data Sources go LAST: the Data Source controller refuses to delete one
  // that still has bound Tables, and this app's bound Tables were dropped
  // just above. Adopted sources were never recorded, so they survive.
  for (const src of asNameList(row.sources)) {
    await deleteDoc('Data Source', src).catch(() => {})
    invalidateSources(src)
  }
  await sql`delete from installed_app where name = ${name}`
  return { name, removed: tables }
}

// PLAT-001: on boot, re-wire the doc_events of already-installed apps (their
// Tables already exist in the DB). Declarative apps have no code and nothing
// to wire; unknown installed apps (code removed) are skipped the same way —
// their tables simply remain until re-registered or uninstalled.
export async function loadInstalledApps(): Promise<void> {
  const rows = await sql`select name from installed_app`
  for (const r of rows) {
    const manifest = available.get(r.name as string)
    if (manifest && !wired.has(manifest.name)) {
      wireHooks(manifest)
      await ensureSchedulerJobs(manifest)
    }
  }
}
