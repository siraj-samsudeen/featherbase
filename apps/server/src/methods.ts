import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { SessionUser } from './auth'
import { AppError } from './errors'

// API-003: whitelisted server methods callable over /api/method/:path.
// A method is a plain function; only functions registered here (whitelisted)
// are reachable — anything else 403s, so internal helpers stay internal.

export interface MethodContext {
  args: Record<string, unknown>
  user: SessionUser
}

export type ServerMethod = (ctx: MethodContext) => unknown | Promise<unknown>

interface MethodDef {
  fn: ServerMethod
  allowGuest: boolean
}

const registry = new Map<string, MethodDef>()

export function whitelist(
  path: string,
  fn: ServerMethod,
  opts: { allowGuest?: boolean } = {},
): void {
  registry.set(path, { fn, allowGuest: opts.allowGuest ?? false })
}

export function isWhitelisted(path: string): boolean {
  return registry.has(path)
}

export function methodAllowsGuest(path: string): boolean {
  return registry.get(path)?.allowGuest ?? false
}

export async function callMethod(
  path: string,
  args: Record<string, unknown>,
  user: SessionUser,
): Promise<unknown> {
  const def = registry.get(path)
  if (!def) throw new AppError('PermissionError', `Method ${path} is not whitelisted`)
  return def.fn({ args, user })
}

// Method modules live in src/methods/*.ts, each calling whitelist(...) at
// import time. Loaded once at boot alongside controllers.
let loaded = false
export async function loadMethods(): Promise<void> {
  if (loaded) return
  loaded = true
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'methods')
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => /\.(ts|js|mjs)$/.test(f))
  } catch {
    return
  }
  for (const file of files) await import(pathToFileURL(join(dir, file)).href)
}
