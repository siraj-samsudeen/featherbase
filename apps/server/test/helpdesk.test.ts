// The HD Ticket helpdesk (migration 0051), tested through
// feather-testing-postgres: every test runs in its own rolled-back
// transaction against the REAL save lifecycle, permission engine, SLA
// stamping, server-script defaults, email rules, web form, and the workflow
// bound to the `status` field. Tests create their own documents — nothing
// here relies on demo content (scripts/seed-helpdesk.ts), which is opt-in.

import { describe, expect } from 'vitest'
import { test } from './pg-test'

const num = (name: unknown) => Number(String(name).slice('HDT-'.length))

describe('HD Ticket: naming series + defaults', () => {
  test('new tickets get sequential HDT- numbers and open on the status field', async ({
    seed,
  }) => {
    const a = await seed('HD Ticket', { subject: 'Cannot log in to portal' })
    const b = await seed('HD Ticket', { subject: 'Invoice PDF is blank' })
    expect(String(a.name)).toMatch(/^HDT-\d{5}$/)
    expect(num(b.name)).toBe(num(a.name) + 1)
    expect(a.status).toBe('Open')
  })

  test('missing required subject is a field-wise 417', async ({ seed }) => {
    await expect(seed('HD Ticket', { priority: 'High' })).rejects.toMatchObject({
      status: 417,
      type: 'ValidationError',
    })
  })

  test('the server script defaults raised_by to the creating user', async ({ createUser }) => {
    const agent = await createUser({ roles: ['Support Agent'] })
    const doc = await agent.post<{ raised_by: string }>('/api/save_doc', {
      doctype: 'HD Ticket',
      doc: { subject: 'Filed without raised_by' },
    })
    expect(doc.raised_by).toBe(agent.user)
  })
})

describe('HD Ticket: SLA deadlines stamped on insert', () => {
  test('per-priority resolution window, starting On Track', async ({ seed }) => {
    const doc = await seed('HD Ticket', { subject: 'Server room is on fire', priority: 'Urgent' })
    expect(doc.sla_status).toBe('On Track')
    expect(doc.response_by).not.toBeNull()
    expect(doc.resolution_by).not.toBeNull()
    const hours =
      (Number(new Date(String(doc.resolution_by))) - Number(new Date(String(doc.creation)))) /
      3600e3
    expect(Math.abs(hours - 4)).toBeLessThan(0.1) // Urgent resolves in 4h
  })
})

describe('HD Ticket permissions: customers see only their own', () => {
  test('if_owner scoping on list and read', async ({ createUser, admin }) => {
    const carl = await createUser({ roles: ['Customer'] })
    const gina = await createUser({ roles: ['Customer'] })

    // Customers file through the public web form (their DocPerm grants
    // if_owner read + create, not write — direct field edits are the desk
    // roles' job).
    const mine = await carl.post<{ name: string }>('/api/web_form/new-ticket', {
      values: { subject: "Carl's login problem" },
    })
    const theirs = await gina.post<{ name: string }>('/api/web_form/new-ticket', {
      values: { subject: "Gina's invoice problem" },
    })

    const list = await carl.get<{ data: { name: string }[] }>('/api/resource/HD%20Ticket')
    expect(list.data.map((d) => d.name)).toEqual([mine.name])
    await expect(carl.get(`/api/doc/HD%20Ticket/${theirs.name}`)).rejects.toMatchObject({
      status: 403,
    })

    // Admin sees both (filter to this test's rows — the dev database may
    // carry committed demo tickets).
    const all = await admin.get<{ data: { name: string }[] }>(
      `/api/resource/HD%20Ticket?filters=${encodeURIComponent(
        JSON.stringify([['name', 'in', [mine.name, theirs.name]]]),
      )}`,
    )
    expect(all.data).toHaveLength(2)
  })

  test('a user with no helpdesk role cannot create', async ({ client }) => {
    await expect(
      client.post('/api/save_doc', { doctype: 'HD Ticket', doc: { subject: 'nope' } }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('HD Ticket workflow: Open → In Progress → Resolved → Closed on the status field', () => {
  test('the full lifecycle: role gates, the resolution-details condition, and save-protection', async ({
    admin,
    createUser,
  }) => {
    const agent = await createUser({ roles: ['Support Agent'] })
    const manager = await createUser({ roles: ['Support Manager'] })
    const customer = await createUser({ roles: ['Customer'] })

    const doc = await customer.post<{ name: string }>('/api/web_form/new-ticket', {
      values: { subject: 'Lifecycle under test' },
    })

    // From Open the agent sees exactly one action.
    const open = await agent.get<{ actions: { action: string }[] }>(
      `/api/workflow/HD%20Ticket/${doc.name}`,
    )
    expect(open.actions.map((a) => a.action)).toEqual(['Start'])

    await agent.post('/api/apply_workflow_action', {
      doctype: 'HD Ticket',
      name: doc.name,
      action: 'Start',
    })

    // Resolving without resolution_details violates the transition condition.
    await expect(
      agent.post('/api/apply_workflow_action', {
        doctype: 'HD Ticket',
        name: doc.name,
        action: 'Resolve',
      }),
    ).rejects.toMatchObject({ status: 417 })

    const current = await admin.get<{ modified: string }>(`/api/doc/HD%20Ticket/${doc.name}`)
    await agent.put(`/api/resource/HD%20Ticket/${doc.name}`, {
      modified: current.modified,
      resolution_details: 'Password reset + MFA re-enrolled.',
    })
    await agent.post('/api/apply_workflow_action', {
      doctype: 'HD Ticket',
      name: doc.name,
      action: 'Resolve',
    })

    // The bound status field is save-protected: a direct edit is refused.
    const resolved = await admin.get<{ status: string; modified: string }>(
      `/api/doc/HD%20Ticket/${doc.name}`,
    )
    expect(resolved.status).toBe('Resolved')
    await expect(
      agent.put(`/api/resource/HD%20Ticket/${doc.name}`, {
        modified: resolved.modified,
        status: 'Closed',
      }),
    ).rejects.toMatchObject({ status: 417 })

    // Close is manager-only; from Resolved the customer may only Reopen.
    await expect(
      agent.post('/api/apply_workflow_action', {
        doctype: 'HD Ticket',
        name: doc.name,
        action: 'Close',
      }),
    ).rejects.toMatchObject({ status: 403 })
    const custActions = await customer.get<{ actions: { action: string }[] }>(
      `/api/workflow/HD%20Ticket/${doc.name}`,
    )
    expect(custActions.actions.map((a) => a.action)).toEqual(['Reopen'])

    await manager.post('/api/apply_workflow_action', {
      doctype: 'HD Ticket',
      name: doc.name,
      action: 'Close',
    })
    const closed = await admin.get<{ status: string }>(`/api/doc/HD%20Ticket/${doc.name}`)
    expect(closed.status).toBe('Closed')
  })

  test('resolving queues the notification email to the requester', async ({
    admin,
    createUser,
  }) => {
    const agent = await createUser({ roles: ['Support Agent'] })
    const customer = await createUser({ roles: ['Customer'] })
    const filed = await customer.post<{ name: string }>('/api/web_form/new-ticket', {
      values: { subject: 'Notify me when fixed' },
    })
    const doc = await admin.get<{ name: string; raised_by: string }>(
      `/api/doc/HD%20Ticket/${filed.name}`,
    )
    expect(doc.raised_by).toBe(customer.user)

    await agent.post('/api/apply_workflow_action', {
      doctype: 'HD Ticket',
      name: doc.name,
      action: 'Start',
    })
    const current = await admin.get<{ modified: string }>(`/api/doc/HD%20Ticket/${doc.name}`)
    await agent.put(`/api/resource/HD%20Ticket/${doc.name}`, {
      modified: current.modified,
      resolution_details: 'Cache cleared.',
    })
    await agent.post('/api/apply_workflow_action', {
      doctype: 'HD Ticket',
      name: doc.name,
      action: 'Resolve',
    })

    // The queue stores the raw template — rendering happens at delivery
    // time, in the email job. (A workflow "Approval required" notification
    // rides the same queue, hence contains rather than equals.)
    const queued = await admin.get<{ data: { recipient: string; subject: string }[] }>(
      `/api/resource/${encodeURIComponent('Email Queue')}?fields=${encodeURIComponent(
        JSON.stringify(['recipient', 'subject']),
      )}&filters=${encodeURIComponent(JSON.stringify([['reference_name', '=', doc.name]]))}`,
    )
    expect(queued.data).toContainEqual({
      recipient: customer.user,
      subject: 'Your ticket {{ doc.name }} has been resolved',
    })
  })
})

describe('HD Ticket web form: public intake with owner attribution', () => {
  test('a logged-in customer files through /form/new-ticket and owns the result', async ({
    createUser,
    admin,
  }) => {
    const customer = await createUser({ roles: ['Customer'] })
    const filed = await customer.post<{ name: string }>('/api/web_form/new-ticket', {
      values: {
        subject: 'Filed from the public form',
        description: 'Details here',
        priority: 'High',
      },
    })
    const doc = await admin.get<{ owner: string; raised_by: string; status: string }>(
      `/api/doc/HD%20Ticket/${filed.name}`,
    )
    expect(doc.owner).toBe(customer.user)
    expect(doc.raised_by).toBe(customer.user)
    expect(doc.status).toBe('Open')
  })
})
