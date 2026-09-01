import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { sql } from './db'
import type { TableMeta } from './meta'

// DOC-003/DOC-004: per-Table controllers hook into the row lifecycle.
// Hook chain (all inside the save transaction), matching Frappe's order:
//   insert: before_insert -> before_validate -> validate -> before_save
//           -> INSERT -> after_insert -> after_save -> on_update
//   update: before_validate -> validate -> before_save
//           -> UPDATE -> after_save -> on_update
// Hooks may mutate ctx.row; a thrown error aborts the whole transaction.
// (after_save is this codebase's historical name; on_update is Frappe's —
// both fire, so hooks.py-style code ports over unchanged.)

export interface HookContext {
  row: Record<string, unknown>
  old?: Record<string, unknown>
  meta: TableMeta
  user: string
  isNew: boolean
  tx: typeof sql
  /**
   * Capabilities the WRITER declared for this save (SaveOptions.capabilities).
   * A hook may consult them to let a trusted engine past a guard it owns —
   * `budget-apply` is the only one today (spec 0007 BUD-R3: an approved
   * Budget Change writes bound rows through the normal lifecycle, so the
   * write-lock must recognise the engine rather than refuse it).
   *
   * This is a capability, not a role: it is never derived from client input,
   * only from an in-process caller that already proved its authority.
   */
  capabilities?: ReadonlySet<string>
}

export type Hook = (ctx: HookContext) => void | Promise<void>

export const HOOK_EVENTS = [
  'before_insert',
  'before_validate',
  'validate',
  'before_save',
  'after_insert',
  'after_save',
  'on_update',
  'before_submit',
  'on_submit',
  'before_cancel',
  'on_cancel',
  'on_trash',
  // Runs AFTER the control-DB transaction commits (insert, update and
  // delete alike). The only event where a cache may be invalidated: an
  // in-transaction invalidation can be repopulated from the pre-commit
  // state by a concurrent request, which left a source writable after it
  // was flipped to read-only (PR #103 review finding 6). `tx` here is the
  // plain pool, not a transaction — do not write through it expecting
  // rollback.
  'after_commit',
] as const
export type HookEvent = (typeof HOOK_EVENTS)[number]

// Frappe's doc_events["*"]: hooks registered under this Table key run for
// EVERY Table's lifecycle (framework-wide extensions like audit trails).
export const WILDCARD_TABLE = '*'

export interface TableController {
  table: string
  hooks: Partial<Record<HookEvent, Hook>>
}

const registry = new Map<string, TableController[]>()

export function registerController(controller: TableController) {
  const list = registry.get(controller.table) ?? []
  list.push(controller)
  registry.set(controller.table, list)
}

export function clearControllers(table: string) {
  registry.delete(table)
}

// PLAT-001/002: remove a single controller by reference (an app's doc_events on
// uninstall) without disturbing other controllers registered for the same
// Table — e.g. the core controller must survive.
export function unregisterController(controller: TableController) {
  const list = registry.get(controller.table)
  if (!list) return
  const next = list.filter((c) => c !== controller)
  if (next.length) registry.set(controller.table, next)
  else registry.delete(controller.table)
}

export async function runHooks(event: HookEvent, ctx: HookContext) {
  for (const controller of registry.get(ctx.meta.name) ?? []) {
    const hook = controller.hooks[event]
    if (hook) await hook(ctx)
  }
  // Wildcard controllers run after the specific ones, for every Table.
  for (const controller of registry.get(WILDCARD_TABLE) ?? []) {
    const hook = controller.hooks[event]
    if (hook) await hook(ctx)
  }
}

// DOC-004: controller modules live in src/controllers/*.ts, each default-
// exporting a TableController. Loaded once at boot; a new file needs a
// restart (tsx watch restarts automatically in dev).
let loaded = false
export async function loadControllers() {
  if (loaded) return
  loaded = true
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'controllers')
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => /\.(ts|js|mjs)$/.test(f))
  } catch {
    return
  }
  for (const file of files) {
    const mod = await import(pathToFileURL(join(dir, file)).href)
    const controller = mod.default as TableController | undefined
    if (controller?.table && controller.hooks) registerController(controller)
  }
}
