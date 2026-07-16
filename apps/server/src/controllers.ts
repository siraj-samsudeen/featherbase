import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { sql } from './db'
import type { DocTypeMeta } from './meta'

// DOC-003/DOC-004: per-DocType controllers hook into the document lifecycle.
// Hook chain (all inside the save transaction):
//   insert: before_insert -> validate -> before_save -> INSERT -> after_insert -> after_save
//   update: validate -> before_save -> UPDATE -> after_save
// Hooks may mutate ctx.doc; a thrown error aborts the whole transaction.

export interface HookContext {
  doc: Record<string, unknown>
  old?: Record<string, unknown>
  meta: DocTypeMeta
  user: string
  isNew: boolean
  tx: typeof sql
}

export type Hook = (ctx: HookContext) => void | Promise<void>

export const HOOK_EVENTS = [
  'before_insert',
  'validate',
  'before_save',
  'after_insert',
  'after_save',
  'on_submit',
  'on_cancel',
  'on_trash',
] as const
export type HookEvent = (typeof HOOK_EVENTS)[number]

export interface DocTypeController {
  doctype: string
  hooks: Partial<Record<HookEvent, Hook>>
}

const registry = new Map<string, DocTypeController[]>()

export function registerController(controller: DocTypeController) {
  const list = registry.get(controller.doctype) ?? []
  list.push(controller)
  registry.set(controller.doctype, list)
}

export function clearControllers(doctype: string) {
  registry.delete(doctype)
}

// PLAT-001/002: remove a single controller by reference (an app's doc_events on
// uninstall) without disturbing other controllers registered for the same
// DocType — e.g. the core controller must survive.
export function unregisterController(controller: DocTypeController) {
  const list = registry.get(controller.doctype)
  if (!list) return
  const next = list.filter((c) => c !== controller)
  if (next.length) registry.set(controller.doctype, next)
  else registry.delete(controller.doctype)
}

export async function runHooks(event: HookEvent, ctx: HookContext) {
  for (const controller of registry.get(ctx.meta.name) ?? []) {
    const hook = controller.hooks[event]
    if (hook) await hook(ctx)
  }
}

// DOC-004: controller modules live in src/controllers/*.ts, each default-
// exporting a DocTypeController. Loaded once at boot; a new file needs a
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
    const controller = mod.default as DocTypeController | undefined
    if (controller?.doctype && controller.hooks) registerController(controller)
  }
}
