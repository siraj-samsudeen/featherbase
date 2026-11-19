// #1346: MotherDuck Accounts kept in step with MotherDuck's list of users: three
// statuses, never a deleted row, a link by email when it names one person, and
// one ticket for every other account a person uses, closed once it is linked.
import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { overrideVariable } from '../src/env'
import { _setMotherDuckUsersFetch, listMotherDuckUsers, motherDuckSyncAccount, MotherDuckSyncStop, syncMotherDuckAccounts, type MotherDuckUser } from '../src/motherduck-accounts'
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

    // Search finds the account by its username, and by its email.
    const hits = async (q: string) => ((await searchLines(admin, q)).find((l) => (l as { table?: string }).table === 'MotherDuck Account') as { hits: { title: string }[] } | undefined)?.hits.map((h) => h.title) ?? []
    expect(await hits('asha_reports')).toEqual(['asha_reports'])
    expect(await hits('asha@elsewhere')).toEqual(['asha_reports'])
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
