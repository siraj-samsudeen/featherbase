import type { TableController } from '../controllers'
import { AppError } from '../errors'

// #620 (design E2): an App Setting row is `<app>.<setting>`, for a setting the
// installed app declares. The app and setting columns are read from the row
// ID and never change; only the value is edited.
const ROW_ID = /^([a-z][a-z0-9_]{0,30})\.([a-z][a-z0-9_]{0,63})$/

const controller: TableController = {
  table: 'App Setting',
  hooks: {
    before_validate: async ({ row, old, isNew, tx }) => {
      if (!isNew) {
        row.app = old?.app
        row.setting = old?.setting
        return
      }
      const match = ROW_ID.exec(String(row.row_id ?? ''))
      if (!match)
        throw new AppError('ValidationError', 'An app setting is named <app>.<setting>, like tasker.report_id', { row_id: 'app.setting' })
      const [, app, setting] = match
      const [installed] = await tx`select manifest from installed_app where name = ${app}`
      if (!installed) throw new AppError('ValidationError', `App ${app} is not installed`, { row_id: 'unknown app' })
      const declared = ((installed.manifest as { settings?: { name: string }[] } | null)?.settings ?? []).map(s => s.name)
      if (!declared.includes(setting))
        throw new AppError('ValidationError', `App ${app} does not declare the setting ${setting}${declared.length ? ` (it declares: ${declared.join(', ')})` : ''}`, { row_id: 'undeclared setting' })
      row.app = app
      row.setting = setting
    },
  },
}

export default controller
