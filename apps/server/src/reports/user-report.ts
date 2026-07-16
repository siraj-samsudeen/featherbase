import type { ScriptReport } from '../script-report'
import { getList } from '../query'

// RPT-005 sample script report: lists users, optionally filtered by enabled
// state. Runs through getList so it honors the caller's permissions.
const report: ScriptReport = {
  name: 'User Report',
  filters: [
    { fieldname: 'enabled', label: 'Enabled', fieldtype: 'Select', options: '\nYes\nNo' },
  ],
  execute: async (filters, user) => {
    const f: [string, string, unknown][] = []
    if (filters.enabled === 'Yes') f.push(['enabled', '=', true])
    else if (filters.enabled === 'No') f.push(['enabled', '=', false])
    const res = await getList(
      'User',
      { fields: ['name', 'full_name', 'enabled'], filters: f, limit_page_length: 500 },
      user,
    )
    return {
      columns: ['name', 'full_name', 'enabled'],
      rows: res.data as Record<string, unknown>[],
    }
  },
}

export default report
