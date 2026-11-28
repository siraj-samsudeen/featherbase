// #1459: an app declares who reads which rows of each of its own Tables: `rowRules`, Table → rule (shared/row-rule.ts).
// The platform applies the rule on every read path (row-rule.ts); this file is the declaration and its check when
// the app's files are loaded. A read-only copy is not named here: its dataset says it (its `filters` are its places,
// `unscoped` is every row). A Table the app leaves out has no rule, so only System Managers read it.
import { z } from 'zod'
import { rowRuleSchema, type RowRule } from 'shared'

export const rowRulesDeclaration = z.record(z.string().min(1), rowRuleSchema)
export type RowRulesDeclaration = z.infer<typeof rowRulesDeclaration>

/** Column types a row can be narrowed by places on: values that compare as the same text in SQL and in code (no
 *  dates, no decimals, whose text forms differ between the two). */
const PLACE_COLUMN_TYPES = new Set(['Data', 'Choice', 'Select', 'Int', 'Reference', 'Link'])

interface RuledColumn { column_name: string; column_type: string; reference_table?: string | null; table_column?: string | null }
export interface RuledTable { name: string; kind?: string | null; data_source?: string | null; columns: readonly RuledColumn[] }

/** Why `rule` cannot be a rule of `table`, or null. One check for an app's declaration and a System Manager's own rule. */
export function rowRuleProblem(table: RuledTable, rule: RowRule): string | null {
  if (table.kind === 'sub_table') return 'A Sub-table has no row rule: its rows follow the row that holds them'
  if (table.kind === 'view') return 'A view has no row rule: it is read by its base Table\'s'
  if (rule.kind === 'all' || rule.kind === 'administrators') return null
  if (table.data_source) return 'A connected Table is read whole or by System Managers only: its rows live on its source'
  if (table.kind === 'settings') return 'A Settings Table has one row: it is read whole or by System Managers only'
  const column = (name: string) => table.columns.find((c) => c.column_name === name)
  if (rule.kind === 'own') {
    const bad = (rule.columns ?? []).find((name) => column(name)?.column_type !== 'Reference' || column(name)?.reference_table !== 'Person')
    return bad ? `${bad} is not a Reference to Person on ${table.name}` : null
  }
  if (rule.kind === 'through') {
    const found = column(rule.column)
    if (found?.column_type !== 'Reference' || !found.reference_table || found.table_column) return `${rule.column} is not a Reference to one Table on ${table.name}`
    return found.reference_table === table.name ? `${rule.column} points at ${table.name} itself: a row cannot be read through its own Table` : null
  }
  const bad = Object.values(rule.columns).find((name) => !PLACE_COLUMN_TYPES.has(column(name)?.column_type ?? ''))
  return bad ? `${table.name} cannot be narrowed by ${bad}: it is not one of its plain columns` : null
}

/** Checked when the app's files are loaded: each rule is for one of the app's own Tables and names its columns. */
export function validateRowRules(app: string, tables: readonly RuledTable[], declaration: RowRulesDeclaration | undefined): void {
  for (const [name, rule] of Object.entries(declaration ?? {})) {
    const table = tables.find((t) => t.name === name)
    if (!table || !name.startsWith(`${app}.`)) throw new Error(`rowRules names ${name}, which is not one of the app's own Tables`)
    const problem = rowRuleProblem(table, rule)
    if (problem) throw new Error(`The row rule of ${name}: ${problem}`)
  }
}

/** The rule with one of the Table's columns renamed, or null when it names no such column. */
export function renameRuleColumn(rule: RowRule, from: string, to: string): RowRule | null {
  if (rule.kind === 'own' && rule.columns?.includes(from)) return { ...rule, columns: rule.columns.map((c) => (c === from ? to : c)) }
  if (rule.kind === 'through' && rule.column === from) return { ...rule, column: to }
  if (rule.kind === 'places' && Object.values(rule.columns).includes(from))
    return { ...rule, columns: Object.fromEntries(Object.entries(rule.columns).map(([filter, c]) => [filter, c === from ? to : c])) }
  return null
}
