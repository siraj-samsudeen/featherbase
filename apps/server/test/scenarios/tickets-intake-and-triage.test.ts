// tickets-intake-and-triage (#810), each fenced scenario of
// openspec/changes/feather-tickets-stage-one/specs/tickets-intake-and-triage/spec.md
// step by step, against Tickets' own actions and reads.
import { describe, expect } from 'vitest'
import { makeClient } from 'feather-testing-postgres'
import { test as pgTest } from '../pg-test'
import { sandboxRequest } from '../pg-test-shared'
import { scenarioFor } from '../scenario'
import { issueSession } from '../../src/auth'
import { pinned, pinning, Tickets, type Ticket } from '../tickets-world'

const test = pgTest.extend(pinning)
const scenario = scenarioFor(test, 'tickets-intake-and-triage')
const SECRETS = ['PRIVATE support note 431', 'Fictional HR confirmation']

/** What the actor reads of the ticket, its Tables and its activity: public progress, never support's secrets. */
async function publicPrivacy(t: Tickets, owner = false) {
  const detail = await t.open()
  const text = JSON.stringify(detail)
  expect(text).toContain('Support is checking this request')
  for (const secret of SECRETS) expect(text).not.toContain(secret)
  if (!owner) { expect(detail.details).toBeUndefined(); expect(text).not.toContain('anjali@example.com') }
  for (const table of ['tickets.ticket', 'tickets.event', ...(owner ? [] : ['tickets.request'])]) {
    const list = await t.call(t.actor, `/api/table/${table}?limit_page_length=500`, undefined, 'GET')
    expect([200, 403]).toContain(list.status)
    const body = JSON.stringify(list.body)
    for (const secret of SECRETS) expect(body).not.toContain(secret)
    if (!owner) expect(body).not.toContain('anjali@example.com')
  }
  const activity = await t.call(t.actor, `/api/activity/tickets.ticket/${t.ticket.row_id}`, undefined, 'GET')
  expect(activity.status).toBe(200)
  expect(JSON.stringify(activity.body)).not.toContain('PRIVATE support note 431')
}

describe('tickets-intake-and-triage', () => {
  scenario('A hurried request remains available', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('the user is signed in as Anjali', () => t.choose('Anjali'))
    await step('the user submits "Please give me MotherDuck access" as a free-text request', () =>
      t.create('generic', {}, 'Please give me MotherDuck access'))
    await step('the user receives a ticket reference', () => {
      expect(typeof t.ticket.row_id).toBe('string')
      expect(t.ticket.row_id.length).toBeGreaterThan(0)
    })
    await step('the request remains available after signing out and back in', async () => {
      const signedOut = t.people.Anjali
      expect((await signedOut.fetch('/api/logout', { method: 'POST' })).status).toBe(200)
      expect((await signedOut.fetch('/api/whoami')).status).toBe(401)
      const again = pinned(makeClient({ request: sandboxRequest }, (await issueSession(t.ids.Anjali)).token, t.ids.Anjali))
      t.people.Anjali = again
      expect((await t.open('Anjali')).ticket.row_id).toBe(t.ticket.row_id)
    })
  })

  scenario('An access request identifies its intended recipient and scope', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('the user is signed in as Anjali', () => t.choose('Anjali'))
    await step('the user requests MotherDuck access for "anjali@example.com" to "Gold sales, read only"', () =>
      t.access('anjali@example.com', 'Gold sales, read only'))
    await step('the ticket retains that recipient and requested scope', () => t.includes(String(t.details.email), String(t.details.scope)))
    await step('employment remains unverified', () => t.cannotApprove())
  })

  scenario('A report request records its delivery needs', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('the user is signed in as Anjali', () => t.choose('Anjali'))
    await step('the user requests an Excel sales report for Palakkad from 2026-10-01 through 2026-10-31', () =>
      t.create('report', { location: 'Palakkad', from: '2026-10-01', through: '2026-10-31', format: 'Excel' }))
    await step('the ticket retains the location, period and requested format', () => t.includes('Palakkad', '2026-10-01', '2026-10-31', 'Excel'))
  })

  scenario('A stale-data request records what should have arrived', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('the user is signed in as Anjali', () => t.choose('Anjali'))
    await step('the user reports missing cleared Zakya invoices for 2026-11-01 in the daily sales report', () =>
      t.create('freshness', { source: 'Zakya', report: 'daily sales', date: '2026-11-01', expected: 'cleared invoices' }))
    await step('the ticket retains the source, affected report, date and expected invoices', () =>
      t.includes('Zakya', 'daily sales', '2026-11-01', 'cleared invoices'))
    await step('it does not invent a confirmed root cause', () => t.excludes('confirmed_root_cause'))
  })

  scenario('A new-source request records its ingestion needs', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('the user is signed in as Anjali', () => t.choose('Anjali'))
    await step('the user requests a new vendor API source for daily stock movements with an hourly refresh', () =>
      t.create('source', { source: 'vendor API', data: 'daily stock movements', refresh: 'hourly' }))
    await step('the ticket retains the source, requested data and refresh need', () => t.includes('vendor API', 'daily stock movements', 'hourly'))
  })

  scenario('A free-text request becomes an access request', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Anjali submitted "Please give me MotherDuck access" as a free-text request', () =>
      t.create('generic', {}, 'Please give me MotherDuck access'))
    await step('the user is authorized to triage the ticket', () => t.choose('Support'))
    await step('the user classifies it as access and records "Gold sales, read only" as the requested scope', async () => {
      t.details = { email: 'anjali@example.com', scope: 'Gold sales, read only' }
      await t.action('edit', { kind: 'access', details: t.details })
    })
    await step('the ticket is an access request with that scope', async () => {
      expect((await t.open()).ticket.kind).toBe('access')
      await t.includes('Gold sales, read only')
    })
    await step('its original message is still "Please give me MotherDuck access"', () => t.includes('Please give me MotherDuck access'))
  })

  scenario('A copied reference finds the ticket', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    let queue: Ticket[] = []
    await step('Anjali has a ticket with reference "FT-1042"', async () => {
      await t.setup()
      // The exact example reference, allocated through normal naming and creation.
      const { id_pattern } = await admin.get<{ id_pattern: string }>('/api/table/tickets.ticket:meta')
      await admin.put('/api/table_def/tickets.ticket/id_pattern', { id_pattern: 'field:title' })
      try {
        await t.action('create', { title: 'FT-1042', original: 'Copied reference fixture', kind: 'generic', details: {} }, 'Anjali')
        expect(t.ticket.row_id).toBe('FT-1042')
      } finally {
        await admin.put('/api/table_def/tickets.ticket/id_pattern', { id_pattern })
      }
    })
    await step('the user is authorized to triage the ticket', () => t.choose('Support'))
    await step('the user searches for "FT-1042"', async () => { queue = (await t.read('queue', { search: 'FT-1042' })).tickets })
    await step('the matching ticket is available', () => expect(queue.map(row => row.row_id)).toContain(t.ticket.row_id))
  })

  scenario('Assigned work excludes unrelated tickets', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    let assigned: Ticket, unrelated: Ticket, queue: Ticket[] = []
    await step('Anjali has an open access ticket assigned to the user', async () => {
      await t.access()
      await t.action('edit', { assigned_to: t.ids.Support }, 'Support')
      assigned = t.ticket
    })
    await step('another open report ticket is assigned to a colleague', async () => {
      await t.create('report', { format: 'Excel' }, 'A colleague report')
      await t.action('edit', { assigned_to: t.ids.Bala }, 'Support')
      unrelated = t.ticket
      t.ticket = assigned
    })
    await step('the user requests their open access work', async () => {
      queue = (await t.read('queue', { kind: 'access', state: 'Needs verification', assigned_to: t.ids.Support })).tickets
    })
    await step("Anjali's ticket is included and the colleague's report ticket is excluded", () => {
      const ids = queue.map(row => row.row_id)
      expect(ids).toContain(assigned.row_id)
      expect(ids).not.toContain(unrelated.row_id)
    })
  })

  scenario('Internal investigation is not disclosed to the requester', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Anjali has an access ticket with public progress and a support-only note', () => t.progress())
    await step('the user is signed in as Anjali', () => t.choose('Anjali'))
    await step('the user reads their ticket', () => t.open())
    await step('the public progress is available and the support-only note is not disclosed', () => publicPrivacy(t, true))
  })

  scenario('A colleague can follow public progress', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    let view: any
    await step('Anjali has an access ticket with public progress and private employee-verification evidence', () => t.progress(true))
    await step('the user is another requester without support permissions', () => t.choose('Colleague'))
    await step("the user finds Anjali's ticket in the shared queue", async () => {
      const queue: Ticket[] = (await t.read('queue')).tickets
      expect(queue.map(row => row.row_id)).toContain(t.ticket.row_id)
      view = await t.open()
    })
    await step('its summary and public progress are available', () => {
      expect(view.ticket.row_id).toBe(t.ticket.row_id)
      expect(JSON.stringify(view)).toContain('Support is checking this request')
    })
    await step('the original request details and employee-verification evidence are not disclosed', () => publicPrivacy(t))
  })

  scenario('A colleague cannot change the request', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Anjali has an access ticket visible in the shared queue', () => t.access())
    await step('the user is another requester without support permissions', () => t.choose('Colleague'))
    await step("the user attempts to change Anjali's requested scope", () =>
      t.action('edit', { details: { ...t.details, scope: 'Bronze' } }, t.actor, true))
    await step('the edit is refused and the requested scope is unchanged', async () => {
      t.denied()
      expect(await t.text('Anjali')).toContain('Gold sales, read only')
    })
  })
})
