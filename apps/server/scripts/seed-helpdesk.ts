/* Helpdesk: a complete ticketing system built from METADATA ONLY, through the
 * public HTTP API of a running server — no framework code, no SQL, no frontend
 * changes. Run with the app up (./init.sh):
 *
 *   pnpm --filter server seed:helpdesk
 *
 * What it creates:
 * - Roles: Support Agent, Support Manager, Customer (+ demo users, pwd demo1234)
 * - Ticket DocType (TICK-.##### naming series, SLA fields, agent link)
 * - DocPerms: agents read/write/create; managers + delete; customers if_owner
 *   (portal: they see only their own tickets); collab grants (ToDo/Comment/
 *   File/Version) for the helpdesk roles
 * - Workflow "Ticket Flow" BOUND TO THE status FIELD: Open -> In Progress ->
 *   Resolved -> Closed; Close is Support Manager-only; customers may Reopen;
 *   Resolve requires resolution_details (conditional transition)
 * - Server Script: default raised_by to the creating user
 * - Assignment Rule: new tickets round-robin between the two agents and stamp
 *   the `agent` field
 * - SLA: per-priority response/resolution windows, Overdue escalation to
 *   Support Manager
 * - Email Rule: the requester is emailed when their ticket becomes Resolved
 * - Web Form /form/new-ticket: public ticket intake (logged-in customers own
 *   what they file)
 */

const BASE = process.env.SERVER_URL ?? 'http://localhost:8000'
const ADMIN = process.env.ADMIN_USER ?? 'Administrator'
const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

let token = ''

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  })
}

async function must(res: Response, what: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`${what}: ${res.status} ${JSON.stringify(body)}`)
  return body
}

async function exists(doctype: string, name: string): Promise<boolean> {
  const res = await req(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)
  return res.ok
}

async function ensureDoc(doctype: string, doc: Record<string, unknown>, key?: string) {
  const name = key ?? String(doc.name)
  if (await exists(doctype, name)) {
    console.log(`  = ${doctype} ${name} (exists)`)
    return
  }
  await must(
    await req('/api/save_doc', { method: 'POST', body: JSON.stringify({ doctype, doc }) }),
    `${doctype} ${name}`,
  )
  console.log(`  + ${doctype} ${name}`)
}

async function main() {
  const login = await must(
    await req('/api/login', {
      method: 'POST',
      body: JSON.stringify({ usr: ADMIN, pwd: ADMIN_PWD }),
    }),
    'login',
  )
  token = login.token as string

  console.log('Roles')
  for (const role of ['Support Agent', 'Support Manager', 'Customer'])
    await ensureDoc('Role', { name: role })

  console.log('Users (password: demo1234)')
  const users: [string, string, string[]][] = [
    ['agent1@helpdesk.test', 'Alice Agent', ['Support Agent']],
    ['agent2@helpdesk.test', 'Arun Agent', ['Support Agent']],
    ['manager@helpdesk.test', 'Mira Manager', ['Support Manager', 'Support Agent']],
    ['cust1@acme.test', 'Carl Customer', ['Customer']],
    ['cust2@globex.test', 'Gina Customer', ['Customer']],
  ]
  for (const [email, full_name, roles] of users) {
    await ensureDoc('User', {
      name: email,
      email,
      full_name,
      enabled: true,
      roles: roles.map((role) => ({ role })),
    })
    await must(
      await req('/api/set_password', {
        method: 'POST',
        body: JSON.stringify({ user: email, password: 'demo1234' }),
      }),
      `password ${email}`,
    )
  }

  console.log('Ticket DocType')
  if (!(await exists('DocType', 'Ticket'))) {
    await must(
      await req('/api/doctype', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Ticket',
          module: 'Helpdesk',
          autoname: 'TICK-.#####',
          title_field: 'subject',
          fields: [
            { fieldname: 'subject', fieldtype: 'Data', reqd: true, in_list_view: true },
            { fieldname: 'description', fieldtype: 'Text' },
            {
              fieldname: 'status', fieldtype: 'Select', in_list_view: true,
              options: 'Open\nIn Progress\nResolved\nClosed', default_value: 'Open',
            },
            {
              fieldname: 'priority', fieldtype: 'Select', in_list_view: true,
              options: 'Low\nMedium\nHigh\nUrgent', default_value: 'Medium',
            },
            { fieldname: 'raised_by', label: 'Raised By (email)', fieldtype: 'Data' },
            { fieldname: 'agent', fieldtype: 'Link', options: 'User', in_list_view: true },
            { fieldname: 'resolution_details', fieldtype: 'Text' },
            { fieldname: 'response_by', fieldtype: 'Datetime', read_only: true },
            { fieldname: 'resolution_by', fieldtype: 'Datetime', read_only: true },
            { fieldname: 'sla_status', label: 'SLA', fieldtype: 'Data', read_only: true, in_list_view: true },
          ],
        }),
      }),
      'DocType Ticket',
    )
    console.log('  + DocType Ticket')
  } else console.log('  = DocType Ticket (exists)')

  console.log('Permissions')
  // [doctype, role, perms]
  const grants: [string, string, Record<string, boolean>][] = [
    ['Ticket', 'Support Agent', { can_read: true, can_write: true, can_create: true }],
    ['Ticket', 'Support Manager', { can_read: true, can_write: true, can_create: true, can_delete: true }],
    // Customers: portal view of their OWN tickets only. (Creation happens
    // through the web form, which attributes the logged-in submitter.)
    ['Ticket', 'Customer', { if_owner: true, can_read: true, can_create: true }],
    // Collaboration doctypes the helpdesk roles need (no "All"-role defaults).
    ['ToDo', 'Support Agent', { can_read: true, can_write: true }],
    ['ToDo', 'Support Manager', { can_read: true, can_write: true }],
    ['Comment', 'Support Agent', { can_read: true, can_create: true }],
    ['Comment', 'Support Manager', { can_read: true, can_create: true }],
    ['Comment', 'Customer', { can_read: true, can_create: true }],
    ['File', 'Support Agent', { can_read: true, can_create: true }],
    ['File', 'Support Manager', { can_read: true, can_create: true }],
    ['File', 'Customer', { can_read: true, can_create: true }],
    ['Version', 'Support Agent', { can_read: true }],
    ['Version', 'Support Manager', { can_read: true }],
  ]
  const have = (await must(
    await req(
      `/api/resource/DocPerm?limit_page_length=500&fields=${encodeURIComponent(
        JSON.stringify(['name', 'ref_doctype', 'role']),
      )}`,
    ),
    'list DocPerm',
  )) as { data: { ref_doctype: string; role: string }[] }
  const haveSet = new Set(have.data.map((p) => `${p.ref_doctype}|${p.role}`))
  for (const [ref_doctype, role, perms] of grants) {
    if (haveSet.has(`${ref_doctype}|${role}`)) {
      console.log(`  = DocPerm ${ref_doctype}/${role} (exists)`)
      continue
    }
    await must(
      await req('/api/save_doc', {
        method: 'POST',
        body: JSON.stringify({ doctype: 'DocPerm', doc: { ref_doctype, role, ...perms } }),
      }),
      `DocPerm ${ref_doctype}/${role}`,
    )
    console.log(`  + DocPerm ${ref_doctype}/${role}`)
  }

  console.log('Workflow (bound to the status field)')
  await ensureDoc('Workflow', {
    name: 'Ticket Flow',
    document_type: 'Ticket',
    is_active: true,
    state_field: 'status',
    states: [
      { state: 'Open', doc_status: '0' },
      { state: 'In Progress', doc_status: '0' },
      { state: 'Resolved', doc_status: '0' },
      { state: 'Closed', doc_status: '0' },
    ],
    transitions: [
      { state: 'Open', action: 'Start', next_state: 'In Progress', allowed: 'Support Agent' },
      {
        state: 'In Progress', action: 'Resolve', next_state: 'Resolved', allowed: 'Support Agent',
        // Conditional transition: you can't resolve without writing down how.
        condition: 'doc.resolution_details && String(doc.resolution_details).trim().length > 0',
      },
      { state: 'Resolved', action: 'Close', next_state: 'Closed', allowed: 'Support Manager' },
      { state: 'Resolved', action: 'Reopen', next_state: 'Open', allowed: 'Customer' },
    ],
  })

  console.log('Email account, notification rule')
  await ensureDoc('Email Account', {
    name: 'Helpdesk Notifications',
    email_id: 'support@helpdesk.test',
    is_default: true,
  })
  await ensureDoc('Email Rule', {
    name: 'Ticket Resolved Notice',
    document_type: 'Ticket',
    event: 'on_save',
    condition_field: 'status',
    condition_value: 'Resolved',
    recipient: '{{ doc.raised_by }}',
    subject: 'Your ticket {{ doc.name }} has been resolved',
    message:
      'Hello,\n\nyour ticket "{{ doc.subject }}" was resolved.\n\n' +
      'Resolution: {{ doc.resolution_details }}\n\n' +
      'Reply to reopen it from your portal.',
    enabled: true,
  })

  console.log('Server Script (raised_by default)')
  await ensureDoc('Server Script', {
    name: 'Ticket Defaults',
    script_type: 'Document Event',
    reference_doctype: 'Ticket',
    event: 'validate',
    script: "if (!doc.raised_by) { doc.raised_by = doc.owner }",
    enabled: true,
  })

  console.log('Assignment Rule (round-robin agents)')
  await ensureDoc('Assignment Rule', {
    name: 'Ticket Round Robin',
    document_type: 'Ticket',
    description: 'New support ticket',
    assign_to_field: 'agent',
    users: [{ user: 'agent1@helpdesk.test' }, { user: 'agent2@helpdesk.test' }],
  })

  console.log('SLA')
  await ensureDoc('Service Level Agreement', {
    name: 'Ticket SLA',
    document_type: 'Ticket',
    enabled: true,
    priority_field: 'priority',
    fulfilled_states: 'Resolved\nClosed',
    escalation_role: 'Support Manager',
    priorities: [
      { priority: 'Urgent', response_hours: 1, resolution_hours: 4 },
      { priority: 'High', response_hours: 4, resolution_hours: 24 },
      { priority: 'Medium', response_hours: 8, resolution_hours: 48 },
      { priority: 'Low', response_hours: 24, resolution_hours: 72 },
    ],
  })

  console.log('Web Form (/form/new-ticket)')
  await ensureDoc('Web Form', {
    name: 'New Ticket',
    title: 'Raise a support ticket',
    route: 'new-ticket',
    document_type: 'Ticket',
    published: true,
    success_message: 'Thanks — your ticket has been filed. Track it in your portal.',
    web_fields: JSON.stringify(['subject', 'description', 'priority']),
  })

  console.log('\nHelpdesk seeded. Try:')
  console.log(`  Desk:    ${BASE.replace('8000', '5173')}/desk/Ticket (agent1@helpdesk.test / demo1234)`)
  console.log(`  Intake:  ${BASE.replace('8000', '5173')}/form/new-ticket (log in as cust1@acme.test first)`)
  console.log(`  Portal:  ${BASE.replace('8000', '5173')}/portal/Ticket`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
