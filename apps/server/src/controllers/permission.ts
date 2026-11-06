import type { TableController } from '../controllers'
import { AppError } from '../errors'

const controller: TableController = {
  table: 'Permission',
  hooks: {
    async before_save({ row, tx }) {
      // #1021: a view has no grants of its own; it reads under its base's.
      const [target] = await tx`select kind, to_jsonb(table_def)->>'view_of' as view_of from table_def where name = ${String(row.ref_table ?? '')}`
      if (target?.kind === 'view')
        throw new AppError('ValidationError', `${String(row.ref_table)} is a view of ${String(target.view_of)}; grant access on ${String(target.view_of)} instead`)
      if (row.operation === 'read_identifiers' && row.ref_table !== 'Person')
        throw new AppError('ValidationError', 'Identifier-read authority applies only to Person')
      const children = Array.isArray(row.columns) ? row.columns as Record<string, unknown>[] :
        await tx`select target_column from featherbase.permission_column where parent = ${String(row.row_id)}`
      const targets = children.map((column) => String(column.target_column ?? ''))
      if (new Set(targets).size !== targets.length)
        throw new AppError('ValidationError', 'A permission may name each Column only once')
      for (const target of targets) {
        const [column] = await tx`select parent from column_def where row_id = ${target}`
        if (!column || column.parent !== row.ref_table)
          throw new AppError('ValidationError', 'Permission Columns must belong to the target Table')
      }
      if (!['read', 'create', 'update'].includes(String(row.operation)) && targets.length)
        throw new AppError('ValidationError', 'This operation applies to a Row, not individual Columns')
      if (row.column_rule !== 'listed' && targets.length)
        throw new AppError('ValidationError', 'List Columns only when the permission reaches only the columns listed')
      const seen = new Set([String(row.row_id)])
      let dependency = row.requires_permission
      while (dependency) {
        const id = String(dependency)
        if (seen.has(id)) throw new AppError('ValidationError', 'Permission prerequisites cannot form a cycle')
        seen.add(id)
        const [required] = await tx`select ref_table, operation, requires_permission from permission where row_id = ${id}`
        if (!required || required.ref_table !== row.ref_table || required.operation !== row.operation)
          throw new AppError('ValidationError', 'A prerequisite must cover the same Table and operation')
        dependency = required.requires_permission
      }
      if (row.parent_permission) {
        const [parent] = await tx`select ref_table, operation, column_rule from permission where row_id = ${String(row.parent_permission)}`
        // The parent must reach the link: listed, or by its level.
        const [link] = parent ? await tx`select 1 from column_def c
          where c.parent = ${parent.ref_table} and c.row_id = ${String(row.parent_column ?? '')}
          and c.column_type = 'Sub-table' and c.row_table = ${String(row.ref_table)}
          and (${parent.column_rule === 'every'} or (${parent.column_rule === 'basic'} and coalesce(c.tier, 'basic') = 'basic')
            or exists (select 1 from featherbase.permission_column pc
              where pc.target_column = c.row_id and pc.parent = ${String(row.parent_permission)}))
          limit 1` : []
        if (!link || parent.operation !== row.operation)
          throw new AppError('ValidationError', 'An inherited permission must name a selected parent Column and the same operation')
      } else if (row.parent_column) {
        throw new AppError('ValidationError', 'A parent Column requires a parent permission')
      }
    },
  },
}

export default controller
