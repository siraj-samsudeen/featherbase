import { isDeepStrictEqual } from 'node:util'
import { sql } from './db'
import { AppError } from './errors'
import { activeApps, isProvisioningApp } from './app-lifecycle'
import { isActingSystemActor } from './system-actor'
import { asNameList, declaresOwnPages } from './installed-app-ledger'
import { administrationApps, administrationFor, assignmentPredicate, scopedRoles, type AssignmentScope, type ScopeRow } from './administration-scopes'
import { effectiveAssignments } from './administration-authority'
import { tableRelation } from './table-engine'

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
      where parent = ${principal} and parenttype in ('Person', 'Service Account'))
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

export async function enabledPrincipal(user: string): Promise<boolean> {
  const [person] = await sql`select enabled from featherbase.person where row_id = ${user}
    union all select enabled from featherbase.service_account where row_id = ${user}`
  return person?.enabled === true
}

// PERM-002/003/009: role-based Table permissions from Permission rows.
// Administrator (and System Manager holders) bypass all checks so a fresh
// Table with no Permission rows is still manageable.
export type PermAction =
  | 'read'
  | 'write'
  | 'create'
  | 'delete'
  | 'submit'
  | 'cancel'
  | 'amend'
  | 'approve'
  | 'read_identifiers'

// PERM-007: an own_rows_only grant applies only to rows the user created.
// 'all' = unconditional grant, 'own_rows' = created_by-scoped only, 'none' = denied.
type PermScope = 'all' | 'own_rows' | 'scoped' | 'none'

export interface PermissionGrant {
  id: string
  role: string
  scope: 'all' | 'own_rows'
  columns: string[]
  assignments?: AssignmentScope[]
  prerequisite?: PermissionGrant
}

/** Resolve whole contributions, including their prerequisites. A missing or
 * cyclic prerequisite contributes nothing; it never becomes an open grant. */
export async function permissionGrants(user: string, table: string, action: PermAction, parentPermission?: string, parentColumn?: string): Promise<PermissionGrant[]> {
  if (administrationFor(table.split('.')[0]) && !await enabledPrincipal(user)) return []
  const roles = await getRoles(user)
  const assignments = await scopedRoles(user, table)
  const rows = await sql`
    select p.row_id, p.role, p.scope_mode, p.owner_app, p.requires_permission, p.parent_permission, p.parent_column,
      coalesce(array_agg(c.target_column) filter (where c.target_column is not null), '{}') as columns
    from permission p left join featherbase.permission_column c on c.parent = p.row_id
    where p.ref_table = ${table} and p.operation = ${action === 'write' ? 'update' : action}
      and p.role in ${sql([...new Set([...roles, ...assignments.keys()])])}
    group by p.row_id`
  const active = new Map(rows.filter((row) => row.owner_app == null || activeApps.has(String(row.owner_app)))
    .map((row) => [String(row.row_id), row]))
  function resolve(id: string, seen = new Set<string>()): PermissionGrant | undefined {
    const row = active.get(id)
    if (!row || seen.has(id) || !['all', 'creator'].includes(String(row.scope_mode))) return
    seen.add(id)
    let scope: PermissionGrant['scope'] = row.scope_mode === 'creator' ? 'own_rows' : 'all'
    let prerequisite: PermissionGrant | undefined
    if (row.requires_permission) {
      prerequisite = resolve(String(row.requires_permission), seen)
      if (!prerequisite) return
      if (prerequisite.scope === 'own_rows') scope = 'own_rows'
    }
    return { id, role: String(row.role), scope, columns: row.columns as string[], prerequisite,
      assignments: roles.includes(String(row.role)) ? undefined : assignments.get(String(row.role)) }
  }
  function contributions(grant: PermissionGrant): PermissionGrant[] {
    const scopes = grant.assignments ? grant.assignments.map(scope => [scope]) : [undefined]
    const prerequisites = grant.prerequisite ? contributions(grant.prerequisite) : [undefined]
    return scopes.flatMap(assignments => prerequisites.map(prerequisite => ({ ...grant, assignments, prerequisite })))
  }
  return rows.filter((row) => (row.parent_permission ?? undefined) === parentPermission &&
      (row.parent_column ?? undefined) === parentColumn)
    .flatMap((row) => { const grant = resolve(String(row.row_id)); return grant ? contributions(grant) : [] })
}

/** One complete contribution: its Columns, assignment and prerequisites must
 * match together. SQL predicates are wrapped because the driver is thenable. */
export async function grantPredicate(user: string, table: string, grant: PermissionGrant, row?: ScopeRow): Promise<{ frag: ReturnType<typeof sql> }> {
  let frag: ReturnType<typeof sql> = grant.scope === 'all' ? sql`true` : row
    ? sql`${String(row.created_by ?? '')} = ${user}`
    : sql`${sql(await tableRelation(table))}.created_by = ${user}`
  if (grant.assignments) {
    let assigned = sql`false`
    for (const scope of grant.assignments) assigned = sql`${assigned} or (${(await assignmentPredicate(user, table, scope, row)).frag})`
    frag = sql`(${frag}) and (${assigned})`
  }
  if (grant.prerequisite) frag = sql`(${frag}) and (${(await grantPredicate(user, table, grant.prerequisite, row)).frag})`
  return { frag }
}

export async function grantMatches(user: string, table: string, grant: PermissionGrant, row: ScopeRow): Promise<boolean> {
  if (!grantHasAssignments(grant)) return grant.scope === 'all' || row.created_by === user
  const [result] = await sql`select ${(await grantPredicate(user, table, grant, row)).frag} as allowed`
  return result.allowed === true
}

export function grantHasAssignments(grant: PermissionGrant): boolean {
  return !!grant.assignments || !!(grant.prerequisite && grantHasAssignments(grant.prerequisite))
}

export async function permissionPredicate(user: string, table: string, action: PermAction, column?: string): Promise<{ frag: ReturnType<typeof sql> }> {
  if (await isPrivileged(user, table)) return { frag: sql`true` }
  let frag: ReturnType<typeof sql> = sql`false`
  for (const grant of await permissionGrants(user, table, action)) {
    if (column && !grant.columns.includes(column)) continue
    frag = sql`${frag} or (${(await grantPredicate(user, table, grant)).frag})`
  }
  return { frag: sql`(${frag})` }
}

export async function permissionScope(
  user: string,
  table: string,
  action: PermAction,
): Promise<PermScope> {
  if (await isPrivileged(user, table)) return 'all'
  const active = await permissionGrants(user, table, action)
  if (active.some((grant) => grant.scope === 'all' && !grantHasAssignments(grant))) return 'all'
  if (active.some(grantHasAssignments)) return 'scoped'
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
  createdBy: string | ScopeRow,
) {
  const scope = await permissionScope(user, table, action)
  if (scope === 'all') return
  const row = typeof createdBy === 'string' ? { created_by: createdBy } : createdBy
  if (scope === 'own_rows' && row.created_by === user) return
  if (scope === 'scoped') {
    for (const grant of await permissionGrants(user, table, action))
      if (await grantMatches(user, table, grant, row)) return
  }
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
 * app's Tables (enabled or not) are reached through the app: every reader of
 * an app reads its entry Table, so counting them would hand the Admin to
 * everyone who can open an app. An app without pages of its own is used
 * through the Admin, so its Tables still count. App Tables are still listed
 * for anyone who can use Admin for another reason.
 */
export async function tableAccessFor(
  principal: string,
  roles: string[],
): Promise<{ readable: string[]; readableByOwnRole: string[]; creatable: string[]; ownGrant: boolean; admin: boolean }> {
  let scoped = sql`false`
  for (const app of administrationApps()) {
    const assigned = [...new Set((await effectiveAssignments(app, principal)).map(assignment => assignment.role))]
    if (assigned.length) scoped = sql`${scoped} or (d.owner_app = ${app} and p.role in ${sql(assigned)})`
  }
  const rows = await sql`
    select p.ref_table, p.role, (p.operation = 'read') as can_read, p.owner_app,
      -- #432: a grant never makes a system-written Table creatable.
      (p.operation = 'create' and not d.system_written) as can_create
    from permission p
    join table_def d on d.name = p.ref_table and d.kind = 'table'
    where p.parent_permission is null and p.requires_permission is null and (p.role in ${sql(roles)} or (${scoped}))`
  const active = rows.filter(
    (r) => r.owner_app == null || activeApps.has(String(r.owner_app)),
  )
  const names = (pick: (r: (typeof active)[number]) => boolean) =>
    [...new Set(active.filter(pick).map((r) => r.ref_table as string))].sort()
  const appTables = await tablesOfAppsWithOwnPages()
  const shared = await sql`
    select distinct share_table from share
    where (person = ${principal} or service_account = ${principal}) and read = true`
  const ownGrant = active.some((r) => r.role !== 'All' && !appTables.has(String(r.ref_table)))
  return {
    readable: names((r) => r.can_read),
    // Read through a role of the principal's own, never only through All: an
    // app open to everyone is no one's in particular (the sign-in landing).
    readableByOwnRole: names((r) => r.can_read && r.role !== 'All'),
    creatable: names((r) => r.can_create),
    ownGrant,
    admin: ownGrant || shared.some((r) => !appTables.has(String(r.share_table))),
  }
}

/** #659: the Tables of installed apps that declare pages of their own,
 *  enabled or not, loaded here or not, read through the ledger's one decoder. */
async function tablesOfAppsWithOwnPages(): Promise<Set<string>> {
  const rows = await sql`select tables, runtime_package, manifest from installed_app`
  return new Set(rows.filter(declaresOwnPages).flatMap((r) => asNameList(r.tables)))
}

/** Platform administration is not a domain grant on app-owned business data. */
export async function isPrivileged(principal: string, table?: string): Promise<boolean> {
  if (table) {
    const [definition] = await sql`select owner_app from table_def where name = ${table}`
    if (definition?.owner_app) {
      return isActingSystemActor(principal) || isProvisioningApp(String(definition.owner_app))
    }
  }
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

// Throws when a row (or its reference values) falls outside the user's
// permitted values.
export function checkUserPermissions(
  user: string,
  table: string,
  linkFields: { column_name: string; reference_table: string | null | undefined }[],
  row: Record<string, unknown>,
  map: Map<string, Set<string>>,
) {
  const own = map.get(table)
  if (own && row.row_id != null && !own.has(String(row.row_id)))
    throw new AppError(
      'PermissionError',
      `${table} ${String(row.row_id)} is outside your permitted values`,
    )
  for (const f of linkFields) {
    if (!f.reference_table) continue
    const allowed = map.get(f.reference_table)
    if (!allowed) continue
    const value = Object.hasOwn(row, f.column_name) ? row[f.column_name] : undefined
    if (value == null || value === '') continue
    if (!allowed.has(String(value)))
      throw new AppError(
        'PermissionError',
        `${f.reference_table} ${String(value)} is outside your permitted values`,
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
  createdBy?: string | ScopeRow,
  proposed?: ScopeRow,
): Promise<ColumnSelection> {
  if (await isPrivileged(user, table)) return new Set(ALL_COLUMNS)
  const grants = await permissionGrants(user, table, action)
  const columns = new Set<string>()
  const row = typeof createdBy === 'string' ? { created_by: createdBy } : createdBy
  for (const grant of grants) {
    if (row && !await grantMatches(user, table, grant, row)) continue
    if (proposed && !await grantMatches(user, table, grant, proposed)) continue
    for (const column of grant.columns) columns.add(column)
  }
  return columns
}

export function includesColumn(selection: ReadonlySet<string>, column: { row_id: string; tier: 'basic' | 'restricted' }): boolean {
  // @basic is only the anonymous outbound policy, never a principal grant.
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
export function stripUnwritableFields(
  columns: { row_id: string; column_name: string; tier: 'basic' | 'restricted' }[],
  selection: ReadonlySet<string>,
  values: Record<string, unknown>,
  stored?: Record<string, unknown>,
): Record<string, unknown> {
  if (selection.has('*')) return values
  const allowed = { ...values }
  for (const column of columns) {
    const name = column.column_name
    if (!Object.hasOwn(values, name) || includesColumn(selection, column)) continue
    if (!stored || !isDeepStrictEqual(values[name] ?? null, stored[name] ?? null))
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
