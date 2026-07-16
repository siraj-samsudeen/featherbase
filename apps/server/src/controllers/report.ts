import type { DocTypeController } from '../controllers'
import { AppError } from '../errors'
import { getRoles } from '../permissions'

// RPT-004: only System Managers may author or change a Query Report's SQL.
// A non-privileged user creating a Query Report, or editing the query of an
// existing one, is rejected — they can still run reports they can read.
const controller: DocTypeController = {
  doctype: 'Report',
  hooks: {
    validate: async ({ doc, old, user, isNew }) => {
      const query = typeof doc.query === 'string' ? doc.query.trim() : ''
      const isQueryReport = doc.report_type === 'Query Report'
      if (!isQueryReport && !query) return

      const oldQuery = typeof old?.query === 'string' ? old.query.trim() : ''
      const queryChanged = isNew || query !== oldQuery || old?.report_type !== doc.report_type
      if (!queryChanged) return

      if (user === 'Administrator') return
      if (!(await getRoles(user)).includes('System Manager'))
        throw new AppError(
          'PermissionError',
          'Only System Managers can author or edit Query Report SQL',
        )
    },
  },
}

export default controller
