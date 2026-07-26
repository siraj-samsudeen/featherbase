import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { createTable, tableName } from './doctype-engine'
import { invalidateMeta } from './meta'
import { saveDoc } from './document'
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

export interface AppManifest {
  name: string
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
    const [have] = await sql`select 1 from role where name = ${role}`
    if (have) continue
    await saveDoc('Role', { name: role })
    roles.push(role)
  }
  const perms: string[] = []
  for (const p of manifest.permissions ?? []) {
    const [role] = await sql`select 1 from role where name = ${p.role}`
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
    perms.push(String(saved.name))
  }
  return { roles, perms }
}

// Remove the grants an install created, then any of its roles that nothing
// references any more — a role survives while any Permission still links to
// it or any user still holds it (shared roles outlive one app's uninstall).
async function teardownAccess(roles: string[], perms: string[]): Promise<void> {
  for (const name of perms) await sql`delete from permission where name = ${name}`
  for (const role of roles) {
    const [inPerm] = await sql`select 1 from permission where role = ${role} limit 1`
    if (inPerm) continue
    const [held] = await sql`select 1 from has_role where role = ${role} limit 1`
    if (held) continue
    await sql`delete from role where name = ${role}`
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

type InstallResult = { name: string; tables: string[]; roles: string[]; perms: string[] }

// Shared install path: create the app's Tables (each goes through the
// normal engine → table), then its roles and grants — in that order, since a
// Permission links to a Role and may target a Table the app just created.
// `stored` is the declarative manifest to persist, or null for a code app.
async function materialize(manifest: AppManifest, stored: unknown): Promise<InstallResult> {
  if (await isInstalled(manifest.name))
    throw new AppError('ConflictError', `App ${manifest.name} is already installed`)
  const created: string[] = []
  for (const def of manifest.tables ?? []) {
    const meta = await createTable(def)
    created.push(meta.name)
  }
  const access = await provisionAccess(manifest)
  // Wire its doc_events, scheduler jobs, and method overrides. (A declarative
  // manifest has none of these — the loop bodies simply never run.)
  wireHooks(manifest)
  await ensureSchedulerJobs(manifest)
  // Cast the JSON text to jsonb explicitly — passing a JS string to a jsonb
  // column would otherwise double-encode it as a JSON string.
  await sql`
    insert into installed_app (name, tables, roles, perms, manifest)
    values (${manifest.name}, ${sql.json(created)}, ${sql.json(access.roles)},
            ${sql.json(access.perms)}, ${stored == null ? null : sql.json(stored as never)})`
  return { name: manifest.name, tables: created, roles: access.roles, perms: access.perms }
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

const declarativeManifestSchema = z
  .object({
    name: z.string().min(1),
    tables: z.array(z.unknown()).optional(),
    roles: z.array(z.string().min(1)).optional(),
    permissions: z.array(appPermissionSchema).optional(),
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
  const [row] = await sql`select tables, roles, perms from installed_app where name = ${name}`
  if (!row) throw new AppError('ValidationError', `App ${name} is not installed`)
  const tables = asNameList(row.tables)

  // Unwire hooks first so no lifecycle event fires against a half-dropped table.
  unwireHooks(name)
  const manifest = available.get(name)
  if (manifest) await dropSchedulerJobs(manifest)

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
