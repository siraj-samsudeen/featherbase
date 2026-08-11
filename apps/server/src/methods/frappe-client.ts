import { whitelist } from '../methods'
import { AppError } from '../errors'
import { getMeta } from '../meta'
import { getDoc, saveDoc, deleteDoc } from '../document'
import { getList, countDocs, type Filter } from '../query'

// Frappe wire parity: the `frappe.client.*` RPC namespace real Frappe exposes
// over /api/method (and that frappe-js-sdk & friends call). Each handler is a
// thin adapter onto the existing engine, so permissions and lifecycle apply
// exactly as they do on the native routes. GET calls carry JSON in query
// strings, so structured params accept either JSON text or decoded values.
//
// WIRE COMPATIBILITY: the arg keys and return shapes below (`doctype`,
// `fieldname`, `child_doctypes`, ...) are Frappe's actual wire vocabulary and
// are deliberately NOT renamed to this codebase's Table/column_name/etc
// terminology — existing Frappe clients send and expect exactly these names.
// Only the internal calls onto the (renamed) engine are updated.

function asJson(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || !v) throw new AppError('ValidationError', `Expected ${key}`)
  return v
}

whitelist('frappe.ping', () => 'pong', { allowGuest: true, effect: 'read' })

whitelist('frappe.client.get_list', async ({ args, user }) => {
  const table = str(args, 'doctype')
  const result = await getList(
    table,
    {
      filters: (asJson(args.filters) as Filter[]) ?? [],
      fields: (asJson(args.fields) as string[]) ?? undefined,
      order_by: typeof args.order_by === 'string' ? args.order_by : undefined,
      limit_start: args.limit_start != null ? Number(args.limit_start) : undefined,
      limit_page_length: args.limit_page_length != null ? Number(args.limit_page_length) : undefined,
    },
    user.row_id,
  )
  // Frappe's get_list message is the row array itself.
  return result.data
}, { effect: 'read' })

whitelist('frappe.client.get', async ({ args, user }) => {
  return getDoc(str(args, 'doctype'), str(args, 'name'), user.row_id)
}, { effect: 'read' })

whitelist('frappe.client.get_count', async ({ args, user }) => {
  return countDocs(str(args, 'doctype'), (asJson(args.filters) as Filter[]) ?? [], user.row_id)
}, { effect: 'read' })

// Frappe returns { <fieldname>: <value> } for get_value. `filters` may be a
// docname string, a dict { field: value }, or a filter list — and a docname
// that LOOKS numeric must stay a docname: hash names are 10 hex chars, so
// "1234567890" (or "12345e6789") JSON-parses to a number, and the old
// string-check then fed it to getList as a filter list and crashed.
whitelist('frappe.client.get_value', async ({ args, user }) => {
  const table = str(args, 'doctype')
  const columnName = str(args, 'fieldname')
  const parsed = asJson(args.filters)
  const filterList = Array.isArray(parsed)
    ? (parsed as Filter[])
    : parsed && typeof parsed === 'object'
      ? (Object.entries(parsed).map(([field, value]) => [field, '=', value]) as Filter[])
      : null
  const name = filterList
    ? ((await getList(table, { filters: filterList, limit_page_length: 1 }, user.row_id))
        .data[0]?.name as string | undefined)
    : args.filters != null && args.filters !== ''
      ? String(args.filters)
      : undefined
  if (!name) return null
  const row = await getDoc(table, name, user.row_id)
  return { [columnName]: row[columnName] ?? null }
}, { effect: 'read' })

whitelist('frappe.client.insert', async ({ args, user }) => {
  const doc = asJson(args.doc) as Record<string, unknown> | undefined
  const table = typeof doc?.doctype === 'string' ? doc.doctype : undefined
  if (!doc || !table) throw new AppError('ValidationError', 'Expected doc with a doctype')
  const { doctype: _dt, ...values } = doc
  return saveDoc(table, values, user.row_id, 'insert')
}, { effect: 'write' })

// set_value: load-modify-save through the full lifecycle (validation, hooks,
// versioning) — matching Frappe's frappe.client.set_value semantics.
whitelist('frappe.client.set_value', async ({ args, user }) => {
  const table = str(args, 'doctype')
  const name = str(args, 'name')
  const columnName = str(args, 'fieldname')
  const current = await getDoc(table, name, user.row_id)
  return saveDoc(
    table,
    { name, updated_at: current.updated_at, [columnName]: args.value ?? null },
    user.row_id,
  )
}, { effect: 'write' })

whitelist('frappe.client.delete', async ({ args, user }) => {
  await deleteDoc(str(args, 'doctype'), str(args, 'name'), user.row_id)
  return 'ok'
}, { effect: 'write' })

// The meta bundle (Frappe's get_meta / PR-2's get_doctype): the Table row
// with its columns, plus metas for its child-table Tables.
whitelist('frappe.client.get_doctype', async ({ args }) => {
  const meta = await getMeta(str(args, 'doctype'))
  const children = await Promise.all(
    meta.columns
      .filter((f) => f.column_type === 'Sub-table' && f.row_table)
      .map((f) => getMeta(f.row_table as string)),
  )
  return { doctype: meta, child_doctypes: children }
}, { effect: 'read' })
