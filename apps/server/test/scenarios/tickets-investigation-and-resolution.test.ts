// tickets-investigation-and-resolution (#810), each fenced scenario of
// openspec/changes/feather-tickets-stage-one/specs/tickets-investigation-and-resolution/spec.md
// step by step, against Tickets' own actions and reads. The development
// samples are loaded by the real tools/seed-tickets-development.mjs, its HTTP
// requests answered in-process.
import { afterEach, describe, expect, vi } from 'vitest'
import { test as pgTest } from '../pg-test'
import { sandboxRequest } from '../pg-test-shared'
import { scenarioFor } from '../scenario'
import { pinning, Tickets, type Ticket } from '../tickets-world'
// @ts-expect-error The development seed is plain JavaScript, without types.
import { seedTickets } from '../../../../tools/seed-tickets-development.mjs'

const test = pgTest.extend(pinning)
const scenario = scenarioFor(test, 'tickets-investigation-and-resolution')
const ORIGINAL = 'Invoices cleared two days ago are missing from the report'

afterEach(() => { vi.unstubAllGlobals() })

/** A fresh install: no business samples in its queue. */
async function ordinaryInstall(t: Tickets) {
  await t.setup()
  const before: Ticket[] = (await t.read('queue')).tickets
  expect(before, 'a fresh install must have no business samples').toEqual([])
  return before
}

describe('tickets-investigation-and-resolution', () => {
  scenario('A stale-data report starts unconfirmed', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step(`Anjali reports "${ORIGINAL}"`, () => t.complaint(ORIGINAL))
    await step('the user is authorized to investigate the ticket', () => t.choose('Support'))
    await step('the user begins investigation without source or report evidence', () => t.open())
    await step('the complaint remains unconfirmed', async () => {
      await t.excludes('confirmed_mismatch')
      await t.includes('Invoices cleared two days ago')
    })
    await step('no automated diagnosis or warehouse query is claimed', () => t.excludes('"query_executed":true', '"automated_diagnosis":true'))
  })

  scenario('Evidence supports a finding without inventing its cause', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step(`Anjali reports "${ORIGINAL}"`, () => t.complaint(ORIGINAL))
    await step('the user is authorized to investigate the ticket', () => t.choose('Support'))
    await step('the user records a confirmed mismatch with expected 2 invoices from "source-check-1" and observed 0 from "report-check-1" for 2026-11-01, observed at 2026-11-03T09:00:00Z', () =>
      t.action('evidence', { expected: '2 invoices from source-check-1', observed: '0 from report-check-1',
        reference: 'source-check-1; report-check-1', observed_at: '2026-11-03T09:00:00Z', finding: 'confirmed_mismatch' }))
    await step('reopening the ticket shows that finding, both evidence references, observation time and author', () =>
      t.includes('confirmed_mismatch', 'source-check-1', 'report-check-1', '2026-11-03T09:00:00', t.ids.Support))
    await step("the finding's root cause remains unknown", async () => expect(await t.text()).not.toMatch(/"root_cause":"(?!unknown)[^"]+"/))
  })

  scenario('Related work is a reference rather than an agent action', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step("Anjali's missing-invoice ticket is being investigated", () => t.complaint())
    await step('the user is authorized to investigate the ticket', () => t.choose('Support'))
    await step('the user adds an existing GitHub issue reference', () => t.action('link', { url: 'https://github.com/fictional-warehouse/demo/issues/37' }))
    await step("the reference is available in the ticket's support history", () => t.includes('/issues/37'))
    await step('the ticket does not claim that an agent created an issue or pull request', () => t.excludes('"agent_created":true', '"agent_execution":true'))
  })

  scenario('A supported resolution remains available', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step("Anjali's missing-invoice ticket has a recorded mismatch", async () => { await t.complaint(); await t.finding() })
    await step('the user is authorized to investigate the ticket', () => t.choose('Support'))
    await step('the user resolves it with reason "Report refreshed and both invoices present" and evidence "report-check-2"', () =>
      t.action('resolve', { reason: 'Report refreshed and both invoices present', reference: 'report-check-2' }))
    await step('reopening the ticket shows the resolution, reason, evidence and responsible user', async () => {
      expect(t.ticket.ticket_state).toBe('Resolved')
      await t.includes('Report refreshed and both invoices present', 'report-check-2', t.ids.Support)
    })
  })

  scenario('A resolved investigation can be reopened without losing its finding', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step("Anjali's missing-invoice ticket was resolved with a recorded finding and evidence", () => t.resolved())
    await step('the user is authorized to investigate the ticket', () => t.choose('Support'))
    await step(`the user reopens it because "The next day's report is still missing invoices"`, () =>
      t.action('reopen', { reason: "The next day's report is still missing invoices" }))
    await step('the ticket returns to active work', () => expect(t.ticket.ticket_state).not.toBe('Resolved'))
    await step('its earlier resolution, evidence and reopening reason remain attributed in history', () =>
      t.includes('Report refreshed and both invoices present', 'report-check-2', "The next day's report is still missing invoices", t.ids.Support))
  })

  scenario('Resolution cannot bypass access fulfillment', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Anjali has an unapproved access request', () => t.access())
    await step('the user is authorized to investigate tickets but not fulfill access', () => t.choose('Support'))
    await step('the user attempts to resolve it as an ordinary investigation', () =>
      t.action('resolve', { reason: 'Ordinary resolution', reference: 'Not fulfillment' }, t.actor, true))
    await step('resolution is refused and the request remains unfulfilled', async () => { t.denied(); await t.unfulfilled() })
  })

  scenario('Unconfigured connections do not claim activity', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    let connections: unknown
    await step('Tickets has no live integration configuration', () => t.setup())
    await step('the user is authorized to manage support', () => t.choose('Support'))
    await step('the user inspects connection status', async () => { connections = (await t.read('session')).connections })
    await step('employee lookup, inbound email and automated investigation are shown as unconfigured', () => {
      const text = JSON.stringify(connections)
      for (const name of ['employee', 'email', 'investigation', 'unconfigured']) expect(text).toContain(name)
    })
    await step('no received email, employee match or agent execution is claimed', () =>
      expect(JSON.stringify(connections)).not.toMatch(/"(?:received|matched|executed)":true/))
  })

  scenario('An ordinary installation has no sample requests', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    let queue: Ticket[] = []
    await step('Tickets was installed without requesting development samples', () => ordinaryInstall(t))
    await step('the user inspects the support queue', async () => { queue = (await t.read('queue')).tickets })
    await step('no sample tickets or fictional investigation findings are present', () => expect(JSON.stringify(queue)).not.toMatch(/fictional|sample/i))
  })

  scenario('Explicit development samples are identified as fictional', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    let before: Ticket[] = [], queue: Ticket[] = []
    await step('Tickets is running in a development instance without real business requests', async () => { before = await ordinaryInstall(t) })
    await step('the user explicitly loads the development samples', async () => {
      // The explicit development-only script, never a product action or install hook.
      const password = 'seed-admin-password-1070'
      await admin.post('/api/set_password', { user: admin.user, password })
      vi.stubGlobal('fetch', (url: URL | string, init?: RequestInit) => {
        const { pathname, search } = new URL(String(url))
        return sandboxRequest(pathname + search, init)
      })
      await seedTickets({ baseUrl: 'http://127.0.0.1:8110', password, expectedEnvironment: 'test' })
      vi.unstubAllGlobals()
      queue = (await t.read('queue')).tickets
    })
    await step('fictional tickets are available for the walkthrough', () => {
      expect(queue.length).toBeGreaterThan(before.length)
      expect(JSON.stringify(queue)).toMatch(/fictional/i)
    })
    await step('their employee and investigation evidence is identified as fictional rather than production findings', async () => {
      for (const table of ['tickets.request', 'tickets.event']) {
        const fields = table === 'tickets.request' ? ['row_id', 'original'] : ['row_id', 'operation', 'text']
        const params = new URLSearchParams({ limit_page_length: '500', fields: JSON.stringify(fields) })
        const { data } = await admin.get<{ data: { operation?: string }[] }>(`/api/table/${table}?${params}`)
        const evidence = table === 'tickets.event' ? data.filter(row => ['verify', 'evidence'].includes(String(row.operation))) : data
        expect(evidence.length).toBeGreaterThan(0)
        for (const row of evidence) expect(JSON.stringify(row)).toMatch(/fictional/i)
      }
    })
  })
})
