/* Helpdesk DEMO CONTENT, seeded through the public HTTP API of a running
 * server. The helpdesk's structure — HD Ticket DocType, roles, permissions,
 * the status-field workflow, SLA, email rule, server script, and web form —
 * ships in migration 0051_helpdesk.ts; this script adds only the pieces a
 * demo needs and a real deployment would not:
 *
 * - Demo users (password demo1234): two agents, a manager, two customers
 * - Assignment Rule: new tickets round-robin between the two agents and
 *   stamp the `agent` field (lives here, not in the migration, because it
 *   links the demo users)
 * - Five sample tickets, filed by the customers through the public web form
 *
 * Run with the app up (./init.sh):
 *
 *   pnpm --filter server seed:helpdesk
 *
 * Idempotent: existing users/rules are skipped; sample tickets are only
 * filed when the customers have none. Undo with reset:helpdesk.
 */

const BASE = process.env.SERVER_URL ?? 'http://localhost:8000'
const ADMIN = process.env.ADMIN_USER ?? 'Administrator'
const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

const tokens: Record<string, string> = {}

async function req(user: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(tokens[user] ? { authorization: `Bearer ${tokens[user]}` } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  })
}

async function must(res: Response, what: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`${what}: ${res.status} ${JSON.stringify(body)}`)
  return body
}

async function login(key: string, usr: string, pwd: string) {
  const body = await must(
    await req(key, '/api/login', { method: 'POST', body: JSON.stringify({ usr, pwd }) }),
    `login ${usr}`,
  )
  tokens[key] = body.token as string
}

async function exists(doctype: string, name: string): Promise<boolean> {
  const res = await req(
    'admin',
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
  )
  return res.ok
}

async function ensureDoc(doctype: string, doc: Record<string, unknown>, key?: string) {
  const name = key ?? String(doc.name)
  if (await exists(doctype, name)) {
    console.log(`  = ${doctype} ${name} (exists)`)
    return
  }
  await must(
    await req('admin', '/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype, doc }),
    }),
    `${doctype} ${name}`,
  )
  console.log(`  + ${doctype} ${name}`)
}

async function main() {
  await login('admin', ADMIN, ADMIN_PWD)

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
      await req('admin', '/api/set_password', {
        method: 'POST',
        body: JSON.stringify({ user: email, password: 'demo1234' }),
      }),
      `password ${email}`,
    )
  }

  console.log('Assignment Rule (round-robin agents)')
  await ensureDoc('Assignment Rule', {
    name: 'HD Ticket Round Robin',
    document_type: 'HD Ticket',
    description: 'New support ticket',
    assign_to_field: 'agent',
    users: [{ user: 'agent1@helpdesk.test' }, { user: 'agent2@helpdesk.test' }],
  })

  console.log('Sample tickets (filed by the customers through the web form)')
  const samples: [string, string, string, string][] = [
    // [customer, subject, priority, description]
    ['cust1@acme.test', 'Cannot log in to the portal', 'High',
      'Password reset emails never arrive; MFA re-enrolment loops back to the login page.'],
    ['cust1@acme.test', 'Invoice PDF downloads blank', 'Medium',
      'Every invoice since Tuesday renders as a zero-byte PDF.'],
    ['cust2@globex.test', 'Data export stuck at 90%', 'Urgent',
      'The nightly CSV export has hung at 90% three nights running.'],
    ['cust2@globex.test', 'Add a dark mode to the dashboard', 'Low',
      'Feature request from our night-shift operators.'],
    ['cust2@globex.test', 'API rate limits unclear', 'Medium',
      'Docs say 600 req/min but we are throttled at 300.'],
  ]
  for (const [customer] of samples) await login(customer, customer, 'demo1234')
  const existing = (await must(
    await req('admin', '/api/resource/HD%20Ticket?limit_page_length=1'),
    'list HD Ticket',
  )) as { total?: number }
  if (Number(existing.total ?? 0) > 0) {
    console.log('  = sample tickets (HD Ticket documents already exist)')
  } else {
    for (const [customer, subject, priority, description] of samples) {
      await must(
        await req(customer, '/api/web_form/new-ticket', {
          method: 'POST',
          body: JSON.stringify({ values: { subject, description, priority } }),
        }),
        `web form: ${subject}`,
      )
      console.log(`  + ${subject} (${customer})`)
    }
  }

  console.log('\nHelpdesk demo ready. Try:')
  console.log(`  Desk:    ${BASE.replace('8000', '5173')}/desk/HD%20Ticket (agent1@helpdesk.test / demo1234)`)
  console.log(`  Intake:  ${BASE.replace('8000', '5173')}/form/new-ticket (log in as cust1@acme.test first)`)
  console.log(`  Portal:  ${BASE.replace('8000', '5173')}/portal/HD%20Ticket`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
