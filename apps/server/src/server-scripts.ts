import vm from 'node:vm'
import { sql } from './db'
import { AppError } from './errors'

// CUST-004: sandboxed Server Scripts. Scripts run in a fresh V8 context
// (node:vm) whose only globals are `doc`, `frappe` (a tiny API), and the
// standard JS built-ins. Node capabilities — require, process, fetch, Buffer,
// module — are simply not in scope, so a script cannot touch the filesystem,
// network, or process. Execution is time-boxed to stop runaway loops.

export type DocEvent = 'validate' | 'before_save' | 'after_save'

interface Frappe {
  throw: (message: string) => never
}

function runSandboxed(code: string, doc: Record<string, unknown>, scriptName: string): void {
  const frappe: Frappe = {
    throw: (message: string) => {
      throw new AppError('ValidationError', String(message))
    },
  }
  // The context object IS the script's globalThis. It deliberately excludes
  // require/process/fetch/Buffer/module/globalThis-of-host, so those identifiers
  // are undefined and any access throws inside the sandbox.
  const context = vm.createContext({
    doc, // shared by reference: field mutations flow back to the caller
    frappe,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    JSON,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
  })
  try {
    vm.runInContext(code, context, { timeout: 500, displayErrors: false })
  } catch (err) {
    if (err instanceof AppError) throw err // frappe.throw or an explicit rejection
    // Any other error (including ReferenceError from touching a blocked global,
    // or a thrown Error used as a guard) aborts the save as a validation error.
    throw new AppError(
      'ValidationError',
      `Server Script "${scriptName}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// Runs every enabled Document-Event script for this doctype+event, inside the
// save transaction. A script that throws (or calls frappe.throw) aborts the
// save. Queries run on the caller's transaction connection (`db`) — using the
// global pool here would deadlock it, since the save already holds a pool
// connection while many saves run concurrently.
export async function runDocEventScripts(
  event: DocEvent,
  doctype: string,
  doc: Record<string, unknown>,
  db: typeof sql = sql,
): Promise<void> {
  const [ok] = await db`
    select 1 from information_schema.tables where table_name = 'tab_server_script'`
  if (!ok) return
  const scripts = await db`
    select name, script from tab_server_script
    where script_type = 'Document Event' and reference_doctype = ${doctype}
      and event = ${event} and enabled = true`
  for (const s of scripts) runSandboxed(s.script as string, doc, s.name as string)
}

// CUST-004 (API scripts): run a named API server script. The script sets
// `frappe.response` (or returns via a `result` variable) — we expose a simple
// `result` binding it can assign. Returns whatever the script left in `result`.
export async function runApiScript(
  method: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const [ok] = await sql`
    select 1 from information_schema.tables where table_name = 'tab_server_script'`
  if (!ok) throw new AppError('NotFoundError', `No such server script: ${method}`)
  const [s] = await sql`
    select name, script from tab_server_script
    where script_type = 'API' and api_method = ${method} and enabled = true`
  if (!s) throw new AppError('NotFoundError', `No such server script: ${method}`)

  const box: { result: unknown } = { result: null }
  const frappe: Frappe = {
    throw: (message: string) => {
      throw new AppError('ValidationError', String(message))
    },
  }
  const context = vm.createContext({
    args,
    result: undefined,
    frappe,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    JSON,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
  })
  try {
    vm.runInContext(s.script as string, context, { timeout: 500, displayErrors: false })
    box.result = (context as { result?: unknown }).result
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new AppError('ValidationError', `Server Script "${s.name}": ${err instanceof Error ? err.message : String(err)}`)
  }
  return box.result
}
