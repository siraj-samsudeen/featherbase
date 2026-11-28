// #1459: every Table declares who reads which of its rows, one rule from a closed set (shared/row-rule.ts), and the
// platform applies it on every read path: lists, counts, charts, search and exports (scopedWhere), a single row and
// every write (assertUserPermissions), Sub-table rows (through their parent), Comments, Versions and Files (through
// their row), connected Tables (their read gate) and realtime (through getDoc). A Table with no rule is read by
// System Managers only. A grant still decides who reaches the Table; the rule decides which rows. Data Scope and a
// mandatory access policy narrow further, as before. A System Manager is not narrowed, as Data Scope does not
// narrow them.
import { AsyncLocalStorage } from 'node:async_hooks'
import { placeGroups, rowRuleSchema, rowWithinPlaces, type RowRule } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type TableMeta } from './meta'
import { getRoles } from './permissions'
import { placesOf } from './place-scope'
import { tableRelation } from './table-engine'

type Frag = ReturnType<typeof sql>

// runtime-packages, query and read-only-copy are loaded when first needed: query.ts and document.ts import this
// module, and a static import would close a cycle at start-up (as view-as.ts does).
const packages = () => import('./runtime-packages')

/** The rule a Table's rows are read by now, or null when it has none (System Managers only). The instance's own rule
 *  (table_def.row_rule) wins; otherwise an app's Table takes its app's declaration, which an app whose files are not
 *  loaded cannot give (so the Table is closed, never open). A view is read by its base's rule. A Sub-table has no
 *  rule of its own: its rows follow the row that holds them. */
export async function rowRuleOf(meta: TableMeta): Promise<RowRule | null> {
  if (meta.kind === 'view' && meta.view_of) return rowRuleOf(await getMeta(meta.view_of))
  if (meta.kind === 'sub_table') return { kind: 'all' }
  if (meta.row_rule != null) {
    const stored = rowRuleSchema.safeParse(meta.row_rule)
    // a stored rule this version cannot read closes the Table, rather than opening it
    return stored.success ? stored.data : null
  }
  return meta.owner_app ? (await packages()).appRowRule(meta.owner_app, meta.name) : null
}

/** The rule as it applies to `user`: `all` for a role the rule reads every row for. */
async function ruleFor(meta: TableMeta, user: string): Promise<RowRule | null> {
  const rule = await rowRuleOf(meta)
  if (!rule || !('whole_for' in rule) || !rule.whole_for?.length) return rule
  const roles = await getRoles(user)
  return rule.whole_for.some((role) => roles.includes(role)) ? { kind: 'all' } : rule
}

// A `through` rule reads its target Table's rows, whose own rule may be `through` again. The Tables on the way are
// remembered so a ring of them ends closed instead of never ending.
const walking = new AsyncLocalStorage<readonly string[]>()
const MAX_THROUGH = 4

/** The rows of `target` that `user` can read, as a subquery's FROM and WHERE, or null when they can read none of it
 *  (no grant, a connected Table, a ring of rules). */
async function readable(from: string, target: string, user: string): Promise<{ table: string; key: string; where: Frag } | null> {
  const seen = walking.getStore() ?? []
  if (seen.includes(target) || seen.length >= MAX_THROUGH) return null
  const { scopedWhere } = await import('./query')
  try {
    const scoped = await walking.run([...seen, from], () => scopedWhere(target, user, []))
    return { table: scoped.table, key: scoped.meta.row_key, where: scoped.where as Frag }
  } catch (error) {
    if (error instanceof AppError) return null
    throw error
  }
}

function referenceTarget(meta: TableMeta, column: string): string | null {
  const found = meta.columns.find((c) => c.column_name === column && c.column_type === 'Reference')
  return found?.reference_base ?? found?.reference_table ?? null
}

/** The SQL condition a list adds for `user` on `meta`'s rows (`tbl` its relation), boxed (a fragment is a thenable:
 *  awaiting it would run it), or null when the rule narrows nothing for them. Values compare as text. */
export async function ruleCondition(meta: TableMeta, user: string, tbl: string): Promise<{ frag: Frag } | null> {
  const rule = await ruleFor(meta, user)
  if (!rule || rule.kind === 'administrators') return { frag: sql`false` }
  if (rule.kind === 'all') return null
  const own: Frag = sql`${sql(tbl)}.created_by = ${user}`
  if (rule.kind === 'own') {
    const named = (rule.columns ?? []).map((column): Frag => sql`${sql(tbl)}.${sql(column)} = ${user}`)
    return { frag: sql`(${[own, ...named].reduce((all, c) => sql`${all} or ${c}`)})` }
  }
  if (rule.kind === 'through') {
    const target = referenceTarget(meta, rule.column)
    const rows = target ? await readable(meta.name, target, user) : null
    if (!rows) return { frag: sql`false` }
    return { frag: sql`${sql(tbl)}.${sql(rule.column)} in (select ${sql(rows.key)} from ${sql(rows.table)} where ${rows.where})` }
  }
  const any: Frag[] = placeGroups(rule.columns, await placesOf(user)).map((group) => group
    .map(({ column, values }): Frag => sql`${sql(tbl)}.${sql(column)}::text in ${sql(values)}`)
    .reduce((all, condition) => sql`${all} and ${condition}`))
  // a read-only copy's rows are the platform's own (its loads), so no reader wrote one: no own-rows branch, which
  // would also keep the planner from the copy's store index
  const { declaredCopy } = await import('./read-only-copy')
  const either = [...(declaredCopy(meta.name) ? [] : [own]), ...any.map((g) => sql`(${g})`)]
  return { frag: either.length ? sql`(${either.reduce((all, g) => sql`${all} or ${g}`)})` : sql`false` }
}

/** Whether one row is `user`'s to read by the Table's rule. */
export async function rowWithinRule(meta: TableMeta, user: string, row: Record<string, unknown>): Promise<boolean> {
  const rule = await ruleFor(meta, user)
  if (!rule || rule.kind === 'administrators') return false
  if (rule.kind === 'all') return true
  const wrote = row.created_by != null && row.created_by === user
  if (rule.kind === 'own') return wrote || (rule.columns ?? []).some((column) => row[column] != null && row[column] === user)
  if (rule.kind === 'through') {
    const value = row[rule.column]
    const target = referenceTarget(meta, rule.column)
    if (value == null || value === '' || !target) return false
    const rows = await readable(meta.name, target, user)
    if (!rows) return false
    const [found] = await sql`select 1 from ${sql(rows.table)} where ${sql(rows.key)} = ${String(value)} and ${rows.where} limit 1`
    return Boolean(found)
  }
  return wrote || rowWithinPlaces(rule.columns, await placesOf(user), row)
}

/** Whether a Table's rule can keep a row from someone who may read the Table (so a live update is checked row by
 *  row before it is sent). */
export async function ruleNarrows(table: string): Promise<boolean> {
  const meta = await getMeta(table).catch(() => null)
  if (!meta) return true
  return (await rowRuleOf(meta))?.kind !== 'all'
}

/** Whether `user` reads a connected Table's rows: its rows live on the source, so the rule is every row or none. */
export async function readsConnectedRows(meta: TableMeta, user: string): Promise<boolean> {
  return (await ruleFor(meta, user))?.kind === 'all'
}

/** What a refusal says when the rule keeps the row from the person. */
export async function ruleRefusal(meta: TableMeta, row: Record<string, unknown>): Promise<AppError> {
  const rule = await rowRuleOf(meta)
  const which = `${meta.name} ${String(row.row_id ?? '')}`.trim()
  if (!rule) return new AppError('PermissionError', `${meta.name} has no row rule yet, so only a System Manager reads its rows`)
  if (rule.kind === 'administrators') return new AppError('PermissionError', `Only a System Manager reads ${meta.name} rows`)
  if (rule.kind === 'places') return new AppError('PermissionError', `${which} is outside the places the org chart gives you`)
  if (rule.kind === 'through') return new AppError('PermissionError', `${which} belongs to a ${referenceTarget(meta, rule.column) ?? rule.column} row you cannot read`)
  return new AppError('PermissionError', `${which} is not one of your rows`)
}

/** A System Manager's own rule for a Table (any Table: the platform's, the instance's, an app's, a connected one), or
 *  null to take it away: an app's Table then follows its app again, any other is closed. Written to the Access Log. */
export async function setRowRule(name: string, input: unknown, user: string): Promise<{ table: string; row_rule: RowRule | null }> {
  const meta = await getMeta(name)
  let rule: RowRule | null = null
  if (input != null) {
    const parsed = rowRuleSchema.safeParse(input)
    if (!parsed.success) throw new AppError('ValidationError', 'Invalid row rule', { row_rule: parsed.error.issues[0]?.message ?? 'Invalid row rule' })
    rule = parsed.data
    const { rowRuleProblem } = await import('./app-row-rules')
    const problem = rowRuleProblem(meta, rule)
    if (problem) throw new AppError('ValidationError', problem, { row_rule: problem })
  } else if (meta.kind === 'view' || meta.kind === 'sub_table') {
    throw new AppError('ValidationError', `${meta.name} has no row rule of its own`)
  }
  await sql`update table_def set row_rule = ${rule === null ? null : sql.json(rule as never)}, updated_at = ${new Date()} where name = ${meta.name}`
  const { invalidateMeta } = await import('./meta')
  invalidateMeta(meta.name)
  const { logAccess } = await import('./audit')
  await logAccess(user, 'set_row_rule', { table: meta.name, scope: (rule ? JSON.stringify(rule) : 'cleared').slice(0, 140) })
  return { table: meta.name, row_rule: rule }
}

export interface RowRuleLine {
  table: string
  app: string | null
  rule: RowRule | null
  /** Who said so: the instance (a System Manager, or the platform for its own Tables), the Table's app, or no one. */
  from: 'instance' | 'app' | 'none'
  /** Roles a read grant reaches every row through (no own-rows limit). */
  readers: string[]
  /** Every row is read by everyone who signs in: a read grant to All, or to a role System Settings gives everyone. */
  everyone_reads_whole: boolean
}

/** Every Table (not a Sub-table or a view, which follow their parent and base) with the rule it is read by, for a
 *  System Manager's review: the Tables with no rule, and those everyone who signs in reads whole. */
export async function rowRuleReport(): Promise<RowRuleLine[]> {
  const { everyoneRoles } = await import('./everyone-roles')
  const everyone = new Set(['All', ...(await everyoneRoles(sql))])
  const tables = await sql`
    select d.name, d.owner_app, d.row_rule,
      coalesce((select array_agg(distinct p.role order by p.role) from permission p
        where p.ref_table = d.name and p.operation = 'read' and p.scope_mode = 'all' and p.parent_permission is null), '{}') as readers
    from table_def d where d.kind in ('table', 'settings') order by d.owner_app nulls first, d.name`
  const lines: RowRuleLine[] = []
  for (const row of tables) {
    const meta = await getMeta(String(row.name)).catch(() => null)
    const rule = meta ? await rowRuleOf(meta) : null
    const readers = row.readers as string[]
    lines.push({
      table: String(row.name), app: (row.owner_app as string | null) ?? null, rule,
      from: row.row_rule != null ? 'instance' : rule ? 'app' : 'none',
      readers,
      everyone_reads_whole: rule?.kind === 'all' && readers.some((role) => everyone.has(role)),
    })
  }
  return lines
}
