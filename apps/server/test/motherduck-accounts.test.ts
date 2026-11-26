// #1346: MotherDuck Accounts kept in step with MotherDuck's list of users: three
// statuses, never a deleted row, a link by email when it names one person, and
// one ticket for every other account a person uses, closed once it is linked.
import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { overrideVariable } from '../src/env'
import { _setMotherDuckUsersFetch, candidateLine, listMotherDuckUsers, motherDuckSyncAccount, MotherDuckSyncStop, syncMotherDuckAccounts, type MotherDuckUser } from '../src/motherduck-accounts'
import { makePerson, patchDoc, searchLines } from './fixtures'
import { resolve } from 'node:path'
import { discoverPackages } from '../src/runtime-packages'

type Listed = Partial<MotherDuckUser> & { id: string; username: string }
const calls: string[] = []
function motherduck(pages: Listed[][], status = 200) {
  calls.length = 0
  _setMotherDuckUsersFetch(async (url, init) => {
    calls.push(`${init.method} ${url} ${String((init.headers as Record<string, string>).authorization).slice(0, 7)}`)
    if (status !== 200) return new Response('{}', { status })
    const token = new URL(url).searchParams.get('page_token')
    const i = token ? Number(token) : 0
    return Response.json({ users: pages[i], total_count: pages.flat().length, next_page_token: i + 1 < pages.length ? String(i + 1) : null })
  })
}
const accounts = async () => (await sql`select username, account_status, person, removed_on is not null as removed, review_ticket is not null as ticketed
  from motherduck_account order by username`).map((r) => ({ ...r }))

afterEach(async () => {
  await discoverPackages([])
  _setMotherDuckUsersFetch(null)
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
})

describe('#1346: the MotherDuck account sync', () => {
  test('lists every page with GET only, and stops saying what to grant when MotherDuck refuses', async () => {
    overrideVariable('MOTHERDUCK_TOKEN', 'md-read-token')
    motherduck([[{ id: 'u1', username: 'one' }], [{ id: 'u2', username: 'two' }]])
    expect((await listMotherDuckUsers()).map((u) => u.username)).toEqual(['one', 'two'])
    expect(calls).toEqual([
      'GET https://api.motherduck.com/v1/users?limit=100 Bearer ',
      'GET https://api.motherduck.com/v1/users?limit=100&page_token=1 Bearer ',
    ])
    motherduck([], 403)
    await expect(listMotherDuckUsers()).rejects.toThrow(/View all members.*no Admin token/)
    motherduck([], 500)
    await expect(listMotherDuckUsers()).rejects.toThrow('MotherDuck answered 500 when asked for its users')
    _setMotherDuckUsersFetch(async () => Response.json({ people: [] }))
    await expect(listMotherDuckUsers()).rejects.toThrow('in a shape this server does not know')
    _setMotherDuckUsersFetch(async () => Response.json({ users: [], next_page_token: 'again' }))
    await expect(listMotherDuckUsers()).rejects.toThrow('stopped after 200')
    overrideVariable('MOTHERDUCK_TOKEN', undefined)
    await expect(listMotherDuckUsers()).rejects.toBeInstanceOf(MotherDuckSyncStop)
  })

  test('three statuses, a link by email, one ticket per unlinked account, closed once linked', async ({ admin }) => {
    overrideVariable('MOTHERDUCK_TOKEN', 'md-read-token')
    expect(await discoverPackages([resolve('../..', 'example-apps/tickets')])).toEqual([])
    await admin.post('/api/install_app', { name: 'tickets' })
    // Tickets lets only its support people assign and close; the instance lists the sync's account there.
    const setSupport = (ids: string[]) => sql`insert into app_setting (row_id, app, setting, value) values ('tickets.support_users', 'tickets', 'support_users', ${JSON.stringify(ids)})
      on conflict (row_id) do update set value = excluded.value`
    await setSupport([])
    const reviewer = await makePerson({ email: 'reviewer-1346@example.com', full_name: 'Reviewer Person' })
    await sql`insert into single_value (table_name, field, value) values ('System Settings', 'motherduck_reviewer', ${reviewer})
      on conflict (table_name, field) do update set value = excluded.value`
    const ravi = await makePerson({ email: 'ravi-1346@example.com', full_name: 'Ravi Md' })
    const asha = await makePerson({ full_name: 'Asha Reports Md' })
    // A leaver is still the person who used the account.
    await sql`update person set enabled = false where row_id = ${ravi}`

    // Day one: three people and a program.
    motherduck([[
      { id: 'md-ravi', username: 'ravi_md', email: 'RAVI-1346@example.com', roles: ['member'] },
      { id: 'md-asha', username: 'asha_reports', email: 'asha@elsewhere.example', first_name: 'Asha', last_name: 'R' },
      { id: 'md-gone', username: 'gone_user', email: 'gone@elsewhere.example' },
      { id: 'md-bot', username: 'loader_service_account', is_service_account: true },
    ]])
    // Not yet support: the tickets are raised, then assigning them stops the run, saying what to configure.
    const refused = await syncMotherDuckAccounts()
    expect(refused).toMatchObject({ listed: 4, added: 4, removed: 0, linked: 1 })
    expect(refused.tickets_raised).toHaveLength(2)
    expect(refused.ticket_errors).toEqual([expect.stringMatching(/add it to the Tickets setting support_users/)])
    // Support, but with no reviewer set: the run says so, and assigns nobody.
    await setSupport([await motherDuckSyncAccount()])
    await sql`delete from single_value where table_name = 'System Settings' and field = 'motherduck_reviewer'`
    expect((await syncMotherDuckAccounts()).ticket_errors).toEqual([expect.stringMatching(/no MotherDuck reviewer is set/)])
    await sql`insert into single_value (table_name, field, value) values ('System Settings', 'motherduck_reviewer', ${reviewer})`
    // With both, the next run assigns them, and raises none twice.
    const first = await syncMotherDuckAccounts()
    expect(first).toMatchObject({ added: 0, linked: 0, tickets_raised: [], ticket_errors: [] })
    expect(await accounts()).toEqual([
      { username: 'asha_reports', account_status: 'Active', person: null, removed: false, ticketed: true },
      { username: 'gone_user', account_status: 'Active', person: null, removed: false, ticketed: true },
      { username: 'loader_service_account', account_status: 'Active', person: null, removed: false, ticketed: false },
      { username: 'ravi_md', account_status: 'Active', person: ravi, removed: false, ticketed: false },
    ])
    const [ticket] = await sql`select t.title, t.assigned_to, r.original from tickets.ticket t
      join tickets.open_request r on r.row_id = t.row_id where t.title like '%asha_reports%'
      union all select t.title, t.assigned_to, r.original from tickets.ticket t
      join tickets.request r on r.row_id = t.row_id where t.title like '%asha_reports%'`
    expect(ticket).toMatchObject({ title: 'Link MotherDuck user asha_reports to a person', assigned_to: reviewer })
    // Raised for the reviewer, so they can read who it may be.
    expect(await sql`select owner from tickets.ticket where title like '%asha_reports%'`).toEqual([{ owner: reviewer }])
    expect(String(ticket.original)).toContain('asha@elsewhere.example')
    expect(String(ticket.original)).toContain(`Asha Reports Md (${asha})`)

    // Day two: one switched off in MotherDuck, one gone from its list. No row is deleted, no ticket raised twice.
    motherduck([[
      { id: 'md-ravi', username: 'ravi_md', email: 'ravi-1346@example.com', is_deprovisioned: true },
      { id: 'md-asha', username: 'asha_reports', email: 'asha@elsewhere.example' },
      { id: 'md-bot', username: 'loader_service_account', is_service_account: true },
    ]])
    const second = await syncMotherDuckAccounts()
    expect(second).toMatchObject({ listed: 3, added: 0, removed: 1, linked: 0, tickets_raised: [], ticket_errors: [] })
    expect((await accounts()).map((a) => [a.username, a.account_status, a.removed])).toEqual([
      ['asha_reports', 'Active', false], ['gone_user', 'Removed', true], ['loader_service_account', 'Active', false], ['ravi_md', 'Deprovisioned', false],
    ])

    // A run raised asha_reports' ticket but stopped before recording it, and a person then
    // linked the account by hand: the next run finds that ticket again and closes it.
    await sql`update motherduck_account set review_ticket = null where row_id = 'md-asha'`
    const row = await admin.get<Record<string, unknown>>('/api/table/MotherDuck Account/md-asha')
    await patchDoc(admin, '/api/table/MotherDuck Account/md-asha', { updated_at: row.updated_at, person: asha })
    const third = await syncMotherDuckAccounts()
    expect(third).toMatchObject({ tickets_raised: [], ticket_errors: [] })
    expect(third.tickets_resolved).toHaveLength(1)
    expect(await sql`select ticket_state from tickets.ticket where title like '%asha_reports%'`).toEqual([{ ticket_state: 'Resolved' }])
    expect((await syncMotherDuckAccounts()).tickets_resolved).toEqual([])

    // MotherDuck gives a removed account's username to a new account: it gets a ticket of its own.
    motherduck([[
      { id: 'md-ravi', username: 'ravi_md', email: 'ravi-1346@example.com', is_deprovisioned: true },
      { id: 'md-asha', username: 'asha_reports', email: 'asha@elsewhere.example' },
      { id: 'md-gone-again', username: 'gone_user', email: 'gone-again@elsewhere.example' },
      { id: 'md-bot', username: 'loader_service_account', is_service_account: true },
    ]])
    expect((await syncMotherDuckAccounts()).tickets_raised).toHaveLength(1)
    expect(await sql`select count(distinct review_ticket)::int as n from motherduck_account where username = 'gone_user'`).toEqual([{ n: 2 }])

    // A ticket Tickets will not close (someone changed its type) is noted, and the run goes on.
    await sql`update tickets.ticket set kind = 'access' where row_id = (select review_ticket from motherduck_account where row_id = 'md-gone-again')`
    const again = await admin.get<Record<string, unknown>>('/api/table/MotherDuck Account/md-gone-again')
    await patchDoc(admin, '/api/table/MotherDuck Account/md-gone-again', { updated_at: again.updated_at, person: ravi })
    expect((await syncMotherDuckAccounts()).ticket_errors).toEqual([expect.stringMatching(/^gone_user: .*Access must be completed/)])

    // Tickets switched off: the run says no ticket was raised.
    await sql`update installed_app set enabled = false where name = 'tickets'`
    motherduck([[{ id: 'md-late', username: 'late_joiner', email: 'late@elsewhere.example' }]])
    expect((await syncMotherDuckAccounts()).ticket_errors).toEqual(['the Tickets app is not installed and on, so no ticket was raised'])

    // The Admin lists them, a link on each to its person.
    const listed = await admin.get<{ data: Record<string, unknown>[] }>('/api/table/MotherDuck Account?fields=' + encodeURIComponent('["username","person","account_status"]'))
    expect(JSON.stringify(listed)).toContain('ravi_md')
    // Search finds the account by its username, and by its email.
    const hits = async (q: string) => ((await searchLines(admin, q)).find((l) => (l as { table?: string }).table === 'MotherDuck Account') as { hits: { title: string }[] } | undefined)?.hits.map((h) => h.title) ?? []
    expect(await hits('asha_reports')).toEqual(['asha_reports'])
    expect(await hits('asha@elsewhere')).toEqual(['asha_reports'])
  })

  test('the daily job records what a run did, or why it would not run', async () => {
    const { enqueue, runOneJob } = await import('../src/jobs')
    const run = async () => {
      await sql`delete from background_job`
      await enqueue('sync_motherduck_accounts', {}, { maxAttempts: 1 })
      await sql`update background_job set run_at = now() where method = 'sync_motherduck_accounts'`
      expect(await runOneJob()).toBe(true)
      const [last] = await sql`select outcome, result from job_execution where method = 'sync_motherduck_accounts' order by started_at desc, row_id desc limit 1`
      return last
    }
    overrideVariable('MOTHERDUCK_TOKEN', 'md-read-token')
    motherduck([[{ id: 'md-job-bot', username: 'job_service_account', is_service_account: true }]])
    expect(await run()).toMatchObject({ outcome: 'success', result: expect.stringMatching(/^MotherDuck accounts: 1 listed · 1 added/) })
    // Without the Tickets app, an account a person uses cannot be put to anyone.
    motherduck([[{ id: 'md-job-bot', username: 'job_service_account', is_service_account: true }, { id: 'md-job-person', username: 'job_person' }]])
    expect(await run()).toMatchObject({ outcome: 'refused', result: expect.stringContaining('the Tickets app is not installed') })
    motherduck([], 403)
    expect(await run()).toMatchObject({ outcome: 'refused', result: expect.stringContaining('View all members') })
    // MotherDuck failing outright is an error, retried like any other.
    motherduck([], 500)
    expect(await run()).toMatchObject({ outcome: 'error' })
  })

  test('a candidate reads as name (id) · code · job at place', () => {
    expect(candidateLine('Asha R', 'psn_a', { status: 'current', code: 'E-1', jobs: [{ job: 'Buyer', site: { table: 'Site', id: 's1', name: 'Main Store' } }, { job: 'Trainer' }] }))
      .toBe('- Asha R (psn_a) · E-1 · Buyer at Main Store; Trainer')
    expect(candidateLine('Asha R', 'psn_a', undefined)).toBe('- Asha R (psn_a)')
  })

  test('a reappearing account is listed again, Active, with no removal date', async () => {
    overrideVariable('MOTHERDUCK_TOKEN', 'md-read-token')
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      motherduck([[{ id: 'md-back', username: 'back_again', is_service_account: true }]])
      await syncMotherDuckAccounts()
      motherduck([[]])
      vi.setSystemTime(new Date(Date.now() + 86_400_000))
      await syncMotherDuckAccounts()
      motherduck([[{ id: 'md-back', username: 'back_again', is_service_account: true }]])
      vi.setSystemTime(new Date(Date.now() + 86_400_000))
      await syncMotherDuckAccounts()
      expect(await accounts()).toEqual([{ username: 'back_again', account_status: 'Active', person: null, removed: false, ticketed: false }])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('#1396: linking accounts to people from one screen', () => {
  test('lists each account with its person and the people its username reads as, and queues the sync, for System Managers only', async ({ admin, createUser }) => {
    const priya = await makePerson({ full_name: 'Priya Raman' })
    await makePerson({ full_name: 'Priyanka S' })
    const linked = await makePerson({ full_name: 'Linked Already', email: 'linked@elsewhere.example' })
    overrideVariable('MOTHERDUCK_TOKEN', 'md-read-token')
    motherduck([[
      { id: 'md-priya', username: 'priya', email: 'priya@elsewhere.example', first_name: 'Priya', last_name: 'R' },
      { id: 'md-linked', username: 'linked_one', email: 'linked@elsewhere.example' },
      { id: 'md-bot', username: 'loader_bot', is_service_account: true },
    ]])
    await syncMotherDuckAccounts()

    const { accounts } = await admin.get<{ accounts: Record<string, unknown>[] }>('/api/motherduck_accounts/linking')
    const by = Object.fromEntries(accounts.map((a) => [a.username, a]))
    expect(Object.keys(by).sort()).toEqual(['linked_one', 'loader_bot', 'priya'])
    expect(by.priya).toMatchObject({
      row_id: 'md-priya', full_name: 'Priya R', email: 'priya@elsewhere.example', account_status: 'Active', service_account: false, person: null,
    })
    expect(typeof by.priya.updated_at).toBe('string')
    expect((by.priya.suggestions as { person: string; name: string }[]).map((s) => s.name)).toEqual(['Priya Raman', 'Priyanka S'])
    expect((by.priya.suggestions as { person: string }[])[0].person).toBe(priya)
    expect(by.linked_one.person).toEqual({ id: linked, name: 'Linked Already' })
    expect(by.loader_bot).toMatchObject({ service_account: true, suggestions: [] })

    expect((await admin.fetch('/api/motherduck_accounts/sync', { method: 'POST' })).status).toBe(202)
    expect(await sql`select 1 from background_job where method = 'sync_motherduck_accounts' and job_status = 'queued'`).not.toHaveLength(0)

    const plain = await createUser({ email: 'plain.1396@example.test' })
    expect((await plain.fetch('/api/motherduck_accounts/linking')).status).toBe(403)
    expect((await plain.fetch('/api/motherduck_accounts/sync', { method: 'POST' })).status).toBe(403)
  })
})
