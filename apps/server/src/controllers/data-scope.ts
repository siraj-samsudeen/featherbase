import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { exactlyOnePrincipal } from './principal-pair'

// person-rename R2: exactly one of person / service_account.
// #1021: a Data Scope narrows a stored Table. One naming a view would be
// looked up by no read (they all resolve the view to its base), so it is
// refused rather than left to narrow nothing.
const controller: TableController = {
  table: 'Data Scope',
  hooks: {
    before_validate: exactlyOnePrincipal,
    async before_save({ row, tx }) {
      const [target] = await tx`select kind, to_jsonb(table_def)->>'view_of' as view_of from table_def where name = ${row.allow_table as string}`
      if (target?.kind === 'view')
        throw new AppError('ValidationError', `${String(row.allow_table)} is a view of ${String(target.view_of)}; scope ${String(target.view_of)} instead`)
    },
  },
}

export default controller
