// tickets-access-fulfillment (#810), each fenced scenario of
// openspec/changes/feather-tickets-stage-one/specs/tickets-access-fulfillment/spec.md
// step by step, against Tickets' own actions and reads. Competing decisions
// need two real transactions, so that scenario runs on committed rows.
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { committedTest } from '../pg-test-shared'
import { scenarioFor } from '../scenario'
import { pinning, Tickets } from '../tickets-world'

const test = pgTest.extend(pinning)
const realCommits = committedTest.extend(pinning)
const scenario = scenarioFor(test, 'tickets-access-fulfillment')
const routes = (t: Tickets) => t.configure({ approval_routes: { Kerala: [t.ids.Bala], Chennai: [t.ids.Karthik, t.ids.Shiva] } })

describe('tickets-access-fulfillment', () => {
  scenario('A verification admin records a supported match', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Anjali requests MotherDuck access for "anjali@example.com"', () => t.access('anjali@example.com'))
    await step('the user belongs to the configured verification admins', () => t.choose('Verifier'))
    await step('the user confirms active employment in Kerala with evidence "HR confirmation 2026-11-03"', () =>
      t.action('verify', { email: t.details.email, active: true, region: 'Kerala', evidence: 'HR confirmation 2026-11-03' }))
    await step('the ticket records the verified email, active employment and region', () => t.includes('anjali@example.com', 'Kerala', 'true'))
    await step('the verification identifies the user, time and evidence reference', async () => {
      await t.includes(t.ids.Verifier, 'HR confirmation 2026-11-03')
      expect(await t.text()).toMatch(/2026-\d\d-\d\dT/)
    })
  })

  scenario('An unsupported identity cannot advance', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step("Anjali's access request has unverified employment", () => t.access())
    await step('the user is the configured regional approver', () => t.choose('Bala'))
    await step('the user attempts approval', () => t.action('decide', { decision: 'approved' }, t.actor, true))
    await step('approval is refused and the request remains unapproved', async () => { t.denied(); await t.cannotFulfill() })
  })

  scenario('Inactive employment cannot advance', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step("Anjali's access request has verified inactive employment", async () => { await t.access(); await t.verified(false) })
    await step('the user is the configured regional approver', () => t.choose('Bala'))
    await step('the user attempts approval', () => t.action('decide', { decision: 'approved' }, t.actor, true))
    await step('approval is refused and the request remains unapproved', async () => { t.denied(); await t.cannotFulfill() })
  })

  scenario('A requester cannot verify themselves', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Anjali requests MotherDuck access for "anjali@example.com"', () => t.access('anjali@example.com'))
    await step('the user is signed in as Anjali without verification-admin membership', () => t.choose('Anjali'))
    await step('the user attempts to confirm active employment', () =>
      t.action('verify', { email: t.details.email, active: true, region: 'Kerala', evidence: 'Self assertion' }, t.actor, true))
    await step('verification is refused and employment remains unverified', async () => { t.denied(); await t.cannotApprove() })
  })

  scenario('Kerala approval goes to Bala', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step("Anjali's access request has verified active employment in Kerala", async () => { await t.access(); await t.verified() })
    await step('Kerala approval is configured for Bala', () => routes(t))
    await step('the user is signed in as Bala', () => t.choose('Bala'))
    await step('the user approves the request', () => t.action('decide', { decision: 'approved' }))
    await step("the ticket records Bala's approval of the current scope", () => t.includes(t.ids.Bala, 'Gold sales, read only', 'approved'))
  })

  scenario('An admin records actual manual completion', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Anjali\'s verified active request for "Gold sales, read only" is approved', () => t.approved('Gold sales, read only'))
    await step('the user belongs to the configured fulfillment admins', () => t.choose('Fulfiller'))
    await step('the user records manual fulfillment with reference "Admin confirmation 2026-11-03"', () =>
      t.action('fulfill', { reference: 'Admin confirmation 2026-11-03' }))
    await step('the ticket records who fulfilled that approved scope and when', async () => {
      await t.includes(t.ids.Fulfiller, 'Gold sales, read only', 'Admin confirmation 2026-11-03')
      expect(await t.text()).toMatch(/2026-\d\d-\d\dT/)
    })
    await step('the ticket is resolved without claiming an automated access grant', async () => {
      expect(t.ticket.ticket_state).toBe('Resolved')
      await t.excludes('"automated_grant":true')
    })
  })

  scenario('An approver is not automatically a fulfillment admin', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step("Anjali's verified active request is approved by Shiva", () => t.approved('Gold sales, read only', 'Chennai'))
    await step('the user is Shiva without fulfillment-admin membership', () => t.choose('Shiva'))
    await step('the user attempts to record fulfillment', () => t.action('fulfill', { reference: 'Not authorized' }, t.actor, true))
    await step('fulfillment is refused and the ticket remains unfulfilled', async () => { t.denied(); await t.unfulfilled() })
  })

  scenario('A scope edit requires a new approval', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Anjali\'s verified active request for "Gold sales, read only" is approved', () => t.approved('Gold sales, read only'))
    await step('the user is authorized to edit the request', () => t.choose('Support'))
    await step('the user changes the scope to "Silver SAP, read only"', () => t.changeDetails({ scope: 'Silver SAP, read only' }))
    await step('the previous approval no longer authorizes fulfillment', () => t.cannotFulfill())
    await step('both the old decision and scope change remain in history', () => t.includes(t.ids.Bala, 'Gold sales, read only', 'Silver SAP, read only'))
  })

  scenario('A new recipient cannot inherit verification', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Anjali\'s verified active request for "anjali@example.com" is approved', () => t.approved())
    await step('the user is authorized to edit the request', () => t.choose('Support'))
    await step('the user changes the recipient to "another@example.com"', () => t.changeDetails({ email: 'another@example.com' }))
    await step('the request needs new employment verification and approval before fulfillment', async () => {
      await t.cannotFulfill()
      await t.cannotApprove()
    })
  })

  scenario('A changed region uses the new route', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step("Anjali's Kerala request was approved by Bala", () => t.approved())
    await step('the user is a verification admin', () => t.choose('Verifier'))
    await step("the user corrects Anjali's verified region to Chennai", () =>
      t.action('verify', { email: t.details.email, active: true, region: 'Chennai', evidence: 'Corrected region evidence' }))
    await step('the request needs a new decision from its configured Chennai approvers before fulfillment', async () => {
      await t.cannotFulfill()
      await t.cannotApprove()
      await t.action('decide', { decision: 'approved' }, 'Shiva')
    })
  })

  scenario('Inactive employment cancels eligibility', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step("Anjali's verified active request is approved", () => t.approved())
    await step('the user is a verification admin', () => t.choose('Verifier'))
    await step('the user records that Anjali is now inactive', () =>
      t.action('verify', { email: t.details.email, active: false, region: 'Kerala', evidence: 'Inactive employment evidence' }))
    await step('the prior approval cannot authorize fulfillment', () => t.cannotFulfill())
    await step('the request is blocked by inactive employment', () => t.cannotApprove())
  })

  scenario('A ticket editor cannot supply a completed approval chain', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step("Anjali's access request is unverified and unapproved", () => t.access())
    await step('the user is authorized to edit ticket details but not verify, approve or fulfill access', () => t.choose('Support'))
    await step('the user attempts an ordinary edit claiming verified employment, approval and completed fulfillment', async () => {
      const request = await admin.get<Record<string, unknown>>(`/api/table/tickets.request/${t.ticket.row_id}`)
      t.last = await t.call(t.actor, '/api/save_row', { table: 'tickets.request', row: { ...request, verification_key: 'forged-verification', approval_key: 'forged-approval' } })
      t.denied()
      t.last = await t.call(t.actor, '/api/save_row', { table: 'tickets.ticket', row: { ...t.ticket, ticket_state: 'Resolved' } })
      t.denied()
      t.last = await t.call(t.actor, '/api/save_row', { table: 'tickets.event', row: {
        ticket: t.ticket.row_id, operation: 'verify', by: t.ids.Verifier, at: '2026-11-03T09:00:00Z',
        text: JSON.stringify({ email: t.details.email, active: true, region: 'Kerala', verification_key: request.verification_key }),
      } })
    })
    await step('the protected changes are refused and the request remains unverified, unapproved and unfulfilled', async () => {
      t.denied()
      await t.cannotFulfill()
      await t.cannotApprove()
    })
  })

  scenario('Bronze remains restricted despite regional approval authority', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Anjali requests "Bronze Zakya" access with verified active employment in Kerala', async () => {
      await t.access('anjali@example.com', 'Bronze Zakya')
      await t.verified()
    })
    await step('Bronze access is configured as restricted to warehouse admins', () => t.configure({ restricted_resources: ['Bronze'] }))
    await step('Anjali is not a warehouse admin', () => expect(t.roles.Anjali).toEqual(['All']))
    await step('the user is the configured Kerala approver', () => t.choose('Bala'))
    await step('the user attempts approval', () => t.action('decide', { decision: 'approved' }, t.actor, true))
    await step('the request remains in policy review and cannot be fulfilled', async () => {
      t.denied()
      expect(await t.text()).toMatch(/policy/i)
      await t.cannotFulfill()
    })
  })
})

// Two approvers deciding at once need two real transactions: committed rows.
describe('tickets-access-fulfillment, competing decisions', () => {
  const scenario = scenarioFor(realCommits, 'tickets-access-fulfillment')
  scenario('Either Chennai approver can decide', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step("Anjali's access request has verified active employment in Chennai", async () => { await t.access(); await t.verified(true, 'Chennai') })
    await step('Chennai approval is configured for Karthik or Shiva', () => routes(t))
    await step('the user is signed in as Shiva', () => t.choose('Shiva'))
    await step('the user approves the request', () => t.action('decide', { decision: 'approved' }))
    await step('the request is approved without waiting for Karthik', async () => {
      await t.includes(t.ids.Shiva, 'approved')
      await t.action('fulfill', { reference: 'One alternative approver is sufficient' }, 'Fulfiller')
      expect(t.ticket.ticket_state).toBe('Resolved')
      // Shiva and Karthik decide another request at the same moment: one wins.
      await t.access()
      await t.verified(true, 'Chennai')
      const revision = t.revision()
      const outcomes = await Promise.all([
        t.call('Shiva', '/api/app_actions/tickets/decide', { idempotencyKey: randomUUID(), payload: { ...revision, decision: 'approved' } }),
        t.call('Karthik', '/api/app_actions/tickets/decide', { idempotencyKey: randomUUID(), payload: { ...revision, decision: 'rejected', reason: 'Conflicting decision' } }),
      ])
      expect(outcomes.filter(result => result.status === 200)).toHaveLength(1)
      expect(outcomes.filter(result => [409, 417].includes(result.status))).toHaveLength(1)
      const winner = outcomes.find(result => result.status === 200)!.body.result.ticket
      const saved = await t.open('Support')
      expect(saved.ticket.ticket_state).toBe(winner.ticket_state)
      expect(saved.privateEvents.filter((event: { operation: string }) => event.operation === 'decide')).toHaveLength(1)
    })
  }, 60_000)
})
