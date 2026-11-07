import { isDeepStrictEqual } from 'node:util'
import { sql } from './db'
import { AppError } from './errors'
import { activeApps } from './app-lifecycle'
import { isActingSystemActor } from './system-actor'
import { asNameList, declaresOwnPages } from './installed-app-ledger'
import { admittedToTable } from './mandatory-access'

// PERM-001: role resolution for a principal — a person or a service account
// (person-rename R2). Every enabled principal implicitly holds 'All';
// explicit roles come from the Has Role child rows of either kind. Person and
// service-account ids live in separate namespaces (psn_ / svc_ / built-ins),
// so the id alone names the principal.
export async function getRoles(principal: string): Promise<string[]> {
  if (principal === 'Guest') return ['Guest']
  // The server's own actor (system-actor.ts), only inside its operation.
  if (isActingSystemActor(principal)) return ['All', 'System Manager']
  // One round trip: the roles held directly (app null), then the app roles
  // bound to them (#620, D4). getRoles runs on nearly every permission check.
  const rows = await sql`
    with held as (
      select role from has_role
      where parent = ${principal} and parenttype in ('Person', 'Service Account')
      -- #923: a person (never a service account) also holds the roles
      -- System Settings gives everyone who signs in, one per line.
      union
      -- Only a role that still exists, and never a platform role, whatever
      -- the stored text says.
      select ro.row_id from single_value s, regexp_split_to_table(s.value, E'\n') r
      join role ro on ro.row_id = btrim(r)
      where s.table_name = 'System Settings' and s.field = 'everyone_roles'
        and ro.row_id not in ${sql(PLATFORM_ROLES)}
        and exists (select 1 from person where row_id = ${principal}))
    select role, null as app from held
    union all
    select distinct b.app_role as role, b.app from app_role_binding b
    join installed_app a on a.name = b.app and a.enabled and not a.activation_pending
    where b.bound_role in (select role from held)
      and b.bound_role not in ${sql(OPEN_ROLES)}
      and b.app_role not in ${sql(PLATFORM_ROLES)}
      and jsonb_typeof(a.manifest->'roles') = 'array' and a.manifest->'roles' ? b.app_role
    order by app nulls first, role`
  const held = ['All', ...rows.filter((r) => r.app === null).map((r) => r.role as string)]
  // The same availability assertAppAvailable requires: enabled, not pending
  // activation, and its exact files loaded (activeApps).
  const bound = rows.filter((r) => r.app !== null && activeApps.has(String(r.app))).map((r) => r.role as string)
  return [...held, ...[...new Set(bound)].filter((role) => !held.includes(role)).sort()]
}

// #620 (D4): an app role is held through any role bound to it (App Role
// Binding), read fresh on every call. Only a role the app itself declares, of
// an enabled and available app, and never a platform role: a binding cannot
// hand out System Manager. One level: a role held only through a binding
// binds nothing further.
/** Roles no binding may involve as the app role: the platform's own. */
export const PLATFORM_ROLES: readonly string[] = ['Administrator', 'System Manager', 'All', 'Guest']
/** Roles no binding may carry an app role through: every signed-in person
 *  holds All, and anyone holds Guest. */
export const OPEN_ROLES: readonly string[] = ['All', 'Guest']

// PERM-002/003/009: role-based Table permissions from Permission rows.
// Administrator (and System Manager holders) bypass all checks so a fresh
// Table with no Permission rows is still manageable.
type PermAction =
  | 'read'
  | 'write'
  | 'create'
  | 'delete'
  | 'submit'
  | 'cancel'
  | 'amend'
  | 'read_identifiers'

// PERM-007: an own_rows_only grant applies only to rows the user created.
// 'all' = unconditional grant, 'own_rows' = created_by-scoped only, 'none' = denied.
type PermScope = 'all' | 'own_rows' | 'none'

export interface PermissionGrant {
  id: string
  scope: Exclude<PermScope, 'none'>
  columns: string[]
}

/** A grant's Columns: the listed metadata Column ids, or the level marker
 *  that keeps following its Columns as metadata changes. An unknown rule
 *  reaches nothing. */
function columnsOf(rule: string, listed: string[]): string[] {
  if (rule === 'every') return ['*']
  if (rule === 'basic') return ['@basic']
  return rule === 'listed' ? listed : []
}

/** Resolve whole contributions, including their prerequisites. A missing or
 * cyclic prerequisite contributes nothing; it never becomes an open grant. */
export async function permissionGrants(user: string, table: string, action: PermAction, parentPermission?: string, parentColumn?: string): Promise<PermissionGrant[]> {
  const roles = await getRoles(user)
  const rows = await sql`
    select p.row_id, p.scope_mode, p.column_rule, p.owner_app, p.requires_permission, p.parent_permission, p.parent_column,
      coalesce(array_agg(c.target_column) filter (where c.target_column is not null), '{}') as columns
    from permission p left join featherbase.permission_column c on c.parent = p.row_id
    where p.ref_table = ${table} and p.operation = ${action === 'write' ? 'update' : action}
      and p.role in ${sql(roles)}
    group by p.row_id`
  const active = new Map(rows.filter((row) => row.owner_app == null || activeApps.has(String(row.owner_app)))
    .map((row) => [String(row.row_id), row]))
  function resolve(id: string, seen = new Set<string>()): PermissionGrant | undefined {
    const row = active.get(id)
    if (!row || seen.has(id) || !['all', 'creator'].includes(String(row.scope_mode))) return
    seen.add(id)
    let scope: PermissionGrant['scope'] = row.scope_mode === 'creator' ? 'own_rows' : 'all'
    if (row.requires_permission) {
      const prerequisite = resolve(String(row.requires_permission), seen)
      if (!prerequisite) return
      if (prerequisite.scope === 'own_rows') scope = 'own_rows'
    }
    return { id, scope, columns: columnsOf(String(row.column_rule), row.columns as string[]) }
  }
  return rows.filter((row) => (row.parent_permission ?? undefined) === parentPermission &&
      (row.parent_column ?? undefined) === parentColumn)
    .flatMap((row) => { const grant = resolve(String(row.row_id)); return grant ? [grant] : [] })
}

export async function permissionScope(
  user: string,
  table: string,
  action: PermAction,
): Promise<PermScope> {
  if (!(await admittedToTable(user, table))) return 'none'
  if (await isPrivileged(user)) return 'all'
  const active = await permissionGrants(user, table, action)
  if (active.some((grant) => grant.scope === 'all')) return 'all'
  if (active.length) return 'own_rows'
  return 'none'
}

export async function hasPermission(
  user: string,
  table: string,
  action: PermAction,
): Promise<boolean> {
  return (await permissionScope(user, table, action)) !== 'none'
}

// PERM-008: is this specific row shared with the user for this action?
export async function isSharedWith(
  user: string,
  table: string,
  name: string,
  action: 'read' | 'write' | 'share',
): Promise<boolean> {
  const col = action === 'read' ? 'read' : action === 'write' ? 'write' : 'share'
  const [row] = await sql`
    select 1 from share
    where share_table = ${table} and share_name = ${name}
      and (person = ${user} or service_account = ${user}) and ${sql(col)} = true limit 1`
  return Boolean(row)
}

// For operations on a specific existing row: own-rows-scoped grants
// require created_by to match.
export async function assertDocPermission(
  user: string,
  table: string,
  action: PermAction,
  createdBy: string,
) {
  const scope = await permissionScope(user, table, action)
  if (scope === 'all') return
  if (scope === 'own_rows' && createdBy === user) return
  throw new AppError(
    'PermissionError',
    `No ${action} permission on ${table} for ${user}`,
  )
}

export async function assertPermission(
  user: string,
  table: string,
  action: PermAction,
) {
  if (!(await hasPermission(user, table, action)))
    throw new AppError(
      'PermissionError',
      `No ${action} permission on ${table} for ${user}`,
    )
}

/**
 * What Tables a principal can use, for drawing the shell (#410): the Tables
 * they can read or create in, and whether they can use the Admin screens.
 * Sub-tables and dropped Tables never count (same filter as
 * /api/navigable_tables). Grants to the implicit built-in `All` role (they come
 * from runtime apps) make a Table listable but do not by themselves earn the
 * Admin shell.
 *
 * `admin` is THE rule for "can use Admin" (#659): whoami's capability, the
 * sign-in landing and "Open Admin" all read it. It needs a Table grant of the
 * principal's own, or a shared row, on a Table that no installed app opening
 * at its own root owns: its installation declares pages of its own
 * (declaresOwnPages, read from the installed_app row, so it never depends on
 * the app's files loading). Such an
 * app's Tables and its contributed grants on core Tables are reached through
 * the app: every reader of
 * an app reads its entry Table, so counting them would hand the Admin to
 * everyone who can open an app. An app without pages of its own is used
 * through the Admin, so its Tables still count. App Tables are still listed
 * for anyone who can use Admin for another reason.
 */
export async function tableAccessFor(
  principal: string,
  roles: string[],
): Promise<{ readable: string[]; readableByOwnRole: string[]; creatable: string[]; ownGrant: boolean; admin: boolean }> {
  const rows = await sql`
    select p.ref_table, p.role, (p.operation = 'read') as can_read, p.owner_app,
      -- #432: a grant never makes a system-written Table creatable.
      -- #905: nor an archived one.
      (p.operation = 'create' and not d.system_written and d.archived_at is null) as can_create
    from permission p
    join table_def d on d.name = p.ref_table and d.kind = 'table'
    where p.parent_permission is null and p.requires_permission is null and p.role in ${sql(roles)}
      -- Reading identifiers says nothing about using a Table: it opens no Admin.
      and p.operation <> 'read_identifiers'`
  const active = rows.filter(
    (r) => r.owner_app == null || activeApps.has(String(r.owner_app)),
  )
  const names = (pick: (r: (typeof active)[number]) => boolean) =>
    [...new Set(active.filter(pick).map((r) => r.ref_table as string))].sort()
  const ownPages = await appsWithOwnPages()
  const shared = await sql`
    select distinct share_table from share
    where (person = ${principal} or service_account = ${principal}) and read = true`
  const ownGrant = active.some((r) => r.role !== 'All' && !ownPages.tables.has(String(r.ref_table)) && (r.owner_app == null || !ownPages.names.has(String(r.owner_app))))
  return {
    readable: names((r) => r.can_read),
    // Read through a role of the principal's own, never only through All: an
    // app open to everyone is no one's in particular (the sign-in landing).
    readableByOwnRole: names((r) => r.can_read && r.role !== 'All'),
    creatable: names((r) => r.can_create),
    ownGrant,
    admin: ownGrant || shared.some((r) => !ownPages.tables.has(String(r.share_table))),
  }
}

/** #659: installation declarations remain authoritative when code is missing
 *  or disabled. Both owned Tables and contributed grants belong in the app. */
async function appsWithOwnPages(): Promise<{ names: Set<string>; tables: Set<string> }> {
  const rows = (await sql`select name, tables, runtime_package, manifest from installed_app`).filter(declaresOwnPages)
  return {
    names: new Set(rows.map((row) => String(row.name))),
    tables: new Set(rows.flatMap((row) => asNameList(row.tables))),
  }
}

/** Administrator, or a principal of either kind holding System Manager. */
export async function isPrivileged(principal: string): Promise<boolean> {
  if (principal === 'Administrator') return true
  return (await getRoles(principal)).includes('System Manager')
}

// PERM-005: map of restricted Table -> allowed row names for a principal.
// The ONLY reader of data_scope (person-rename R2): list, get, reports,
// search, export, realtime, sales-target and bound sources all come here, so
// a scoped service account is narrowed exactly like a scoped person.
export async function getScopeMap(
  principal: string,
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>()
  const rows = await sql`
    select allow_table, for_value from data_scope
    where person = ${principal} or service_account = ${principal}`
  for (const r of rows) {
    const key = r.allow_table as string
    if (!map.has(key)) map.set(key, new Set())
    map.get(key)!.add(r.for_value as string)
  }
  return map
}

/** #246: how a principal's Data Scope narrows one Table. `own` limits the
 *  Table's own rows; each `refs` entry limits one Reference column, where an
 *  unset value passes unless the Table requires scope. `none` means the
 *  Table requires scope on a dimension the principal has no rows for: no row
 *  is theirs. Null when nothing narrows the Table. */
export interface TableScope {
  own?: Set<string>
  refs: { column: string; table: string; allowed: Set<string>; unsetPasses: boolean }[]
  none: boolean
  /** The scoped Tables the principal has no Data Scope on (when `none`). */
  missing: string[]
}

interface ScopedTable {
  name: string
  columns: { column_name: string; column_type: string; reference_table?: string | null }[]
  scope_on?: string[] | null
  scope_required?: boolean | null
}

/** The ONE reading of a Table's scope declaration. Without `scope_on`, every
 *  Reference to a scoped Table narrows (Frappe's discovery); with it, only the
 *  named columns do. `scope_required` is fail-closed: no rows on a declared
 *  dimension means no rows, and a row naming no value on it is not theirs. */
export function tableScope(meta: ScopedTable, map: Map<string, Set<string>>): TableScope | null {
  const declared = meta.scope_on?.length ? new Set(meta.scope_on) : null
  const required = Boolean(declared && meta.scope_required)
  const scope: TableScope = { own: map.get(meta.name), refs: [], none: false, missing: [] }
  for (const f of meta.columns) {
    if (f.column_type !== 'Reference' || !f.reference_table) continue
    if (declared && !declared.has(f.column_name)) continue
    const allowed = map.get(f.reference_table)
    if (allowed) scope.refs.push({ column: f.column_name, table: f.reference_table, allowed, unsetPasses: !required })
    else if (required) {
      scope.none = true
      if (!scope.missing.includes(f.reference_table)) scope.missing.push(f.reference_table)
    }
  }
  return scope.own || scope.refs.length || scope.none ? scope : null
}

/** Could this Table narrow anyone's rows, whatever their Data Scope? Lets a
 *  reader skip the Data Scope lookup only when the answer cannot matter. */
export function requiresScope(meta: ScopedTable): boolean {
  return Boolean(meta.scope_on?.length && meta.scope_required)
}

// Throws when a row (or its reference values) falls outside the user's
// permitted values.
export function checkUserPermissions(
  user: string,
  meta: ScopedTable,
  row: Record<string, unknown>,
  map: Map<string, Set<string>>,
) {
  const scope = tableScope(meta, map)
  if (!scope) return
  if (scope.none)
    throw new AppError('PermissionError', `${meta.name} rows are open only to people whose Data Scope names a ${scope.missing.join(' and a ')}`)
  if (scope.own && row.row_id != null && !scope.own.has(String(row.row_id)))
    throw new AppError(
      'PermissionError',
      `${meta.name} ${String(row.row_id)} is outside your permitted values`,
    )
  for (const ref of scope.refs) {
    const value = Object.hasOwn(row, ref.column) ? row[ref.column] : undefined
    if (value == null || value === '') {
      if (ref.unsetPasses) continue
      throw new AppError('PermissionError', `A ${meta.name} row must name a ${ref.table} within your permitted values`)
    }
    if (!ref.allowed.has(String(value)))
      throw new AppError(
        'PermissionError',
        `${ref.table} ${String(value)} is outside your permitted values`,
      )
  }
}

export type ColumnSelection = Set<string>
export const ALL_COLUMNS: ReadonlySet<string> = new Set(['*'])

/** Metadata Column IDs, never names or levels. With no Row this describes
 * potential visibility for metadata; Row access must still check its scope. */
export async function permittedColumns(
  user: string,
  table: string,
  action: 'read' | 'write' | 'create',
  createdBy?: string,
): Promise<ColumnSelection> {
  if (await isPrivileged(user)) return new Set(ALL_COLUMNS)
  const grants = await permissionGrants(user, table, action)
  return new Set(grants.filter((grant) => createdBy === undefined || grant.scope === 'all' || createdBy === user)
    .flatMap((grant) => grant.columns))
}

export function includesColumn(selection: ReadonlySet<string>, column: { row_id: string; tier: 'basic' | 'restricted' }): boolean {
  // @basic: every basic-level Column (a basic-level grant, or what leaves the
  // platform for nobody in particular).
  return selection.has('*') || selection.has(column.row_id) || (selection.has('@basic') && column.tier === 'basic')
}

// Strip Columns the reader was not granted, keeping system Row metadata.
export function filterReadFields(
  columns: { row_id: string; column_name: string; tier: 'basic' | 'restricted' }[],
  selection: ReadonlySet<string>,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (selection.has('*')) return row
  const out: Record<string, unknown> = {}
  const hidden = new Set(
    columns.filter((column) => !includesColumn(selection, column)).map((column) => column.column_name),
  )
  for (const [k, v] of Object.entries(row)) if (!hidden.has(k)) out[k] = v
  return out
}

// An ordinary column outside the grant rejects the whole correction. Silently
// discarding it would report success after saving only part of the request.
/** Whether a submitted value is the stored one, whatever form each arrived
 *  in: Currency is stored as text, a Date may come back as a Date, Check as
 *  '1', and an empty field as '' or null. */
export function sameStoredValue(columnType: string | undefined, submitted: unknown, stored: unknown): boolean {
  const empty = (value: unknown) => value === undefined || value === null || value === ''
  if (empty(submitted) || empty(stored)) return empty(submitted) && empty(stored)
  if (isDeepStrictEqual(submitted, stored)) return true
  switch (columnType) {
    case 'Int': case 'Float': case 'Currency': case 'Percent':
      return Number(submitted) === Number(stored) && !Number.isNaN(Number(stored))
    case 'Check': {
      const flag = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true'
      return flag(submitted) === flag(stored)
    }
    case 'Date': case 'Datetime': case 'Time': {
      const at = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).getTime()
      return !Number.isNaN(at(submitted)) && at(submitted) === at(stored)
    }
    case 'JSON': {
      const parse = (value: unknown) => { try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return value } }
      return isDeepStrictEqual(parse(submitted), parse(stored))
    }
    default:
      return typeof submitted !== 'object' && typeof stored !== 'object' && String(submitted) === String(stored)
  }
}

export function stripUnwritableFields(
  columns: { row_id: string; column_name: string; tier: 'basic' | 'restricted'; column_type?: string }[],
  selection: ReadonlySet<string>,
  values: Record<string, unknown>,
  stored?: Record<string, unknown>,
): Record<string, unknown> {
  if (selection.has('*')) return values
  const allowed = { ...values }
  for (const column of columns) {
    const name = column.column_name
    if (!Object.hasOwn(values, name) || includesColumn(selection, column)) continue
    // With nothing stored (a new row), only an empty value is "no change".
    if (!sameStoredValue(column.column_type, values[name], stored?.[name]))
      throw new AppError('PermissionError', `No write permission on column ${name}`)
    delete allowed[name]
  }
  return allowed
}

export async function assertSystemManager(user: string) {
  if (user === 'Administrator') return
  const roles = await getRoles(user)
  if (!roles.includes('System Manager'))
    throw new AppError('PermissionError', 'Requires the System Manager role')
}
