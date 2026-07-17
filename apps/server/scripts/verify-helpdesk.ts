/* End-to-end verification of the seeded Helpdesk, exercised the way its users
 * would over real HTTP (run seed-helpdesk.ts first, server up):
 *
 *   pnpm --filter server verify:helpdesk
 *
 * Covers: web-form intake + owner attribution, server-script defaults,
 * round-robin auto-assignment, SLA deadline stamping, if_owner portal
 * scoping, role-gated + conditional workflow transitions on the bound status
 * field, save-protection of that field, resolved-notification email delivery,
 * comments, assignee ToDos, and SLA escalation (with a time-warp via SQL —
 * the single non-HTTP step).
 */
import { sql } from '../src/db'

const BASE = process.env.SERVER_URL ?? 'http://localhost:8000'
const PWD = 'demo1234'

const tokens: Record<string, string> = {}
let failures = 0

function ok(cond: unknown, label: string) {
  if (cond) console.log(`  PASS ${label}`)
  else {
    failures++
    console.log(`  FAIL ${label}`)
  }
}

async function login(usr: string, pwd = PWD): Promise<string> {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr, pwd }),
  })
  if (!res.ok) throw new Error(`login ${usr}: ${res.status}`)
  return ((await res.json()) as { token: string }).token
}

async function req(user: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tokens[user]}`,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  })
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

type Doc = Record<string, unknown>

async function fileTicket(user: string, subject: string, priority = 'Medium'): Promise<Doc> {
  const res = await req(user, '/api/web_form/new-ticket', {
    method: 'POST',
    body: JSON.stringify({ values: { subject, description: `${subject} (details)`, priority } }),
  })
  if (res.status !== 201) throw new Error(`web form: ${res.status} ${await res.text()}`)
  const { name } = await json<{ name: string }>(res)
  const doc = await req('admin', `/api/resource/Ticket/${name}`)
  return json<Doc>(doc)
}

async function workflowActions(user: string, name: string): Promise<string[]> {
  const res = await req(user, `/api/workflow/Ticket/${name}`)
  const body = await json<{ actions?: { action: string }[] }>(res)
  return (body.actions ?? []).map((a) => a.action)
}

async function apply(user: string, name: string, action: string): Promise<Response> {
  return req(user, '/api/apply_workflow_action', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'Ticket', name, action }),
  })
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// The in-process worker ticks every 500ms; poll instead of guessing a delay.
async function poll(label: string, check: () => Promise<boolean>, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await check()) return ok(true, label)
    await sleep(500)
  }
  ok(false, `${label} (timed out after ${timeoutMs}ms)`)
}

async function main() {
  tokens.admin = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
  for (const u of ['agent1@helpdesk.test', 'agent2@helpdesk.test', 'manager@helpdesk.test', 'cust1@acme.test', 'cust2@globex.test'])
    tokens[u] = await login(u)

  console.log('\n1. Intake: web form, attribution, defaults, assignment, SLA stamps')
  const t1 = await fileTicket('cust1@acme.test', 'Cannot log in to portal', 'High')
  const t2 = await fileTicket('cust2@globex.test', 'Invoice PDF is blank', 'Medium')
  ok(String(t1.name).startsWith('TICK-'), `naming series (${t1.name})`)
  ok(t1.owner === 'cust1@acme.test', 'web-form submitter owns the ticket')
  ok(t1.raised_by === 'cust1@acme.test', 'server script defaulted raised_by')
  ok(t1.status === 'Open', 'workflow initial state on the status field')
  const pool = ['agent1@helpdesk.test', 'agent2@helpdesk.test']
  ok(pool.includes(String(t1.agent)), `auto-assigned (${t1.agent})`)
  ok(pool.includes(String(t2.agent)) && t2.agent !== t1.agent, `round-robin alternated (${t2.agent})`)
  ok(t1.response_by != null && t1.resolution_by != null, 'SLA deadlines stamped')
  const hours = (Number(new Date(String(t1.resolution_by))) - Number(new Date(String(t1.creation)))) / 3600e3
  ok(Math.abs(hours - 24) < 0.1, `High resolution window = 24h (got ${hours.toFixed(2)})`)
  ok(t1.sla_status === 'On Track', 'sla_status starts On Track')

  console.log('\n2. Portal: if_owner scoping')
  const mine = await json<{ data: { name: string }[]; total: number }>(
    await req('cust1@acme.test', '/api/resource/Ticket'),
  )
  ok(mine.total === 1 && mine.data[0].name === t1.name, 'customer list shows only own tickets')
  ok((await req('cust1@acme.test', `/api/resource/Ticket/${t2.name}`)).status === 403, "another customer's ticket is 403")

  console.log('\n3. Workflow on the bound status field')
  const agent = String(t1.agent)
  ok((await workflowActions(agent, String(t1.name))).join() === 'Start', 'agent sees only Start from Open')
  ok((await apply(agent, String(t1.name), 'Start')).status === 200, 'agent starts the ticket')
  let cur = await json<Doc>(await req('admin', `/api/resource/Ticket/${t1.name}`))
  ok(cur.status === 'In Progress', 'status field moved to In Progress')

  const early = await apply(agent, String(t1.name), 'Resolve')
  ok(early.status >= 400, `Resolve without resolution_details refused (${early.status})`)

  const upd = await req(agent, `/api/resource/Ticket/${t1.name}`, {
    method: 'PUT',
    body: JSON.stringify({ modified: cur.modified, resolution_details: 'Password reset + MFA re-enrolled.' }),
  })
  ok(upd.status === 200, 'agent records resolution details')
  ok((await apply(agent, String(t1.name), 'Resolve')).status === 200, 'Resolve allowed once details exist')
  cur = await json<Doc>(await req('admin', `/api/resource/Ticket/${t1.name}`))
  ok(cur.status === 'Resolved', 'status = Resolved')

  const smuggle = await req(agent, `/api/resource/Ticket/${t1.name}`, {
    method: 'PUT',
    body: JSON.stringify({ modified: cur.modified, status: 'Closed' }),
  })
  ok(smuggle.status >= 400, `direct status edit is refused (${smuggle.status})`)

  ok((await workflowActions('cust1@acme.test', String(t1.name))).join() === 'Reopen', 'customer may only Reopen')
  ok((await apply(agent, String(t1.name), 'Close')).status === 403, 'agent cannot Close (manager-only)')
  ok((await apply('manager@helpdesk.test', String(t1.name), 'Close')).status === 200, 'manager Closes')
  cur = await json<Doc>(await req('admin', `/api/resource/Ticket/${t1.name}`))
  ok(cur.status === 'Closed', 'status = Closed')

  console.log('\n4. Resolved notification email (queued by the transition, sent by the worker)')
  await poll('requester received the resolved email', async () => {
    const sink = await json<{ data: { mail_to: string; subject: string }[] }>(
      await req(
        'admin',
        `/api/resource/${encodeURIComponent('Email Sink')}?limit_page_length=100&fields=${encodeURIComponent(
          JSON.stringify(['mail_to', 'subject']),
        )}&filters=${encodeURIComponent(JSON.stringify([['mail_to', '=', 'cust1@acme.test']]))}`,
      ),
    )
    return sink.data.some((m) => m.subject === `Your ticket ${t1.name} has been resolved`)
  })

  console.log('\n5. Collaboration: comment + assignee ToDo')
  const comment = await req(agent, '/api/resource/Comment', {
    method: 'POST',
    body: JSON.stringify({ ref_doctype: 'Ticket', ref_name: t2.name, content: 'Looking into the PDF renderer.' }),
  })
  ok(comment.status === 201, 'agent comments on a ticket')
  const seen = await json<{ data: { content: string }[] }>(
    await req(
      'cust2@globex.test',
      `/api/resource/Comment?fields=${encodeURIComponent(JSON.stringify(['content']))}&filters=${encodeURIComponent(
        JSON.stringify([['ref_name', '=', t2.name]]),
      )}`,
    ),
  )
  ok(seen.data.some((c) => c.content.includes('PDF renderer')), 'customer reads the comment')
  const todos = await json<{ data: { reference_name: string }[] }>(
    await req(
      String(t2.agent),
      `/api/resource/ToDo?fields=${encodeURIComponent(JSON.stringify(['reference_name']))}&filters=${encodeURIComponent(
        JSON.stringify([['allocated_to', '=', String(t2.agent)], ['reference_name', '=', t2.name]]),
      )}`,
    ),
  )
  ok(todos.data.length === 1, 'assignee finds the ticket in their ToDo list')

  console.log('\n6. SLA escalation (time-warp, then the check_sla job)')
  const t3 = await fileTicket('cust1@acme.test', 'Server room is on fire', 'Urgent')
  await sql`update tab_ticket set resolution_by = now() - interval '1 hour' where name = ${String(t3.name)}`
  const kick = await req('admin', '/api/enqueue_job', {
    method: 'POST',
    body: JSON.stringify({ method: 'check_sla' }),
  })
  ok(kick.status === 201 || kick.status === 200, 'check_sla enqueued')
  await poll('overdue ticket flipped to Overdue', async () => {
    const late = await json<Doc>(await req('admin', `/api/resource/Ticket/${t3.name}`))
    return late.sla_status === 'Overdue'
  })
  await poll('manager received the escalation email', async () => {
    const esc = await json<{ data: { mail_to: string; subject: string }[] }>(
      await req(
        'admin',
        `/api/resource/${encodeURIComponent('Email Sink')}?limit_page_length=100&fields=${encodeURIComponent(
          JSON.stringify(['mail_to', 'subject']),
        )}&filters=${encodeURIComponent(JSON.stringify([['subject', 'like', `%SLA breached: Ticket ${t3.name}%`]]))}`,
      ),
    )
    return esc.data.some((m) => m.mail_to === 'manager@helpdesk.test')
  })

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err)
    await sql.end().catch(() => {})
    process.exit(1)
  })
