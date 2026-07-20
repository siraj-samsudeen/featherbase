import { sql } from './db'
import { AppError } from './errors'
import { createDocType, tableName } from './doctype-engine'
import { invalidateMeta } from './meta'
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
// `tab_installed_app` table only records which apps are installed and which
// DocTypes each owns, so state survives restarts.

export interface SchedulerEvent {
  // The job method name (registered in the job registry; must be unique).
  method: string
  handler: JobHandler
  every_seconds: number
}

export interface AppManifest {
  name: string
  // DocType definitions this app owns (same shape accepted by createDocType).
  doctypes?: unknown[]
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

// The jsonb `doctypes` column round-trips as an array, but tolerate a stored
// JSON string too (defensive against any legacy double-encoded row).
function asDoctypeList(v: unknown): string[] {
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

export async function isInstalled(name: string): Promise<boolean> {
  const [row] = await sql`select 1 from tab_installed_app where name = ${name}`
  return Boolean(row)
}

export async function listInstalledApps(): Promise<{ name: string; doctypes: string[]; installed_at: Date }[]> {
  const rows = await sql`select name, doctypes, installed_at from tab_installed_app order by installed_at asc`
  return rows.map((r) => ({
    name: r.name as string,
    doctypes: asDoctypeList(r.doctypes),
    installed_at: r.installed_at as Date,
  }))
}

export async function installApp(name: string): Promise<{ name: string; doctypes: string[] }> {
  const manifest = available.get(name)
  if (!manifest) throw new AppError('ValidationError', `Unknown app: ${name}`, { name: 'Not registered' })
  if (await isInstalled(name)) throw new AppError('ConflictError', `App ${name} is already installed`)

  // Create the app's DocTypes (each goes through the normal engine → table).
  const created: string[] = []
  for (const def of manifest.doctypes ?? []) {
    const meta = await createDocType(def)
    created.push(meta.name)
  }
  // Wire its doc_events, scheduler jobs, and method overrides.
  wireHooks(manifest)
  await ensureSchedulerJobs(manifest)
  // Cast the JSON text to jsonb explicitly — passing a JS string to a jsonb
  // column would otherwise double-encode it as a JSON string.
  await sql`
    insert into tab_installed_app (name, doctypes)
    values (${name}, ${sql.json(created)})`
  return { name, doctypes: created }
}

export async function uninstallApp(name: string): Promise<{ name: string; removed: string[] }> {
  const [row] = await sql`select doctypes from tab_installed_app where name = ${name}`
  if (!row) throw new AppError('ValidationError', `App ${name} is not installed`)
  const doctypes = asDoctypeList(row.doctypes)

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
