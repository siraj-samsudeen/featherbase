import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, vi } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { committedTest } from './pg-test-shared'
import { grantRole, makeTable } from './fixtures'
import { discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'
import { drainJobs, loadJobs } from '../src/jobs'
import { appLinkOrigin, parseInstanceAddresses } from '../src/instance-addresses'
import { callerMail } from '../src/runtime-mail'
import { config } from '../src/config'

// #1001: assigning a ticket emails the person assigned, once, after the save
// commits. A load through `create` sends nothing.
const directory = resolve('../..', 'example-apps/tickets')
const { version } = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as { version: string }
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': `tickets@${version}` },
}) }, client.token, client.user)
type Fixtures = { admin: TestClient; createUser: CreateUserFn }
const pinning = {
  admin: async ({ admin }: { admin: TestClient }, use: (client: TestClient) => Promise<void>) => use(pinned(admin)),
  createUser: async ({ createUser }: { createUser: CreateUserFn }, use: (create: CreateUserFn) => Promise<void>) =>
    use(async options => pinned(await createUser(options))),
}
const test = pgTest.extend<Fixtures>(pinning)
const realCommits = committedTest.extend<Fixtures>(pinning)

type Ticket = { row_id: string; updated_at: string; title: string; assigned_to?: string | null }
type Person = TestClient & { user: string }
const act = async (client: TestClient, name: string, payload: object, idempotencyKey: string = randomUUID()) =>
  (await client.post<any>(`/api/app_actions/tickets/${name}`, { idempotencyKey, payload })).result
const save = (admin: TestClient, table: string, row: object) => admin.post<any>('/api/save_row', { table, row })
async function setting(admin: TestClient, name: string, value: unknown) {
  const filters = encodeURIComponent(JSON.stringify([['row_id', '=', `tickets.${name}`]]))
  const current = (await admin.get<any>(`/api/table/App%20Setting?filters=${filters}&fields=${encodeURIComponent('["row_id","updated_at"]')}`)).data[0]
  await save(admin, 'App Setting', { row_id: `tickets.${name}`, updated_at: current?.updated_at, value: JSON.stringify(value) })
}
const DESCRIPTION = 'Two plants carry both door numbers'
async function world(admin: TestClient, createUser: CreateUserFn) {
  await discoverPackages([directory])
  await admin.post('/api/install_app', { name: 'tickets' })
  const person = (name: string, roles?: string[]) => createUser({ email: `${name}@tickets.example.test`, fullName: name, ...(roles ? { roles } : {}) }) as Promise<Person>
  const raiser = await person('raiser')
  const worker = await person('worker')
  const second = await person('second')
  const support = await person('triager', ['Tickets Support'])
  const other = await person('other', ['Tickets Support'])
  await setting(admin, 'support_users', [support.user, other.user])
  const type = await save(admin, 'tickets.ticket_type', { type_key: 'data_quality_issue', label: 'Data Quality Issue', enabled: true,
    states: 'Raised\nClosed', done_states: 'Closed', details_visible_to: 'everyone' })
  await save(admin, 'tickets.type_field', { ticket_type: type.row_id, field_name: 'current_value', label: 'Current value', field_type: 'text' })
  const openTicket = async () => (await act(raiser, 'create', { title: 'Plant address is wrong', original: DESCRIPTION,
    kind: 'data_quality_issue', details: { current_value: '78/499/1' } })).ticket as Ticket
  const privateTicket = async () => (await act(raiser, 'create', { title: 'The report is late', original: DESCRIPTION, kind: 'generic', details: {} })).ticket as Ticket
  return { raiser, worker, second, support, other, openTicket, privateTicket }
}
const revision = (ticket: Ticket) => ({ row_id: ticket.row_id, updated_at: ticket.updated_at })
const assign = async (by: TestClient, ticket: Ticket, person: string | null, key?: string) =>
  (await act(by, 'edit', { ...revision(ticket), assigned_to: person }, key)).ticket as Ticket
const mailFor = (ticket: Ticket) => sql`select recipient, subject, body, send_status, ref_table from email_queue
  where ref_table = 'tickets.ticket' and reference_name = ${ticket.row_id} order by created_at`
const recipients = async (ticket: Ticket) => (await mailFor(ticket)).map(row => row.recipient)
const stored = async (ticket: Ticket) => (await sql`select assigned_to from tickets.ticket where row_id = ${ticket.row_id}`)[0].assigned_to

afterEach(() => { vi.restoreAllMocks() })

describe('Tickets: assigning a ticket emails the person assigned (#1001)', () => {
  test('assigning sends one email, in plain language, to the person assigned', async ({ admin, createUser }) => {
    const { worker, support, openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    await assign(support, ticket, worker.user)
    const mail = await mailFor(ticket)
    expect(mail).toHaveLength(1)
    expect(mail[0]).toMatchObject({ recipient: 'worker@tickets.example.test', send_status: 'queued',
      subject: 'Ticket assigned to you: Plant address is wrong' })
    expect(mail[0].body).toContain('triager assigned this ticket to you.')
    expect(mail[0].body).toContain('Plant address is wrong')
    expect(mail[0].body).toContain(DESCRIPTION)
    // A development server has no address list, so it links to the dev web origin.
    expect(mail[0].body).toContain(`http://localhost:5173/tickets/?ticket=${ticket.row_id}`)
    expect(mail[0].body).not.toContain(worker.user)
  })

  test('the queued email reaches the mailbox once', async ({ admin, createUser }) => {
    const { worker, support, openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    await assign(support, ticket, worker.user)
    await loadJobs()
    await sql`update background_job set run_at = now() where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
    await drainJobs()
    expect((await mailFor(ticket))[0].send_status).toBe('sent')
    expect(await sql`select mail_to from email_sink where subject = 'Ticket assigned to you: Plant address is wrong'`)
      .toEqual([{ mail_to: 'worker@tickets.example.test' }])
  })

  test('reassigning sends one email to the new person', async ({ admin, createUser }) => {
    const { worker, second, support, openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    const assigned = await assign(support, ticket, worker.user)
    await assign(support, assigned, second.user)
    expect(await recipients(ticket)).toEqual(['worker@tickets.example.test', 'second@tickets.example.test'])
  })

  test('a save that leaves the assignee unchanged sends nothing', async ({ admin, createUser }) => {
    const { worker, support, openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    const assigned = await assign(support, ticket, worker.user)
    const same = await assign(support, assigned, worker.user)
    await act(support, 'edit', { ...revision(same), title: 'Plant address is still wrong', state: 'Closed' })
    expect(await recipients(ticket)).toEqual(['worker@tickets.example.test'])
  })

  test('clearing the assignee sends nothing', async ({ admin, createUser }) => {
    const { worker, support, openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    const assigned = await assign(support, ticket, worker.user)
    const cleared = await assign(support, assigned, null)
    expect(cleared.assigned_to).toBeNull()
    const again = await assign(support, await assign(support, cleared, ''), '')
    expect(again.assigned_to).toBeNull()
    expect(await recipients(ticket)).toEqual(['worker@tickets.example.test'])
  })

  test('assigning yourself sends nothing', async ({ admin, createUser }) => {
    const { support, openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    expect((await assign(support, ticket, support.user)).assigned_to).toBe(support.user)
    expect(await mailFor(ticket)).toEqual([])
  })

  test('a person with no email gets none, the skip is logged without an address, and the save succeeds', async ({ admin, createUser }) => {
    const { worker, support, openTicket } = await world(admin, createUser)
    await sql`update person set email = null where row_id = ${worker.user}`
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ticket = await openTicket()
    expect((await assign(support, ticket, worker.user)).assigned_to).toBe(worker.user)
    expect(await stored(ticket)).toBe(worker.user)
    expect(await mailFor(ticket)).toEqual([])
    expect(warn.mock.calls.map(call => JSON.parse(String(call[0])))).toContainEqual(expect.objectContaining({
      event: 'app_mail_skipped', app: 'tickets', reason: 'no_email', person: worker.user }))
  })

  test('a disabled person gets none', async ({ admin, createUser }) => {
    const { worker, support, openTicket } = await world(admin, createUser)
    await sql`update person set enabled = false where row_id = ${worker.user}`
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ticket = await openTicket()
    await assign(support, ticket, worker.user).catch(() => {})
    expect(await mailFor(ticket)).toEqual([])
  })

  test('creating a ticket unassigned sends nothing, and it stays unassigned', async ({ admin, createUser }) => {
    const { openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    expect(ticket.assigned_to ?? null).toBeNull()
    expect(await mailFor(ticket)).toEqual([])
  })

  test('routing that picks an assignee on create sends nothing either', async ({ admin, createUser }) => {
    const { raiser, worker } = await world(admin, createUser)
    await makeTable(admin, { name: 'Mail Example System', title_column: 'system_name', columns: ['system_name'] })
    await makeTable(admin, { name: 'Mail Example Owner', columns: [
      { column_name: 'source_system', column_type: 'Reference', reference_table: 'Mail Example System' }, 'person', 'is_primary:Check'] })
    await grantRole(admin, { role: 'All', table: ['Mail Example System', 'Mail Example Owner'], can_read: true })
    const sap = await save(admin, 'Mail Example System', { system_name: 'SAP' })
    await save(admin, 'Mail Example Owner', { source_system: sap.row_id, person: worker.user, is_primary: true })
    await setting(admin, 'linked_tables', ['Mail Example System', 'Mail Example Owner'])
    const type = await save(admin, 'tickets.ticket_type', { type_key: 'routed_issue', label: 'Routed', enabled: true, states: 'Raised\nClosed', done_states: 'Closed',
      routing: JSON.stringify({ field: 'source_system', table: 'Mail Example Owner', match: 'source_system', person: 'person', primary: 'is_primary' }) })
    await save(admin, 'tickets.type_field', { ticket_type: type.row_id, field_name: 'source_system', label: 'Source system', field_type: 'link',
      link_table: 'Mail Example System', link_label: 'system_name', required: true })
    const { ticket } = await act(raiser, 'create', { title: 'Routed', original: DESCRIPTION, kind: 'routed_issue', details: { source_system: sap.row_id } })
    expect(ticket.assigned_to).toBe(worker.user)
    expect(await mailFor(ticket)).toEqual([])
  })

  test('with no routing on the type, the same ticket is created unassigned', async ({ admin, createUser }) => {
    const { raiser } = await world(admin, createUser)
    await makeTable(admin, { name: 'Mail Example System', title_column: 'system_name', columns: ['system_name'] })
    await grantRole(admin, { role: 'All', table: ['Mail Example System'], can_read: true })
    const sap = await save(admin, 'Mail Example System', { system_name: 'SAP' })
    await setting(admin, 'linked_tables', ['Mail Example System'])
    const type = await save(admin, 'tickets.ticket_type', { type_key: 'unrouted_issue', label: 'Unrouted', enabled: true, states: 'Raised\nClosed', done_states: 'Closed' })
    await save(admin, 'tickets.type_field', { ticket_type: type.row_id, field_name: 'source_system', label: 'Source system', field_type: 'link',
      link_table: 'Mail Example System', link_label: 'system_name', required: true })
    const { ticket } = await act(raiser, 'create', { title: 'Unrouted', original: DESCRIPTION, kind: 'unrouted_issue', details: { source_system: sap.row_id } })
    expect(ticket.assigned_to ?? null).toBeNull()
  })

  // #925: whoever a private ticket is assigned to reads its description, so it is sent.
  test('a private ticket\'s assignee, who now reads its description, gets it; support and the raiser do too', async ({ admin, createUser }) => {
    const { raiser, worker, other, support, privateTicket } = await world(admin, createUser)
    for (const person of [worker, other, raiser]) {
      const ticket = await privateTicket()
      await assign(support, ticket, person.user)
      const [mail] = await mailFor(ticket)
      expect(mail.body).toContain('The report is late')
      expect(mail.body).toContain(DESCRIPTION)
      // What the email promises: the same person really reads it on the ticket.
      const answer = (await person.post<any>('/api/app_reads/tickets/detail', { payload: { row_id: ticket.row_id } })).result.answer
      expect(answer.details.original).toBe(DESCRIPTION)
    }
  })

  test('a description reworded in the same save is the one sent', async ({ admin, createUser }) => {
    const { worker, support, openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    await act(support, 'edit', { ...revision(ticket), assigned_to: worker.user, original: 'The corrected wording' })
    const [mail] = await mailFor(ticket)
    expect(mail.body).toContain('The corrected wording')
    expect(mail.body).not.toContain(DESCRIPTION)
  })

  test('an emailed link uses the address that serves the app, not one that would redirect it away', () => {
    const list = parseInstanceAddresses(JSON.stringify([
      { address: 'https://dash.example.com', opens: 'dash', emails: true },
      { address: 'https://featherbase.example.com', opens: 'admin' },
    ]), 'production')
    expect(appLinkOrigin(list, 'production', 'dash')).toBe('https://dash.example.com')
    expect(appLinkOrigin(list, 'production', 'tickets')).toBe('https://featherbase.example.com')
    expect(appLinkOrigin(null, 'production', 'tickets')).toBeNull()
    expect(appLinkOrigin(null, 'development', 'tickets')).toBe('http://localhost:5173')
  })
})

describe('Runtime action mail (#1001)', () => {
  const mail = callerMail('tickets', ['tickets.ticket'])
  const queued = (subject: string) => sql`select recipient, body from email_queue where subject = ${subject}`
  const skipped = () => vi.spyOn(console, 'warn').mockImplementation(() => {})
  const skips = (warn: ReturnType<typeof skipped>) => warn.mock.calls.map(call => JSON.parse(String(call[0])).reason)

  test('nobody who can\'t be emailed gets mail, and each skip says why', async ({ admin, createUser }) => {
    const { worker, second } = await world(admin, createUser)
    await sql`update person set enabled = false, replaced_by = ${second.user} where row_id = ${worker.user}`
    const warn = skipped()
    for (const person of ['psn_nobody', 'Administrator', worker.user]) await mail.toPerson(person, { subject: 'Skipped mail', body: 'Hello' })
    expect(await queued('Skipped mail')).toEqual([])
    expect(skips(warn)).toEqual(['unknown_person', 'built_in', 'disabled'])
    expect(JSON.stringify(warn.mock.calls)).not.toContain('@')
  })

  test('a message with no path has no link, and an unsafe subject stays one line', async ({ admin, createUser }) => {
    const { worker } = await world(admin, createUser)
    await mail.toPerson(worker.user, { subject: ' Two\nlines ', body: 'Just this' })
    expect(await queued('Two lines')).toEqual([{ recipient: 'worker@tickets.example.test', body: 'Just this' }])
  })

  test('on an instance with addresses, the link uses the Admin address when none opens the app', async ({ admin, createUser }) => {
    const { worker } = await world(admin, createUser)
    const before = config.instanceAddresses
    config.instanceAddresses = parseInstanceAddresses(JSON.stringify([
      { address: 'https://dash.example.com', opens: 'dash', emails: true },
      { address: 'https://featherbase.example.com', opens: 'admin' },
    ]), 'production')
    try { await mail.toPerson(worker.user, { subject: 'Linked mail', body: 'See', path: '?ticket=FT-1' }) }
    finally { config.instanceAddresses = before }
    expect((await queued('Linked mail'))[0].body).toBe('See\n\nOpen it here: https://featherbase.example.com/tickets/?ticket=FT-1')
  })

  test('mayRead answers for the person, and only about the app\'s own Tables', async ({ admin, createUser }) => {
    const { worker, openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    expect(await mail.mayRead(worker.user, 'tickets.ticket', ticket.row_id)).toBe(true)
    expect(await mail.mayRead(worker.user, 'tickets.ticket', 'FT-none')).toBe(false)
    await expect(mail.mayRead(worker.user, 'Person', worker.user)).rejects.toThrow('has not declared Table Person')
    // Any other failure is not an answer of "no": it is raised.
    await expect(mail.mayRead(worker.user, 'tickets.ticket', undefined as unknown as string)).rejects.toThrow()
  })
})

describe('Tickets assignment email on real commits (#1001)', () => {
  realCommits('it is queued only after the save has committed, and a retry with the same key sends no second one', async ({ admin, createUser }) => {
    const { worker, support, openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    const key = randomUUID()
    const first = await act(support, 'edit', { ...revision(ticket), assigned_to: worker.user }, key)
    expect(await stored(ticket)).toBe(worker.user)
    expect(await recipients(ticket)).toEqual(['worker@tickets.example.test'])
    expect(await act(support, 'edit', { ...revision(ticket), assigned_to: worker.user }, key)).toEqual(first)
    expect(await recipients(ticket)).toEqual(['worker@tickets.example.test'])
  })

  realCommits('a save whose commit fails sends nothing; the retry then sends one', async ({ admin, createUser }) => {
    const { worker, support, openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    // Fails at COMMIT itself: every statement of the save, and the handler, have succeeded.
    await sql.unsafe(`create or replace function refuse_commit_1001() returns trigger language plpgsql as $$ begin raise exception 'refused at commit'; end $$`)
    await sql.unsafe(`create constraint trigger refuse_commit_1001 after insert on featherbase.runtime_action_result deferrable initially deferred for each row execute function refuse_commit_1001()`)
    const key = randomUUID()
    try {
      await expect(act(support, 'edit', { ...revision(ticket), assigned_to: worker.user }, key)).rejects.toBeTruthy()
    } finally {
      await sql.unsafe(`drop trigger refuse_commit_1001 on featherbase.runtime_action_result`)
      await sql.unsafe(`drop function refuse_commit_1001()`)
    }
    expect(await stored(ticket)).toBeNull()
    expect(await mailFor(ticket)).toEqual([])
    await act(support, 'edit', { ...revision(ticket), assigned_to: worker.user }, key)
    expect(await stored(ticket)).toBe(worker.user)
    expect(await recipients(ticket)).toEqual(['worker@tickets.example.test'])
  })

  realCommits('when the mail cannot be queued, the assignment still stands', async ({ admin, createUser }) => {
    const { worker, support, openTicket } = await world(admin, createUser)
    const ticket = await openTicket()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await sql.unsafe(`create or replace function refuse_mail_1001() returns trigger language plpgsql as $$ begin raise exception 'mail table unavailable'; end $$`)
    await sql.unsafe(`create trigger refuse_mail_1001 before insert on featherbase.email_queue for each row execute function refuse_mail_1001()`)
    try {
      expect((await assign(support, ticket, worker.user)).assigned_to).toBe(worker.user)
    } finally {
      await sql.unsafe(`drop trigger refuse_mail_1001 on featherbase.email_queue`)
      await sql.unsafe(`drop function refuse_mail_1001()`)
    }
    expect(await stored(ticket)).toBe(worker.user)
    expect(await mailFor(ticket)).toEqual([])
    expect(logged).toHaveBeenCalled()
  })
})
