import { z } from 'zod'
import { sql } from './db'
import { getMeta } from './meta'
import { tableRelation } from './table-engine'
import { activeApps } from './app-lifecycle'
import type { TableMeta } from './meta'

const name = z.string().min(1)
export const administrationDeclaration = z.object({
  version: z.literal(1),
  targets: z.record(name, z.object({ person: name }).strict()),
  memberships: z.object({
    table: name, person: name, startsOn: name.optional(), endsOn: name.optional(),
    reportsTo: name.optional(),
    dimensions: z.record(name, z.array(name).min(1)),
  }).strict(),
}).strict()
export type AdministrationDeclaration = z.infer<typeof administrationDeclaration>
const declarations = new Map<string, AdministrationDeclaration>()

export function registerAdministration(app: string, declaration?: AdministrationDeclaration) {
  if (declaration) declarations.set(app, administrationDeclaration.parse(declaration))
  else declarations.delete(app)
}

/** Before a target Row lock, hold authority and the entire membership set.
 * Real table locks also cover inserts and trusted SQL writers. */
export async function holdAdministrationSources(db: typeof sql, meta: TableMeta): Promise<void> {
  if (!meta.owner_app || !activeApps.has(meta.owner_app)) return
  const declaration = declarations.get(meta.owner_app)
  if (!declaration?.targets[meta.name]) return
  const tables = new Set([declaration.memberships.table])
  for (const paths of Object.values(declaration.memberships.dimensions)) {
    for (const path of paths) {
      let table = declaration.memberships.table
      for (const name of path.split('.')) {
        const column = (await getMeta(table)).columns.find(column => column.column_name === name)
        if (column?.column_type !== 'Reference' || !column.reference_table) break
        table = column.reference_table
        if ((await getMeta(table)).owner_app !== meta.owner_app) break
        tables.add(table)
      }
    }
  }
  const relations = ['featherbase.role_assignment', 'featherbase.scope', 'featherbase.permission',
    'featherbase.permission_column', 'featherbase.has_role', 'featherbase.app_role_binding',
    ...await Promise.all([...tables].map(tableRelation))]
  for (const relation of [...new Set(relations)].sort())
    await db`lock table ${db(relation)} in share row exclusive mode`
}

export interface AssignmentScope {
  app: string
  mode: string
  tuples: unknown
}

export async function scopedRoles(user: string, table: string): Promise<Map<string, AssignmentScope[]>> {
  const result = new Map<string, AssignmentScope[]>()
  const meta = await getMeta(table)
  if (!meta.owner_app || !activeApps.has(meta.owner_app)) return result
  const rows = await sql`select a.role, a.app, s.mode, s.tuples from featherbase.role_assignment a
    join featherbase.scope s on s.row_id = a.scope and s.app = a.app
    join installed_app app on app.name = a.app and app.enabled and not app.activation_pending
    where a.app = ${meta.owner_app} and (a.person = ${user} or a.service_account = ${user})
      and (a.starts_on is null or a.starts_on <= (now() at time zone 'Asia/Kolkata')::date)
      and (a.ends_on is null or a.ends_on > (now() at time zone 'Asia/Kolkata')::date)
      and a.role not in ('Administrator', 'System Manager', 'All', 'Guest')`
  for (const row of rows) result.set(String(row.role), [...(result.get(String(row.role)) ?? []), {
    app: String(row.app), mode: String(row.mode), tuples: row.tuples,
  }])
  return result
}

type Expression = ReturnType<typeof sql>
export type ScopeRow = Record<string, unknown>

// Compile declared Reference paths, never caller SQL. An invalid declaration
// or dangling non-null Reference invalidates the whole membership, even when
// another derivation supplies a value for that dimension.
async function factPath(app: string, table: string, alias: string, path: string[]): Promise<{ frag: Expression; valid: Expression; invalid?: boolean }> {
  const meta = await getMeta(table)
  if (meta.owner_app !== app || meta.system || meta.data_source || meta.kind !== 'table') return { frag: sql`null`, valid: sql`false`, invalid: true }
  const column = meta.columns.find(column => column.column_name === path[0])
  if (!column || ['Sub-table', 'Section Break', 'Column Break'].includes(column.column_type)) return { frag: sql`null`, valid: sql`false`, invalid: true }
  const value: Expression = sql`${sql(alias)}.${sql(column.column_name)}`
  if (path.length === 1 && column.column_type !== 'Reference') return { frag: value, valid: sql`true` }
  if (column.column_type !== 'Reference' || !column.reference_table) return { frag: sql`null`, valid: sql`false`, invalid: true }
  const next = `${alias}_ref`
  const target = await getMeta(column.reference_table)
  if (target.owner_app !== app || target.system || target.data_source || target.kind !== 'table') return { frag: sql`null`, valid: sql`false`, invalid: true }
  const nested = path.length === 1 ? { frag: value, valid: sql`true` }
    : await factPath(app, target.name, next, path.slice(1))
  if ('invalid' in nested && nested.invalid) return nested
  const from = sql`${sql(await tableRelation(target.name))} as ${sql(next)} where ${sql(next)}.${sql(target.row_key)} = ${value}`
  return { frag: path.length === 1 ? value : sql`(select ${nested.frag} from ${from})`,
    valid: sql`(${value} is null or exists (select 1 from ${from} and (${nested.valid})))` }
}

export async function assignmentPredicate(user: string, table: string, scope: AssignmentScope, row?: ScopeRow): Promise<{ frag: Expression }> {
  const declaration = declarations.get(scope.app)
  const target = declaration?.targets[table]
  if (!activeApps.has(scope.app) || !declaration || !target) return { frag: sql`false` }
  const meta = await getMeta(table)
  if (meta.owner_app !== scope.app || meta.data_source || meta.system || meta.kind !== 'table') return { frag: sql`false` }
  const relation = await tableRelation(table)
  const value = (column: string) => row
    ? sql`${row[column] == null ? null : String(row[column])}`
    : sql`${sql(relation)}.${sql(column)}`
  if (scope.mode === 'all') return { frag: sql`true` }
  if (scope.mode === 'creator') return { frag: sql`${value('created_by')} = ${user}` }
  const person = meta.columns.find(column => column.column_name === target.person)
  if (person?.column_type !== 'Reference' || person.reference_table !== 'Person') return { frag: sql`false` }
  if (scope.mode === 'self') return { frag: sql`${value(person.column_name)} = ${user}` }
  const reporting = scope.mode === 'direct_reports' || scope.mode === 'subtree'
  if (scope.mode !== 'named' && !reporting) return { frag: sql`false` }
  const requested = scope.tuples ?? []
  if (!Array.isArray(requested) || (!reporting && !requested.length)) return { frag: sql`false` }
  const membership = declaration.memberships
  const membershipMeta = await getMeta(membership.table)
  if (membershipMeta.owner_app !== scope.app || membershipMeta.system || membershipMeta.data_source || membershipMeta.kind !== 'table') return { frag: sql`false` }
  const personColumn = membershipMeta.columns.find(column => column.column_name === membership.person)
  if (personColumn?.column_type !== 'Reference' || personColumn.reference_table !== 'Person') return { frag: sql`false` }
  let valid = sql`true`
  const dimensions = new Map<string, Expression>()
  for (const [dimension, paths] of Object.entries(membership.dimensions)) {
    const resolved = await Promise.all(paths.map(path => factPath(scope.app, membership.table, 'membership', path.split('.'))))
    if (resolved.some(result => result.invalid)) return { frag: sql`false` }
    for (const result of resolved) valid = sql`${valid} and (${result.valid})`
    const values = resolved.map(result => result.frag)
    let combined = values[0]
    for (const other of values.slice(1)) {
      valid = sql`${valid} and (${combined} is null or ${other} is null or ${combined} = ${other})`
      combined = sql`coalesce(${combined}, ${other})`
    }
    dimensions.set(dimension, combined)
  }
  let tuples = requested.length ? sql`false` : sql`true`
  for (const tuple of requested) {
    if (!tuple || typeof tuple !== 'object' || Array.isArray(tuple) || !Object.keys(tuple).length) return { frag: sql`false` }
    let matches = sql`true`
    for (const [dimension, expected] of Object.entries(tuple)) {
      const actual = dimensions.get(dimension)
      if (!actual || typeof expected !== 'string' || !expected) return { frag: sql`false` }
      matches = sql`${matches} and ${actual} = ${expected}`
    }
    tuples = sql`${tuples} or (${matches})`
  }
  for (const [column, start] of [[membership.startsOn, true], [membership.endsOn, false]] as const) {
    if (!column) continue
    if (!membershipMeta.columns.some(c => c.column_name === column && c.column_type === 'Date')) return { frag: sql`false` }
    const date = sql`membership.${sql(column)}`
    valid = start ? sql`${valid} and (${date} is null or ${date} <= (now() at time zone 'Asia/Kolkata')::date)`
      : sql`${valid} and (${date} is null or ${date} > (now() at time zone 'Asia/Kolkata')::date)`
  }
  if (reporting) {
    const reportsTo = membershipMeta.columns.find(column => column.column_name === membership.reportsTo)
    if (reportsTo?.column_type !== 'Reference' || reportsTo.reference_table !== membership.table) return { frag: sql`false` }
    const key = sql(membershipMeta.row_key)
    const personKey = sql(membership.person)
    const parentKey = sql(reportsTo.column_name)
    return { frag: sql`exists (
      with recursive effective as (
        select membership.* from ${sql(await tableRelation(membership.table))} as membership where ${valid}
      ), reports as (
        select m.${key}, array[m.${key}]::text[] as path, false as cycle, 0 as depth
        from effective m where m.${personKey} = ${user}
        union all
        select m.${key}, r.path || m.${key}, m.${key} = any(r.path), r.depth + 1
        from effective m join reports r on m.${parentKey} = r.${key} where not r.cycle
      )
      select 1 from effective as membership join reports r on r.${key} = membership.${key}
      where membership.${personKey} = ${value(person.column_name)} and membership.${personKey} <> ${user}
        and ${scope.mode === 'direct_reports' ? sql`r.depth = 1` : sql`r.depth > 0`}
        and not exists (select 1 from reports where cycle) and (${tuples})
    )` }
  }
  return { frag: sql`exists (select 1 from ${sql(await tableRelation(membership.table))} as membership
    where membership.${sql(membership.person)} = ${value(person.column_name)} and (${valid}) and (${tuples}))` }
}
