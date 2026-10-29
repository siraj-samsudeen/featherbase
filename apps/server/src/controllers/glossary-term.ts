import type { TableController } from '../controllers'
import { AppError } from '../errors'

// #629: a glossary term may describe Tables and columns; each must exist. A
// term never stands in the way of deleting one, so a term naming a Table
// that has since gone is only checked again when the term is next saved.
const controller: TableController = {
  table: 'Glossary Term',
  hooks: {
    // Saved back to the app's wording: the "app's wording changed" mark goes.
    after_save: async ({ row, tx }) => {
      await (await import('../glossary')).settleAppWordingMark(String(row.row_id), tx)
    },
    before_validate: async ({ row, tx }) => {
      if (!Array.isArray(row.describes)) return
      for (const link of row.describes as Record<string, unknown>[]) {
        const table = String(link.link_table ?? '').trim()
        const column = String(link.link_column ?? '').trim()
        if (!table) continue
        const [known] = await tx`select 1 from table_def where name = ${table}`
        if (!known) throw new AppError('ValidationError', `There is no Table ${table}`, { describes: 'unknown Table' })
        if (!column) continue
        const [has] = await tx`select 1 from column_def where parent = ${table} and column_name = ${column}`
        if (!has) throw new AppError('ValidationError', `Table ${table} has no column ${column}`, { describes: 'unknown column' })
      }
    },
  },
}

export default controller
