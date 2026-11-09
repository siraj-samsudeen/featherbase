// tickets-assignment-email (#1001), the fenced scenarios of
// openspec/specs/tickets-assignment-email/spec.md that Tickets' actions and
// the Email Queue prove, step by step. The ones on the ticket screen are in
// apps/web/test/scenarios/.
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { scenarioFor } from '../scenario'
import { pinning, Tickets, TicketsAssignmentEmail } from '../tickets-world'

const test = pgTest.extend(pinning)
const scenario = scenarioFor(test, 'tickets-assignment-email')
const RAISED = 'Anjali has raised a ticket that support can assign'

describe('tickets-assignment-email', () => {
  scenario('Assigning a ticket emails the assignee', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    await step(RAISED, () => x.raise())
    await step("support assigns Anjali's ticket to Colleague", () => x.assign('Colleague'))
    await step('Colleague is emailed once about the ticket', async () => expect(await x.t.mailTo('Colleague')).toHaveLength(1))
  })

  scenario('Reassigning emails only the new assignee', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    await step(RAISED, () => x.raise())
    await step("support has assigned Anjali's ticket to Colleague", () => x.assign('Colleague'))
    await step("support reassigns Anjali's ticket to Verifier", () => x.assign('Verifier'))
    await step('Verifier is emailed once about the ticket', async () => expect(await x.t.mailTo('Verifier')).toHaveLength(1))
    await step('Colleague is emailed once about the ticket', async () => expect(await x.t.mailTo('Colleague')).toHaveLength(1))
  })

  scenario('Creating a ticket sends nothing', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    await step(RAISED, () => x.raise())
    await step('nobody is emailed about the ticket', async () => expect(await x.t.mail()).toEqual([]))
  })

  scenario('Assigning yourself sends nothing', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    await step(RAISED, () => x.raise())
    await step("support assigns Anjali's ticket to themselves", () => x.assign('Support'))
    await step('nobody is emailed about the ticket', async () => {
      expect((await x.t.open('Support')).ticket.assigned_to).toBe(x.t.ids.Support)
      expect(await x.t.mail()).toEqual([])
    })
  })

  scenario("A private ticket's assignee gets its description", async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    await step(RAISED, () => x.raise())
    await step("support assigns Anjali's ticket to Colleague", () => x.assign('Colleague'))
    await step('the email to Colleague names the ticket, who assigned it and a link to it', async () => {
      const [{ body }] = await x.t.mailTo('Colleague')
      expect(body).toContain(x.title)
      expect(body).toContain('assigned this ticket to you.')
      expect(body).toContain(`/tickets/?ticket=${x.t.ticket.row_id}`)
    })
    await step('the email to Colleague includes the description', async () => expect((await x.t.mailTo('Colleague'))[0]!.body).toContain(x.description))
  })

  scenario('Someone who may read the description gets it', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    await step(RAISED, () => x.raise())
    await step("support assigns Anjali's ticket to Verifier", () => x.assign('Verifier'))
    await step('the email to Verifier includes the description', async () => expect((await x.t.mailTo('Verifier'))[0]!.body).toContain(x.description))
  })
})
