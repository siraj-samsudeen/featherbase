import type { AppManifest } from '../apps'

// PLAT-001: a sample installable app. It ships one DocType ("CRM Lead") and a
// doc_event that normalizes a lead's status on save. Installing it creates the
// table; uninstalling drops it. This is the shape a real third-party app takes.
const helloCrm: AppManifest = {
  name: 'hello-crm',
  doctypes: [
    {
      name: 'CRM Lead',
      module: 'Hello CRM',
      autoname: 'prompt',
      fields: [
        { fieldname: 'lead_name', fieldtype: 'Data', reqd: true, in_list_view: true },
        { fieldname: 'email', fieldtype: 'Data' },
        { fieldname: 'status', fieldtype: 'Select', options: 'Open\nContacted\nWon\nLost', default_value: 'Open', in_list_view: true },
      ],
    },
  ],
  doc_events: {
    // A hook on the app's own DocType: normalize the email on save. (Runs after
    // schema validation, so it must not fight the field's own constraints.)
    'CRM Lead': {
      before_save: ({ doc }) => {
        if (typeof doc.email === 'string') doc.email = doc.email.trim().toLowerCase()
      },
    },
  },
}

export default helloCrm
