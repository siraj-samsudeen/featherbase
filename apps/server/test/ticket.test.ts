// The ticketing system, tested through feather-testing-postgres: every test
// runs in its own rolled-back transaction against the REAL save lifecycle,
// permission engine, and workflow engine.

import { describe, expect } from 'vitest'
import { test } from './pg-test'

describe('Ticket: naming series + sandbox isolation', () => {
  test('a new ticket gets the next TICK- number', async ({ seed }) => {
    const doc = await seed('Ticket', { title: 'Repro: sandbox numbering' })
    expect(doc.name).toBe('TICK-0006')
    expect(doc.workflow_state ?? 'Open').toBe('Open')
  })

  test('the SAME number again — the previous test rolled back its series increment', async ({
    seed,
  }) => {
    const doc = await seed('Ticket', { title: 'Repro: sandbox numbering 2' })
    expect(doc.name).toBe('TICK-0006')
  })

  test('missing required title is a field-wise 417', async ({ seed }) => {
    await expect(seed('Ticket', { priority: 'High' })).rejects.toMatchObject({
      status: 417,
      type: 'ValidationError',
    })
  })
})

describe('Ticket Comment: child table round-trip', () => {
  test('comments save and load with the parent', async ({ seed, admin }) => {
    const doc = await seed('Ticket', {
      title: 'With discussion',
      comments: [
        { comment: 'Confirmed against the SAP export.' },
        { comment: 'Fix deployed to staging.' },
      ],
    })
    const loaded = await admin.get<{ comments: { comment: string; parent: string }[] }>(
      `/api/doc/Ticket/${doc.name}`,
    )
    expect(loaded.comments).toHaveLength(2)
    expect(loaded.comments[0].comment).toBe('Confirmed against the SAP export.')
    expect(loaded.comments[0].parent).toBe(doc.name)
  })
})

describe('Ticket permissions: reporters see only their own', () => {
  test('if_owner scoping on list and read', async ({ createUser, admin }) => {
    const alice = await createUser({ roles: ['Ticket Reporter'] })
    const bob = await createUser({ roles: ['Ticket Reporter'] })

    const mine = await alice.post<{ name: string }>('/api/save_doc', {
      doctype: 'Ticket',
      doc: { title: "Alice's mart discrepancy" },
    })
    await bob.post('/api/save_doc', {
      doctype: 'Ticket',
      doc: { title: "Bob's refresh failure" },
    })

    // Alice lists only her own ticket — not Bob's, not the 5 seeds.
    const list = await alice.get<{ data: { name: string }[] }>('/api/resource/Ticket')
    expect(list.data.map((d) => d.name)).toEqual([mine.name])

    // Reading Bob's ticket directly is forbidden.
    const bobList = await bob.get<{ data: { name: string }[] }>('/api/resource/Ticket')
    await expect(alice.get(`/api/doc/Ticket/${bobList.data[0].name}`)).rejects.toMatchObject({
      status: 403,
    })

    // A manager (and Administrator) sees everything: 5 seeds + 2 new.
    const all = await admin.get<{ data: unknown[]; total: number }>('/api/resource/Ticket')
    expect(Number(all.total)).toBe(7)
  })

  test('a user with no ticketing role cannot even create', async ({ client }) => {
    await expect(
      client.post('/api/save_doc', { doctype: 'Ticket', doc: { title: 'nope' } }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('Ticket workflow: Open → In Progress → Resolved → Closed', () => {
  test('the full lifecycle, with the resolution-required condition enforced', async ({
    admin,
    createUser,
    seed,
  }) => {
    const manager = await createUser({ roles: ['Ticket Manager'] })
    const doc = await seed('Ticket', { title: 'Lifecycle under test' })

    await manager.post('/api/apply_workflow_action', {
      doctype: 'Ticket',
      name: doc.name,
      action: 'Start Progress',
    })

    // Resolving without a resolution violates the transition condition.
    await expect(
      manager.post('/api/apply_workflow_action', {
        doctype: 'Ticket',
        name: doc.name,
        action: 'Resolve',
      }),
    ).rejects.toMatchObject({ status: 417 })

    // Fill the resolution (carry the fresh modified stamp), then resolve.
    const current = await admin.get<{ modified: string }>(`/api/doc/Ticket/${doc.name}`)
    await admin.post('/api/save_doc', {
      doctype: 'Ticket',
      doc: {
        name: doc.name,
        title: 'Lifecycle under test',
        resolution: 'Month filter fixed to include the last day.',
        modified: current.modified,
      },
    })
    await manager.post('/api/apply_workflow_action', {
      doctype: 'Ticket',
      name: doc.name,
      action: 'Resolve',
    })
    await manager.post('/api/apply_workflow_action', {
      doctype: 'Ticket',
      name: doc.name,
      action: 'Close',
    })

    const closed = await admin.get<{ workflow_state: string }>(`/api/doc/Ticket/${doc.name}`)
    expect(closed.workflow_state).toBe('Closed')
  })

  test('a reporter cannot drive transitions (role-gated)', async ({ createUser }) => {
    const reporter = await createUser({ roles: ['Ticket Reporter'] })
    const doc = await reporter.post<{ name: string }>('/api/save_doc', {
      doctype: 'Ticket',
      doc: { title: 'Reporter cannot triage' },
    })
    await expect(
      reporter.post('/api/apply_workflow_action', {
        doctype: 'Ticket',
        name: doc.name,
        action: 'Start Progress',
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
