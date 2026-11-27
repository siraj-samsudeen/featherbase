import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { STAND_IN, standInAllowedHere } from '../dataset-bindings'

// #1409 (design D2, D8): a Dataset Binding row is `<app>.<dataset>`, for a
// dataset the installed app declares. The app and dataset columns are read
// from the row ID and never change. On production a binding to a stand-in is
// refused until Allowed on production is ticked on it.
const ROW_ID = /^([a-z][a-z0-9_]{0,30})\.([a-z][a-z0-9_]{0,63})$/

const controller: TableController = {
  table: 'Dataset Binding',
  hooks: {
    before_validate: async ({ row, old, isNew, tx }) => {
      if (isNew) {
        const match = ROW_ID.exec(String(row.row_id ?? ''))
        if (!match)
          throw new AppError('ValidationError', 'A dataset binding is named <app>.<dataset>, like budgets.actuals', { row_id: 'app.dataset' })
        const [, app, dataset] = match
        const [installed] = await tx`select manifest from installed_app where name = ${app}`
        if (!installed) throw new AppError('ValidationError', `App ${app} is not installed`, { row_id: 'unknown app' })
        const declared = ((installed.manifest as { datasets?: { name: string }[] } | null)?.datasets ?? []).map(d => d.name)
        if (!declared.includes(dataset))
          throw new AppError('ValidationError', `App ${app} does not declare the dataset ${dataset}${declared.length ? ` (it declares: ${declared.join(', ')})` : ''}`, { row_id: 'undeclared dataset' })
        row.app = app
        row.dataset = dataset
      } else {
        row.app = old?.app
        row.dataset = old?.dataset
      }
      // The rule guards the move to a stand-in. Unticking the box later is
      // always possible, and then stops the stand-in being served (app-datasets.ts).
      if (row.served_from === STAND_IN && old?.served_from !== STAND_IN && !standInAllowedHere({ allowed_on_production: row.allowed_on_production === true }))
        throw new AppError('ValidationError',
          `A stand-in on production must be allowed for its dataset first: tick Allowed on production on the Dataset Binding ${String(row.row_id)}, then load it`,
          { allowed_on_production: 'tick this to allow a stand-in on production' })
    },
  },
}

export default controller
