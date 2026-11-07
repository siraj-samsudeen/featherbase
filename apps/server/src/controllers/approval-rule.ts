import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { getMeta, ROW_KEY } from '../meta'
import { sql } from '../db'
import { OPERATORS } from '../approval-rules'
import { approvalResolverNames } from '../approval-resolvers'

// #627: a rule that could never work is refused when it is saved, not discovered when a maker's
// change is refused. Rules are data, so this is their whole check.
function refuse(message: string, field: string): never {
  throw new AppError('ValidationError', message, { [field]: message })
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

function parseCondition(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { refuse('Rows must be a list filter, such as [["site", "=", "A"]]', 'row_condition') }
}

const controller: TableController = {
  table: 'Approval Rule',
  hooks: {
    validate: async ({ row }) => {
      const table = text(row.ref_table)
      if (!table) refuse('Name the Table this rule governs', 'ref_table')
      const meta = await getMeta(table).catch(() => null)
      if (!meta) refuse(`There is no Table named ${table}`, 'ref_table')
      if (meta!.system || meta!.system_written || meta!.kind !== 'table' || meta!.data_source)
        refuse(`${table} can't have approval rules: only an ordinary Table can`, 'ref_table')
      if (!meta!.track_changes) refuse(`Turn on history for ${table} first, so every change it governs is logged`, 'ref_table')
      const known = new Set(meta!.columns.map(column => column.column_name))
      for (const column of String(row.governed_columns ?? '').split(/[\n,]/).map(part => part.trim()).filter(Boolean))
        if (!known.has(column)) refuse(`${table} has no column ${column}`, 'governed_columns')
      const condition = parseCondition(row.row_condition)
      if (condition !== null) {
        if (!Array.isArray(condition)) refuse('Rows must be a list filter, such as [["site", "=", "A"]]', 'row_condition')
        for (const filter of condition as unknown[]) {
          if (!Array.isArray(filter) || filter.length !== 3 || typeof filter[0] !== 'string' || typeof filter[1] !== 'string')
            refuse('Each row filter is [column, operator, value]', 'row_condition')
          const [column, operator] = filter as [string, string]
          if (column !== ROW_KEY && !known.has(column)) refuse(`${table} has no column ${column}`, 'row_condition')
          if (!OPERATORS.has(operator)) refuse(`A rule's rows can't use the operator ${operator}`, 'row_condition')
        }
      }
      const resolvers = approvalResolverNames()
      const maker = text(row.maker_resolver)
      if (maker && !resolvers.includes(maker)) refuse(`No running app names people as ${maker}`, 'maker_resolver')
      if (text(row.outcome) !== 'Route to approvers') return
      const approvers = (Array.isArray(row.approvers)
        ? row.approvers as Record<string, unknown>[]
        : row[ROW_KEY] ? await sql`select role, resolver from approval_rule_approver where parent = ${String(row[ROW_KEY])} and parenttype = 'Approval Rule' order by "position"` : [])
        .map(a => ({ role: text(a.role), resolver: text(a.resolver) }))
      if (!approvers.length) refuse('A rule that waits for approval needs at least one approver', 'approvers')
      for (const approver of approvers) {
        if (!!approver.role === !!approver.resolver) refuse('Each approver is a role or a person an app names, not both', 'approvers')
        if (approver.resolver && !resolvers.includes(approver.resolver)) refuse(`No running app names people as ${approver.resolver}`, 'approvers')
      }
      // Nobody approves their own change: an approver who is always the maker can never approve.
      const theMaker = (a: { resolver: string }) => !!maker && a.resolver === maker
      if (text(row.approvals_needed) === 'Any' ? approvers.every(theMaker) : approvers.some(theMaker))
        refuse('Its only approver would be the maker, and nobody approves their own change. Use "Apply and log" for that maker instead', 'approvers')
    },
  },
}

export default controller
