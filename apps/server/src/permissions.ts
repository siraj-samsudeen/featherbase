import { sql } from './db'
import { AppError } from './errors'
import { activeApps } from './app-lifecycle'
import { isActingSystemActor } from './system-actor'
import { asNameList, declaresOwnPages } from './installed-app-ledger'

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

const ACTION_COLUMN: Record<PermAction, string> = {
  read: 'can_read',
  write: 'can_write',
  create: 'can_create',
  delete: 'can_delete',
  submit: 'can_submit',
  cancel: 'can_cancel',
  amend: 'can_amend',
}

// PERM-007: an own_rows_only grant applies only to rows the user created.
// 'all' = unconditional grant, 'own_rows' = created_by-scoped only, 'none' = denied.
type PermScope = 'all' | 'own_rows' | 'none'

export async function permissionScope(
  user: string,
  table: string,
  action: PermAction,
): Promise<PermScope> {
  if (user === 'Administrator') return 'all'
  const roles = await getRoles(user)
  if (roles.includes('System Manager')) return 'all'
  const rows = await sql`
    select own_rows_only, owner_app from permission
    where ref_table = ${table} and tier = 'basic'
      and role in ${sql(roles)}
      and ${sql(ACTION_COLUMN[action])} = true`
  const active = rows.filter((r) => r.owner_app == null || activeApps.has(String(r.owner_app)))
  if (active.some((r) => !r.own_rows_only)) return 'all'
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
  const rows = await sql`
    select p.ref_table, p.role, p.can_read, p.owner_app,
      -- #432: a grant never makes a system-written Table creatable.
      (p.can_create and not d.system_written) as can_create,
      (p.can_read or p.can_write or p.can_create or p.can_delete
        or p.can_submit or p.can_cancel or p.can_amend) as any_action
    from permission p
    join table_def d on d.name = p.ref_table and d.kind = 'table'
    where p.tier = 'basic' and p.role in ${sql(roles)}`
  const active = rows.filter(
    (r) => r.any_action && (r.owner_app == null || activeApps.has(String(r.owner_app))),
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

// PERM-006: the set of tiers a user may READ / WRITE on a Table. 'basic' is
// the base grant; 'restricted' needs an explicit Permission row at that
// tier. Because 'restricted' access implies 'basic' access (the old
// "higher permlevel implies lower levels" rule, with two levels instead of
// ten), a restricted grant is expanded to include 'basic' when the set is
// built. Admins/System Managers get both tiers.
export async function permittedTiers(
  user: string,
  table: string,
  action: 'read' | 'write' | 'create',
): Promise<Set<'basic' | 'restricted'>> {
  if (await isPrivileged(user)) return new Set(['basic', 'restricted'])
  const roles = await getRoles(user)
  const rows = await sql`
    select tier, owner_app from permission
    where ref_table = ${table}
      and role in ${sql(roles)}
      and ${sql(ACTION_COLUMN[action])} = true`
  const tiers = new Set<'basic' | 'restricted'>()
  for (const r of rows) {
    if (r.owner_app != null && !activeApps.has(String(r.owner_app))) continue
    const tier = r.tier as 'basic' | 'restricted'
    tiers.add(tier)
    if (tier === 'restricted') tiers.add('basic')
  }
  return tiers
}

// #608: the columns a new row may set — those its creator's create or edit
// grant reaches. A create-only grant carries no edit tier, yet what was typed
// into a new row is what creating it means.
export async function insertTiers(user: string, table: string): Promise<Set<'basic' | 'restricted'>> {
  return new Set([...(await permittedTiers(user, table, 'create')), ...(await permittedTiers(user, table, 'write'))])
}

function allowsTier(tiers: Set<'basic' | 'restricted'>, tier: 'basic' | 'restricted'): boolean {
  return tiers.has(tier)
}

// Strip columns the user can't read at their tier from an outgoing row.
export function filterReadFields(
  columns: { column_name: string; tier: 'basic' | 'restricted' }[],
  tiers: Set<'basic' | 'restricted'>,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (tiers.has('basic') && tiers.has('restricted')) return row
  const out: Record<string, unknown> = {}
  const hidden = new Set(
    columns.filter((f) => !allowsTier(tiers, f.tier)).map((f) => f.column_name),
  )
  for (const [k, v] of Object.entries(row)) if (!hidden.has(k)) out[k] = v
  return out
}

// Drop writes to columns above the user's write tier (silently ignored,
// like read_only) so a client can't escalate via restricted-tier columns.
export function stripUnwritableFields(
  columns: { column_name: string; tier: 'basic' | 'restricted' }[],
  tiers: Set<'basic' | 'restricted'>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (tiers.has('basic') && tiers.has('restricted')) return values
  const writable = new Set(
    columns.filter((f) => allowsTier(tiers, f.tier)).map((f) => f.column_name),
  )
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) if (writable.has(k)) out[k] = v
  return out
}

export async function assertSystemManager(user: string) {
  if (user === 'Administrator') return
  const roles = await getRoles(user)
  if (!roles.includes('System Manager'))
    throw new AppError('PermissionError', 'Requires the System Manager role')
}
