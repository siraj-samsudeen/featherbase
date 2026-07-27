import type { AppManifest } from '../apps'

// PLAT-001: a sample installable app. It ships one Table ("CRM Lead") and a
// doc_event that normalizes a lead's status on save. Installing it creates the
// table; uninstalling drops it. This is the shape a real third-party app takes.
const helloCrm: AppManifest = {
  name: 'hello-crm',
  tables: [
    {
      name: 'CRM Lead',
      module: 'Hello CRM',
      id_pattern: 'prompt',
      columns: [
        { column_name: 'lead_name', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'email', column_type: 'Data' },
        { column_name: 'status', column_type: 'Choice', choices: 'Open\nContacted\nWon\nLost', default_value: 'Open', in_list_view: true },
      ],
    },
  ],
  doc_events: {
    // A hook on the app's own Table: normalize the email on save. (Runs after
    // schema validation, so it must not fight the column's own constraints.)
    'CRM Lead': {
      before_save: ({ row }) => {
        if (typeof row.email === 'string') row.email = row.email.trim().toLowerCase()
      },
    },
  },
}

export default helloCrm
