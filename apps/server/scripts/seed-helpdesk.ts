/* Helpdesk sample app + DEMO CONTENT. The structure — HD Ticket Table,
 * roles, permissions, and the fixture documents (status-field workflow, SLA,
 * email account + rule, server script, web form) — is a registered app
 * manifest now (src/sample-apps/helpdesk.ts, PLAT-006 #78): this script
 * installs it over POST /api/install_app exactly as a user would (skipped if
 * the structure is already present), then seeds, over the HTTP API of a
 * running server, the pieces a demo needs and a real deployment would not:
 *
 * - Demo users (password demo1234): two agents, a manager, two customers
 * - Assignment Rule: new tickets round-robin between the two agents and
 *   stamp the `agent` field (lives here, not in the structure, because it
 *   links the demo users)
 * - Five sample tickets, filed by the customers through the public web form
 *
 * Run with the app up (./init.sh):
 *
 *   pnpm --filter server seed:helpdesk
 *
 * Idempotent: existing structure/users/rules are skipped; sample tickets are
 * only filed when the customers have none. Undo demo content with
 * reset:helpdesk; migration 0057 removes the structure wholesale.
 */
import { sql } from '../src/db'

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
  // /api/table is the one Table-scoped surface (#61) — /api/resource is gone.
  const res = await req(
    'admin',
    `/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
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

  console.log('Structure (the helpdesk app: HD Ticket Table, roles, workflow, SLA, web form)')
  // Install the registered app over the API — the same call any deployment
  // makes. Skipped when the structure already exists (a previous seed, or a
  // database that predates the app packaging).
  const has = await req('admin', '/api/table/HD%20Ticket:meta')
  if (has.ok) {
    console.log('  = helpdesk structure (exists)')
  } else {
    await must(
      await req('admin', '/api/install_app', {
        method: 'POST',
        body: JSON.stringify({ name: 'helpdesk' }),
      }),
      'install helpdesk app',
    )
    console.log('  + helpdesk app installed')
  }

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
    // Post-0055 name (was document_type before the terminology rename).
    ref_table: 'HD Ticket',
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
    await req('admin', '/api/table/HD%20Ticket?limit_page_length=1'),
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
  console.log(`  Admin:   ${BASE.replace('8000', '5173')}/admin/HD%20Ticket (agent1@helpdesk.test / demo1234)`)
  console.log(`  Intake:  ${BASE.replace('8000', '5173')}/form/new-ticket (log in as cust1@acme.test first)`)
  console.log(`  Portal:  ${BASE.replace('8000', '5173')}/portal/HD%20Ticket`)
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err)
    await sql.end().catch(() => {})
    process.exit(1)
  })
