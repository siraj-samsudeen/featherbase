import vm from 'node:vm'
import { sql } from './db'
import { AppError } from './errors'

// CUST-004: sandboxed Server Scripts. Scripts run in a fresh V8 context
// (node:vm). SECURITY: we expose NO host objects to the script — not even
// built-ins. Injecting a host object (Object, Array, doc, frappe, …) would leak
// the host realm, because that object's `.constructor` is the host `Function`
// and `hostFunction("return process")()` runs in the HOST realm. Instead, all
// inputs cross the boundary as JSON string PRIMITIVES (whose `.constructor`
// resolves to the context's own String), are `JSON.parse`d INSIDE the context,
// and results come back as a JSON string. `frappe`/`console` are defined inside
// the context. So `Object`, `Function`, etc. seen by the script are the
// context's own, and `process`/`require`/`fetch` are simply not defined.
//
// The scripting surface exposed to user code still names the row variable
// `doc` (this is the Server Script authoring DSL, not the internal schema —
// existing scripts keep working unchanged).

interface RunResult {
  rowJson?: string // updated row, for row-event scripts
  resultJson?: string // API return value
}

// Builds the in-context bootstrap that parses inputs, defines the frappe API,
// runs the user code, and serializes outputs — all with context-native values.
function wrap(userCode: string, kind: 'row' | 'api'): string {
  const inputs =
    kind === 'row'
      ? 'var doc = JSON.parse(__inputJson); var args = undefined;'
      : 'var args = JSON.parse(__inputJson); var doc = undefined; var result;'
  const outputs =
    kind === 'row'
      ? '__outDocJson = JSON.stringify(doc);'
      : '__outResultJson = JSON.stringify(typeof result === "undefined" ? null : result);'
  // Strict mode so top-level `this` is undefined; the user body runs inside an
  // IIFE with only context-native bindings in scope.
  return `"use strict";
(function () {
  ${inputs}
  var frappe = { throw: function (m) { var e = new Error(String(m)); e.__frappeThrow = true; throw e; } };
  var console = { log: function () {}, warn: function () {}, error: function () {}, info: function () {} };
  (function (doc, args, frappe, console) {
${userCode}
  })(doc, args, frappe, console);
  ${outputs}
})();`
}

function run(userCode: string, kind: 'row' | 'api', inputJson: string, scriptName: string): RunResult {
  // The context object carries ONLY primitives (input JSON + output slots).
  const context = vm.createContext({
    __inputJson: inputJson,
    __outDocJson: null,
    __outResultJson: null,
  })
  try {
    vm.runInContext(wrap(userCode, kind), context, { timeout: 500, displayErrors: false })
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new AppError(
      'ValidationError',
      `Server Script "${scriptName}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const c = context as { __outDocJson: string | null; __outResultJson: string | null }
  return { rowJson: c.__outDocJson ?? undefined, resultJson: c.__outResultJson ?? undefined }
}

// Runs a row-event script, merging back only the columns the script changed
// (so system columns like updated_at keep their native host values/types).
function runRowScript(userCode: string, row: Record<string, unknown>, scriptName: string): void {
  const beforeJson = JSON.stringify(row)
  const { rowJson } = run(userCode, 'row', beforeJson, scriptName)
  if (!rowJson) return
  const before = JSON.parse(beforeJson) as Record<string, unknown>
  const after = JSON.parse(rowJson) as Record<string, unknown>
  for (const k of Object.keys(after)) {
    if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) row[k] = after[k]
  }
}

// Conditional workflow transitions: evaluate an admin-authored boolean
// expression over `doc`, in the SAME hardened sandbox as Server Scripts — the
// context carries only the row's JSON (parsed inside), and no host object is
// ever exposed, so the expression can read `doc` but cannot reach process /
// require / fetch. A blank condition is treated as always-true.
export function evalCondition(
  expr: string | null | undefined,
  row: Record<string, unknown>,
  label = 'condition',
): boolean {
  const src = String(expr ?? '').trim()
  if (!src) return true
  const context = vm.createContext({ __inputJson: JSON.stringify(row), __outResultJson: null })
  const code = `"use strict";
(function () {
  var doc = JSON.parse(__inputJson);
  var __r = (function (doc) { return ( ${src} ); })(doc);
  __outResultJson = JSON.stringify(!!__r);
})();`
  try {
    vm.runInContext(code, context, { timeout: 500, displayErrors: false })
  } catch (err) {
    throw new AppError(
      'ValidationError',
      `Workflow condition (${label}): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return (context as { __outResultJson: string | null }).__outResultJson === 'true'
}

export type RowEvent = 'validate' | 'before_save' | 'after_save'

// Runs every enabled Row-Event script for this table+event, inside the
// save transaction. A script that throws (or calls frappe.throw) aborts the
// save. Queries run on the caller's transaction connection (`db`) — the global
// pool would deadlock, since the save already holds a pool connection while many
// saves run concurrently.
export async function runDocEventScripts(
  event: RowEvent,
  table: string,
  row: Record<string, unknown>,
  db: typeof sql = sql,
): Promise<void> {
  const [ok] = await db`
    select 1 from information_schema.tables where table_name = 'server_script'`
  if (!ok) return
  const scripts = await db`
    select row_id, script from server_script
    where script_type = 'Document Event' and ref_table = ${table}
      and event = ${event} and enabled = true`
  for (const s of scripts) runRowScript(s.script as string, row, s.row_id as string)
}

// CUST-004 (API scripts): run a named API server script. The script assigns
// `result`; we return whatever it left there (round-tripped through JSON).
export async function runApiScript(
  method: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const [ok] = await sql`
    select 1 from information_schema.tables where table_name = 'server_script'`
  if (!ok) throw new AppError('NotFoundError', `No such server script: ${method}`)
  const [s] = await sql`
    select row_id, script from server_script
    where script_type = 'API' and api_method = ${method} and enabled = true`
  if (!s) throw new AppError('NotFoundError', `No such server script: ${method}`)

  const { resultJson } = run(s.script as string, 'api', JSON.stringify(args ?? {}), s.row_id as string)
  return resultJson ? (JSON.parse(resultJson) as unknown) : null
}
