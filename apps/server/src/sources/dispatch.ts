import { sql } from '../db'
import { AppError } from '../errors'
import type { TableMeta } from '../meta'
import {
  getUserPermissionMap,
  isBypassUser,
  permissionScope,
  permittedTiers,
} from '../permissions'
import { isSensitiveColumn } from '../sensitive-columns'
import { getDriver, getSource, assertAllowed } from './registry'
import type { Binding, ListSpec, SourceConfig, SourceDriver, SourceFilter, SourceRow } from './types'

// The read half of the storage seam (M3): when a Table's metadata carries a
// data_source, list/count/get dispatch here instead of the control database.
// Permissions are checked on the control side FIRST (spec EDS-5, P1) and the
// query is pushed down to the driver with source-column names. The native
// path in query.ts/document.ts is untouched — it is the default driver.

const NO_COLUMN_TYPES = new Set(['Sub-table', 'Section Break', 'Column Break'])

export function isBound(meta: TableMeta): boolean {
  return Boolean(meta.data_source)
}

export interface BoundContext {
  cfg: SourceConfig
  driver: SourceDriver
  bind: Binding
}

// PERM-006: drop columns the caller's read tiers don't cover, so a
// restricted column cannot be selected, filtered, sorted or grouped through
// the bound path either — list and detail must agree (review finding 3).
function narrowToTiers(bind: Binding, meta: TableMeta, tiers: Set<'basic' | 'restricted'>): Binding {
  const allowed = new Map(meta.columns.map((c) => [c.column_name, c.tier ?? 'basic']))
  return {
    ...bind,
    columns: bind.columns.filter((c) => tiers.has(allowed.get(c.column_name) ?? 'basic')),
  }
}

export async function boundContext(meta: TableMeta): Promise<BoundContext> {
  const cfg = await getSource(meta.data_source!)
  const driver = getDriver(cfg)
  const schema = meta.external_schema ?? ''
  const table = meta.external_table ?? ''
  if (!table)
    throw new AppError('ValidationError', `${meta.name} is bound to ${cfg.name} but has no external_table`)
  // Runtime backstop for finding 7: the pk is serialized as `name`, so a
  // credential-named pk must never be queryable even if the binding was
  // written by hand rather than through reflection.
  const boundPk = meta.external_pk || 'name'
  if (isSensitiveColumn(boundPk))
    throw new AppError(
      'ValidationError',
      `${meta.name} is bound to a credential-named primary key (${boundPk}) and cannot be queried`,
    )
  assertAllowed(cfg, schema, table)
  const bind: Binding = {
    source: cfg,
    schema,
    table,
    pk: meta.external_pk || 'name',
    modified: meta.external_modified ?? null,
    columns: meta.columns
      .filter((c) => !NO_COLUMN_TYPES.has(c.column_type))
      // Credential-named columns are as unreadable on a source as they are
      // natively — dropped from the binding, so they can never be selected,
      // filtered, sorted, mapped out, or written (review finding 2).
      .filter(
        (c) => !isSensitiveColumn(c.column_name) && !isSensitiveColumn(c.source_column || ''),
      )
      .map((c) => ({
        column_name: c.column_name,
        source_column: c.source_column || c.column_name,
        column_type: c.column_type,
      })),
  }
  return { cfg, driver, bind }
}

// Doc-field name → source column. 'name' is the pk; 'updated_at' is the
// mapped modified column (when one exists).
function sourceColumnFor(bind: Binding, field: string): string | null {
  if (field === 'name') return bind.pk
  if (field === 'updated_at' && bind.modified) return bind.modified
  const col = bind.columns.find((c) => c.column_name === field)
  return col ? col.source_column : null
}

function requireSourceColumn(bind: Binding, field: string, what: string): string {
  const sc = sourceColumnFor(bind, field)
  if (!sc)
    throw new AppError('ValidationError', `Unknown ${what} field`, {
      [field]: `Unknown field ${field}`,
    })
  return sc
}

// Source row (source-column keys) → API doc row (column_name keys plus the
// synthesized standard columns of spec EDS-4).
export function mapRowOut(bind: Binding, row: SourceRow): SourceRow {
  const out: SourceRow = {
    name: row[bind.pk] == null ? null : String(row[bind.pk]),
    created_by: null,
    created_at: null,
    updated_at: bind.modified ? (row[bind.modified] ?? null) : null,
    updated_by: null,
    status: 'draft',
    position: 0,
  }
  for (const c of bind.columns)
    if (c.source_column in row) out[c.column_name] = row[c.source_column]
  return out
}

// Validated field values (column_name keys) → source row for a write.
export function mapValuesIn(bind: Binding, values: SourceRow): SourceRow {
  const out: SourceRow = {}
  for (const c of bind.columns)
    if (c.column_name in values) out[c.source_column] = values[c.column_name]
  return out
}

const OPS = new Set(['=', '!=', '>', '<', '>=', '<=', 'like', 'not like', 'in', 'not in'])

function mapFilters(bind: Binding, filters: unknown[]): SourceFilter[] {
  return filters.map((flt) => {
    if (!Array.isArray(flt) || flt.length !== 3)
      throw new AppError('ValidationError', 'Each filter must be [field, operator, value]')
    const [field, op, value] = flt as [string, string, unknown]
    if (!OPS.has(op)) throw new AppError('ValidationError', `Unknown filter operator ${op}`)
    return {
      column: requireSourceColumn(bind, field, 'filter'),
      op: op as SourceFilter['op'],
      value,
    }
  })
}

// EDS-4: a bound Table has no owner column, so owner-scoped permissions
// cannot be honored — deny loudly rather than leak (or mutate) every row.
// One gate for every action; document.ts uses it for create/write/delete
// (review finding 1: assertPermission alone accepted own_rows grants).
export async function assertBoundScope(
  meta: TableMeta,
  user: string,
  action: 'read' | 'create' | 'write' | 'delete',
): Promise<void> {
  const scope = await permissionScope(user, meta.name, action)
  if (scope === 'none')
    throw new AppError('PermissionError', `No ${action} permission on ${meta.name} for ${user}`)
  if (scope === 'own_rows')
    throw new AppError(
      'PermissionError',
      `${meta.name} is bound to data source ${meta.data_source} and has no owner column — own-rows permissions cannot apply`,
    )
}

// PERM-005 parity for bound lists (review finding 1): Data Scopes narrow by
// the table itself (pk ∈ allowed) and by Reference columns pointing at
// restricted tables — with the native NULL-passes semantics.
async function boundScopeFilters(
  meta: TableMeta,
  user: string,
  bind: Binding,
): Promise<SourceFilter[]> {
  if (await isBypassUser(user)) return []
  const upMap = await getUserPermissionMap(user)
  if (!upMap.size) return []
  const filters: SourceFilter[] = []
  const own = upMap.get(meta.name)
  if (own) filters.push({ column: bind.pk, op: 'in', value: [...own] })
  for (const c of meta.columns) {
    if (c.column_type !== 'Reference' || !c.reference_table) continue
    const allowed = upMap.get(c.reference_table)
    if (!allowed) continue
    const sc = sourceColumnFor(bind, c.column_name)
    if (sc) filters.push({ column: sc, op: 'in_or_null', value: [...allowed] })
  }
  return filters
}

export interface BoundListArgs {
  filters?: unknown[]
  fields?: string[]
  order_by?: string
  limit_start?: number
  limit_page_length?: number
}

export async function boundGetList(meta: TableMeta, args: BoundListArgs, user: string) {
  await assertBoundScope(meta, user, 'read')
  const ctx = await boundContext(meta)
  const driver = ctx.driver
  // Scope filters are built against the FULL binding (a Data Scope may
  // narrow by a restricted Reference the caller cannot see), then the
  // caller-facing binding is narrowed to their read tiers.
  const scopeFilters = await boundScopeFilters(meta, user, ctx.bind)
  const bind = narrowToTiers(ctx.bind, meta, await permittedTiers(user, meta.name, 'read'))

  const fields = args.fields?.length ? args.fields : ['name']
  const selectCols = fields.map((f) => requireSourceColumn(bind, f, 'selected'))

  let orderField = meta.sort_column || (bind.modified ? 'updated_at' : 'name')
  let orderDir = (meta.sort_order || 'desc').toLowerCase()
  if (args.order_by) {
    const m = args.order_by.trim().match(/^([a-z][a-z0-9_]*)\s*(asc|desc)?$/i)
    if (!m) throw new AppError('ValidationError', `Invalid order_by ${args.order_by}`)
    orderField = m[1]
    orderDir = (m[2] ?? 'asc').toLowerCase()
  }
  // A stale sort_column (e.g. the DB default updated_at with no modified
  // mapping) falls back to the pk instead of failing every list.
  // A caller-supplied order_by must resolve — silently falling back to the
  // pk would accept (and appear to honor) a column the caller may not read.
  // Only the Table's own stale sort_column default falls back.
  const orderColumn = args.order_by
    ? requireSourceColumn(bind, orderField, 'order_by')
    : (sourceColumnFor(bind, orderField) ?? bind.pk)

  const spec: ListSpec = {
    filters: [...mapFilters(bind, args.filters ?? []), ...scopeFilters],
    columns: selectCols,
    order: { column: orderColumn, dir: orderDir === 'desc' ? 'desc' : 'asc' },
    limit: Math.min(Math.max(args.limit_page_length ?? 20, 1), 500),
    offset: Math.max(args.limit_start ?? 0, 0),
  }
  const { rows, total } = await driver.getList(bind, spec)
  const wanted = new Set(['name', ...fields])
  const data = rows.map((r) => {
    const full = mapRowOut(bind, r)
    return Object.fromEntries(Object.entries(full).filter(([k]) => wanted.has(k)))
  })
  return { data, total, limit_start: spec.offset, limit_page_length: spec.limit }
}

export async function boundCountDocs(
  meta: TableMeta,
  filters: unknown[],
  user: string,
): Promise<number> {
  await assertBoundScope(meta, user, 'read')
  const ctx = await boundContext(meta)
  const driver = ctx.driver
  // Scope filters are built against the FULL binding (a Data Scope may
  // narrow by a restricted Reference the caller cannot see), then the
  // caller-facing binding is narrowed to their read tiers.
  const scopeFilters = await boundScopeFilters(meta, user, ctx.bind)
  const bind = narrowToTiers(ctx.bind, meta, await permittedTiers(user, meta.name, 'read'))
  return driver.count(bind, [...mapFilters(bind, filters), ...scopeFilters])
}

export async function boundGroupCount(
  meta: TableMeta,
  field: string,
  filters: unknown[],
  user: string,
): Promise<{ label: string; value: number }[]> {
  await assertBoundScope(meta, user, 'read')
  const ctx = await boundContext(meta)
  const driver = ctx.driver
  // Scope filters are built against the FULL binding (a Data Scope may
  // narrow by a restricted Reference the caller cannot see), then the
  // caller-facing binding is narrowed to their read tiers.
  const scopeFilters = await boundScopeFilters(meta, user, ctx.bind)
  const bind = narrowToTiers(ctx.bind, meta, await permittedTiers(user, meta.name, 'read'))
  return driver.groupCount(
    bind,
    requireSourceColumn(bind, field, 'group_by'),
    [...mapFilters(bind, filters), ...scopeFilters],
  )
}

// Raw fetch used by document.ts — permission checks and tier filtering stay
// there so read parity with native getDoc is exact.
export async function boundFetchDoc(meta: TableMeta, name: string): Promise<SourceRow | null> {
  const { bind, driver } = await boundContext(meta)
  const row = await driver.getDoc(bind, name)
  return row ? mapRowOut(bind, row) : null
}

// Write-side gate: hard driver capability plus the source's access mode
// (spec EDS-7: reject writes on read-only sources server-side).
//
// The access mode is re-read from the control DB rather than taken from the
// cached config. Cache invalidation alone cannot make "flip to read_only"
// take effect reliably — a concurrent request can repopulate the cache from
// pre-commit state and keep the source writable afterwards (review finding
// 6). Writes are rare; one indexed read closes the race outright.
export async function writableContext(meta: TableMeta): Promise<BoundContext> {
  const ctx = await boundContext(meta)
  if (!ctx.driver.writable)
    throw new AppError(
      'PermissionError',
      `Data source ${ctx.cfg.name} (${ctx.cfg.engine}) is read-only`,
    )
  const [live] = await sql<{ access: string }[]>`
    select access from data_source where name = ${ctx.cfg.name}`
  if (!live) throw new AppError('NotFoundError', `Data Source ${ctx.cfg.name} no longer exists`)
  if (live.access !== 'read_write')
    throw new AppError('PermissionError', `Data source ${ctx.cfg.name} is read-only`)
  return ctx
}
