import { sql } from './db'
import { AppError } from './errors'
import { createDocType, tableName } from './doctype-engine'
import { invalidateMeta } from './meta'
import { saveDoc } from './document'
import { enqueue, registerJob, type JobHandler } from './jobs'
import { swapMethod, type MethodDef, type ServerMethod } from './methods'
import {
  registerController,
  unregisterController,
  type DocTypeController,
  type Hook,
  type HookEvent,
} from './controllers'

// PLAT-001/002: the app system. An app is a code-defined manifest that can
// declare DocTypes and doc_events (lifecycle hooks on ANY DocType, including
// ones it doesn't own). Installing an app materializes its DocTypes and wires
// its hooks; uninstalling tears its DocTypes down and unwires its hooks —
// without disturbing the core controllers or other apps on the same DocType.
//
// App CODE (manifests + hook functions) lives in the process; the
// `tab_installed_app` table records which apps are installed and what each
// install created (DocTypes, roles, grants), so state survives restarts.

export interface SchedulerEvent {
  // The job method name (registered in the job registry; must be unique).
  method: string
  handler: JobHandler
  every_seconds: number
}

// PLAT-004 (#54): a role grant an app declares on a DocType. `doctype` may
// name a DocType the app does not own — the same latitude doc_events has.
export interface AppPermission {
  doctype: string
  role: string
  permlevel?: number
  if_owner?: boolean
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
  // DocType definitions this app owns (same shape accepted by createDocType).
  doctypes?: unknown[]
  // Roles this app needs. An existing role of the same name is adopted, not
  // redefined — roles are shared between apps and users.
  roles?: string[]
  // DocPerm grants this app declares. An existing grant of the same identity
  // (doctype, role, permlevel) is adopted as-is — overwriting a pre-existing
  // grant's flags would be worse than ignoring a redundant declaration.
  permissions?: AppPermission[]
  // Lifecycle hooks keyed by target DocType then event. The target need not be
  // owned by this app — that is the whole point of doc_events (PLAT-002). The
  // "*" key hooks EVERY DocType (Frappe's doc_events["*"]).
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
const wired = new Map<string, DocTypeController[]>()
// Method overrides per app, with the previous definition for restore.
const overridden = new Map<string, { path: string; prev: MethodDef | undefined }[]>()

export function registerApp(manifest: AppManifest): void {
  available.set(manifest.name, manifest)
}

export function getAvailableApps(): string[] {
  return [...available.keys()]
}

// The jsonb ledger columns (doctypes/roles/perms) round-trip as arrays, but
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
  const controllers: DocTypeController[] = []
  for (const [doctype, hooks] of Object.entries(manifest.doc_events ?? {})) {
    const controller: DocTypeController = { doctype, hooks }
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
    const prev = swapMethod(path, { fn, allowGuest: false })
    if (prev) swapMethod(path, { fn, allowGuest: prev.allowGuest })
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
      select 1 from tab_background_job
      where method = ${ev.method} and status in ('queued', 'running') limit 1`
    if (!pending) await enqueue(ev.method, {}, { repeatEvery: ev.every_seconds })
  }
}

// Remove an uninstalled app's pending recurring jobs so they stop firing.
async function dropSchedulerJobs(manifest: AppManifest): Promise<void> {
  for (const ev of manifest.scheduler_events ?? []) {
    await sql`delete from tab_background_job where method = ${ev.method} and status = 'queued'`
  }
}

// PLAT-004 (#54): materialize the manifest's roles and DocPerms. Returns only
// what this install genuinely CREATED — adopted (pre-existing) roles and
// grants are not recorded, so uninstall can never remove something that
// predated the app.
async function provisionAccess(manifest: AppManifest): Promise<{ roles: string[]; perms: string[] }> {
  const roles: string[] = []
  for (const role of manifest.roles ?? []) {
    const [have] = await sql`select 1 from tab_role where name = ${role}`
    if (have) continue
    await saveDoc('Role', { name: role })
    roles.push(role)
  }
  const perms: string[] = []
  for (const p of manifest.permissions ?? []) {
    const [role] = await sql`select 1 from tab_role where name = ${p.role}`
    if (!role)
      throw new AppError(
        'ValidationError',
        `Permission on ${p.doctype} names unknown role ${p.role} — declare it in the manifest's roles`,
      )
    if (p.can_create && !p.can_write)
      console.warn(
        `[apps] ${manifest.name}: grant for ${p.role} on ${p.doctype} has can_create without can_write — ` +
          `inserts strip every field the role cannot write, so created documents will be empty (add can_write)`,
      )
    const permlevel = p.permlevel ?? 0
    const [have] = await sql`
      select 1 from tab_docperm
      where ref_doctype = ${p.doctype} and role = ${p.role} and permlevel = ${permlevel}`
    if (have) continue
    const saved = await saveDoc('DocPerm', {
      ref_doctype: p.doctype,
      role: p.role,
      permlevel,
      if_owner: p.if_owner ?? false,
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
// references any more — a role survives while any DocPerm still links to it
// or any user still holds it (shared roles outlive one app's uninstall).
async function teardownAccess(roles: string[], perms: string[]): Promise<void> {
  for (const name of perms) await sql`delete from tab_docperm where name = ${name}`
  for (const role of roles) {
    const [inPerm] = await sql`select 1 from tab_docperm where role = ${role} limit 1`
    if (inPerm) continue
    const [held] = await sql`select 1 from tab_has_role where role = ${role} limit 1`
    if (held) continue
    await sql`delete from tab_role where name = ${role}`
  }
}

export async function isInstalled(name: string): Promise<boolean> {
  const [row] = await sql`select 1 from tab_installed_app where name = ${name}`
  return Boolean(row)
}

export async function listInstalledApps(): Promise<{ name: string; doctypes: string[]; installed_at: Date }[]> {
  const rows = await sql`select name, doctypes, installed_at from tab_installed_app order by installed_at asc`
  return rows.map((r) => ({
    name: r.name as string,
    doctypes: asNameList(r.doctypes),
    installed_at: r.installed_at as Date,
  }))
}

export async function installApp(
  name: string,
): Promise<{ name: string; doctypes: string[]; roles: string[]; perms: string[] }> {
  const manifest = available.get(name)
  if (!manifest) throw new AppError('ValidationError', `Unknown app: ${name}`, { name: 'Not registered' })
  if (await isInstalled(name)) throw new AppError('ConflictError', `App ${name} is already installed`)

  // Create the app's DocTypes (each goes through the normal engine → table),
  // then its roles and grants — in that order, since a DocPerm links to a
  // Role and may target a DocType the app just created.
  const created: string[] = []
  for (const def of manifest.doctypes ?? []) {
    const meta = await createDocType(def)
    created.push(meta.name)
  }
  const access = await provisionAccess(manifest)
  // Wire its doc_events, scheduler jobs, and method overrides.
  wireHooks(manifest)
  await ensureSchedulerJobs(manifest)
  // Cast the JSON text to jsonb explicitly — passing a JS string to a jsonb
  // column would otherwise double-encode it as a JSON string.
  await sql`
    insert into tab_installed_app (name, doctypes, roles, perms)
    values (${name}, ${sql.json(created)}, ${sql.json(access.roles)}, ${sql.json(access.perms)})`
  return { name, doctypes: created, roles: access.roles, perms: access.perms }
}

export async function uninstallApp(name: string): Promise<{ name: string; removed: string[] }> {
  const [row] = await sql`select doctypes, roles, perms from tab_installed_app where name = ${name}`
  if (!row) throw new AppError('ValidationError', `App ${name} is not installed`)
  const doctypes = asNameList(row.doctypes)

  // Unwire hooks first so no lifecycle event fires against a half-dropped table.
  unwireHooks(name)
  const manifest = available.get(name)
  if (manifest) await dropSchedulerJobs(manifest)

  for (const dt of doctypes) {
    const table = tableName(dt)
    await sql`delete from tab_docfield where parent = ${dt}`
    await sql`delete from tab_doctype where name = ${dt}`
    await sql.unsafe(`drop table if exists ${table} cascade`)
    invalidateMeta(dt)
  }
  // Access teardown works from the install ledger, so it removes exactly what
  // this install created — adopted roles/grants were never recorded.
  await teardownAccess(asNameList(row.roles), asNameList(row.perms))
  await sql`delete from tab_installed_app where name = ${name}`
  return { name, removed: doctypes }
}

// PLAT-001: on boot, re-wire the doc_events of already-installed apps (their
// DocTypes already exist in the DB). Unknown installed apps (code removed) are
// skipped — their tables simply remain until re-registered or uninstalled.
export async function loadInstalledApps(): Promise<void> {
  const rows = await sql`select name from tab_installed_app`
  for (const r of rows) {
    const manifest = available.get(r.name as string)
    if (manifest && !wired.has(manifest.name)) {
      wireHooks(manifest)
      await ensureSchedulerJobs(manifest)
    }
  }
}
