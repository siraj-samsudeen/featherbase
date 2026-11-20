// #1240: feedback on a report, raised from the report (Dash's "Report an issue") through Tickets'
// own create action, as the person themselves. The report fills in where they came from.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { test as pgTest } from './pg-test'
import { pinning, TICKETS_DIRECTORY, TICKETS_VERSION, Tickets } from './tickets-world'
import { sql } from '../src/db'

const test = pgTest.extend(pinning)

const FROM_REPORT = {
  problem: 'Target too high or too low', about: 'Kanchipuram silk target',
  report: 'Sales · Target vs Actual', report_key: 'sales_target', view: '/dash/?report=sales_target&store=P101&month=this', app: 'Dash',
  store: 'T Nagar (P101)', month: 'This month', filters: 'Store: P101 · Month: 2026-11',
  reach: 'T Nagar: Sarees, Silk (14 subcategories)', subcategories: 'P101: SAR01, SAR02', job: 'Team Leader job assignment, since 01-Apr-2026',
  seen_at: '2026-11-16T14:43:00.000Z',
}
const raise = (t: Tickets, details: Record<string, unknown> = FROM_REPORT, actor = 'Anjali', original = '₹18 L is double last November.') =>
  t.action('create', { title: `${details.problem}: ${details.report}`, original, kind: 'report_feedback', details }, actor, true)

describe('Feedback on a report (#1240)', () => {
  test('the person raises it themselves, with the report\'s context, in a New ticket nobody is assigned', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.setup()
    expect((await raise(t)).status).toBe(200)
    expect(t.ticket).toMatchObject({ owner: t.ids.Anjali, kind: 'report_feedback', ticket_state: 'New', title: 'Target too high or too low: Sales · Target vs Actual' })
    expect(t.ticket.assigned_to ?? null).toBeNull()
    const detail = await t.open('Anjali')
    expect(detail.details).toMatchObject({ ...FROM_REPORT, original: '₹18 L is double last November.' })
  })

  test('its context is private to the raiser and support; a colleague sees the ticket\'s title only', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.setup()
    await raise(t)
    expect((await t.open('Support')).details).toMatchObject({ reach: FROM_REPORT.reach, job: FROM_REPORT.job })
    const colleague = await t.open('Colleague')
    expect(colleague.ticket.title).toBe('Target too high or too low: Sales · Target vs Actual')
    expect(colleague.details).toBeUndefined()
    expect(JSON.stringify(colleague)).not.toContain('Team Leader')
  })

  test('the report\'s context is checked: known fields, the quick picks, a key, and a link that stays on this instance', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.setup()
    const before = await t.ticketCount()
    for (const [patch, message] of [
      [{ problem: 'Rude staff' }, /What's wrong must be one of/],
      [{ report: '' }, /Report is required/],
      [{ view: 'https://evil.example/phish' }, /path on this instance/],
      [{ view: '//evil.example/phish' }, /path on this instance/],
      [{ view: 'javascript:alert(1)' }, /path on this instance/],
      [{ view: '/\\evil.example' }, /path on this instance/],
      [{ report_key: 'Sales target; drop' }, /Report key must be a key/],
      [{ owner: 'someone-else' }, /has no field owner/],
      [{ about: 'x'.repeat(201) }, /longer than 200/],
      [{ about: 42 }, /must be text/],
      [{ seen_at: 'yesterday' }, /Seen at must be a time/],
    ] as const) {
      const response = await raise(t, { ...FROM_REPORT, ...patch })
      expect(response.status, JSON.stringify(patch)).toBe(417)
      expect(JSON.stringify(response.body)).toMatch(message)
    }
    expect(await t.ticketCount()).toBe(before)
  })

  test('support may edit it, but never into a link that leaves the instance', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.setup()
    await raise(t)
    await t.action('edit', { details: { about: 'Soft silk target' } }, 'Support')
    expect((await t.open('Support')).details).toMatchObject({ about: 'Soft silk target', report: FROM_REPORT.report })
    const refused = await t.action('edit', { details: { view: 'https://evil.example' } }, 'Support', true)
    expect(refused.status).toBe(417)
  })

  test('a retry with the same key and payload is answered with the same ticket, never a second one', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.setup()
    const body = { idempotencyKey: 'report-issue-retry-1', payload: { title: 'Stock missing: Sales · Target vs Actual', original: 'Stock missing',
      kind: 'report_feedback', details: FROM_REPORT } }
    const before = await t.ticketCount()
    const first = await t.call('Anjali', '/api/app_actions/tickets/create', body)
    const again = await t.call('Anjali', '/api/app_actions/tickets/create', body)
    expect([first.status, again.status]).toEqual([200, 200])
    expect(again.body.result.ticket.row_id).toBe(first.body.result.ticket.row_id)
    expect(await t.ticketCount()).toBe(before + 1)
  })

  test('the reporter sees their own open feedback on that report, and only theirs, newest first', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.setup()
    await raise(t)
    const first = t.ticket.row_id
    await raise(t, { ...FROM_REPORT, problem: 'Stock missing', about: 'Soft silk 6 yards' })
    const second = t.ticket.row_id
    await raise(t, { ...FROM_REPORT, report: 'Stock on hand', report_key: 'stock_on_hand', view: '/dash/?report=stock_on_hand' })
    await raise(t, FROM_REPORT, 'Colleague')
    const mine = await t.read('about_report', { report_key: 'sales_target' }, 'Anjali')
    expect(mine.count).toBe(2)
    expect(mine.tickets.map((ticket: any) => [ticket.row_id, ticket.problem, ticket.about, ticket.ticket_state])).toEqual([
      [second, 'Stock missing', 'Soft silk 6 yards', 'New'], [first, 'Target too high or too low', 'Kanchipuram silk target', 'New']])
    // A resolved one is no longer open.
    t.ticket = (await t.read('detail', { row_id: first }, 'Support')).ticket
    await t.action('resolve', { reason: 'Target revised to ₹12 L', reference: 'Target sheet v3' }, 'Support')
    expect((await t.read('about_report', { report_key: 'sales_target' }, 'Anjali')).tickets.map((ticket: any) => ticket.row_id)).toEqual([second])
    // Support's own list on that report is theirs alone: they raised none.
    expect((await t.read('about_report', { report_key: 'sales_target' }, 'Support')).count).toBe(0)
  })

  test('the New ticket form still offers it (support may file one by hand), and the read is declared', async ({ admin, createUser }) => {
    const t = new Tickets(admin, createUser)
    await t.setup()
    const form = await t.read('form', {}, 'Anjali')
    expect(form.types.map((type: any) => type.key)).toContain('report_feedback')
    const manifest = JSON.parse(await readFile(resolve(TICKETS_DIRECTORY, 'featherbase.json'), 'utf8'))
    expect(manifest.reads.operations.about_report).toEqual({ policy: { kind: 'table' }, authorization: { kind: 'generic' } })
    // #1236's (0.2.18, the switcher's line), #1248's (0.2.19, the sidebar rail) and #1252's (0.2.20, the ticket page's words) no-op steps, #1256's relabel (0.2.21) #1301's no-op step (0.2.22, no refused Person reads) and #1378's (0.2.23, shareable addresses), follow it.
    expect(manifest.migrations.at(-7)).toEqual({ id: 'report_feedback', fromVersion: '0.2.15', toVersion: '0.2.17', operations: [] })
    expect(TICKETS_VERSION).toBe('0.2.23')
    expect((await sql`select package_version from installed_app where name = 'tickets'`)[0].package_version).toBe('0.2.23')
  })
})
