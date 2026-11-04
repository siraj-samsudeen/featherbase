import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { registerApp, installApp, suspendRuntimeApp } from '../src/apps'
import { expectApiError, tableRef } from './fixtures'
import { saveSystemRow } from '../src/document'
import { sql } from '../src/db'
import { onEvent, type RealtimeEvent } from '../src/realtime'

describe('held domain corrections', () => {
  test.for(['create', 'delete', 'amend'] as const)('%s waits for its scoped approval', async (action, { createUser }) => {
    const operation = action === 'amend' ? 'create' : action
    const target = action === 'amend' ? 'contact-1' : 'contact'
    const maker = await createUser({ roles: [] })
    const reviewer = await createUser({ roles: [] })
    const table = 'approvalproof.contact'
    registerApp({ name: 'approvalproof', administration: { version: 1, targets: { [table]: { person: 'person' } },
      memberships: { table: 'approvalproof.membership', person: 'person', dimensions: { store: ['store'] } },
      approvals: [{ id: 'lifecycle', table, operation, columns: ['person', 'phone', ...(action === 'amend' ? ['amended_from'] : [])], outcome: 'approval', approverRole: 'Lifecycle Reviewer' }] },
      tables: [{ name: table, id_pattern: 'prompt', is_submittable: action === 'amend', columns: [
        { column_name: 'person', column_type: 'Reference', reference_table: 'Person' }, { column_name: 'phone', column_type: 'Data' },
      ] }, { name: 'approvalproof.membership', id_pattern: 'prompt', columns: [
        { column_name: 'person', column_type: 'Reference', reference_table: 'Person' }, { column_name: 'store', column_type: 'Data' },
      ] }], roles: ['Lifecycle Maker', 'Lifecycle Reviewer'], permissions: [
        { table, role: 'Lifecycle Maker', operations: { read: '*', amend: true, ...(operation === 'create' ? { create: '*' as const } : { delete: true }) } },
        { table, role: 'Lifecycle Reviewer', operations: { approve: '*' } },
      ], fixtures: [{ table: 'approvalproof.membership', rows: [{ row_id: 'membership', person: maker.user, store: 'A' }] },
        ...(action !== 'create' ? [{ table, rows: [{ row_id: 'contact', person: maker.user, phone: 'original' }] }] : [])],
    })
    await installApp('approvalproof')
    try {
      const scope = await saveSystemRow('Scope', { app: 'approvalproof', mode: 'named', tuples: [{ store: 'A' }] }, 'bootstrap')
      for (const [person, role] of [[maker.user, 'Lifecycle Maker'], [reviewer.user, 'Lifecycle Reviewer']])
        await saveSystemRow('Role Assignment', { app: 'approvalproof', person, role, scope: scope.row_id }, 'bootstrap')
      const url = `/api/table/${table}`
      const current = operation === 'delete' ? await maker.get<Record<string, unknown>>(`${url}/contact`) : undefined
      if (action === 'amend') await sql`update approvalproof.contact set status = 'cancelled' where row_id = 'contact'`
      const response = action === 'amend' ? await maker.fetch(`${url}/contact:amend`, { method: 'POST', body: '{}' })
        : operation === 'create' ? await maker.fetch(url, { method: 'POST',
        body: JSON.stringify({ row_id: 'contact', person: maker.user, phone: 'original' }) })
        : await maker.fetch(`${url}/contact?updated_at=${encodeURIComponent(String(current!.updated_at))}`, { method: 'DELETE' })
      expect(response.status).toBe(202)
      const held = await response.json() as { proposal: string; version: number }
      expect((await sql`select count(*)::int as n from approvalproof.contact where row_id = ${target}`)[0].n).toBe(operation === 'create' ? 0 : 1)
      const decision = { ...held, decision: 'approve' }
      expect(await reviewer.post('/api/administration/review', { proposal: decision.proposal, version: decision.version, decision: decision.decision }))
        .toMatchObject({ outcome: 'applied' })
      expect((await sql`select count(*)::int as n from approvalproof.contact where row_id = ${target}`)[0].n).toBe(operation === 'create' ? 1 : 0)
      const history = await sql`select data from featherbase.version where ref_table = ${table} and ref_name = ${target}`
      expect(history).toHaveLength(1)
      expect(history[0].data).toMatchObject({ approval: { proposal: held.proposal, operation,
        maker: maker.user, reviewers: [reviewer.user] },
        changed: expect.arrayContaining([['phone', operation === 'create' ? null : 'original', operation === 'create' ? 'original' : null]]) })
    } finally { suspendRuntimeApp('approvalproof') }
  })

  test.for(['approval', 'uninstalled candidate', 'self service', 'mandatory', 'alternative', 'private second review', 'rejection', 'conflict', 'already corrected', 'revoked maker', 'disabled maker', 'wrong authority scope', 'changed hook', 'erased hook', 'after hook', 'bulk', 'import', 'import revert', 'patch'] as const)('%s preserves the reviewed correction', async (scenario, { createUser }) => {
    const maker = await createUser({ roles: [] })
    const reviewer = await createUser({ roles: [], email: 'reviewer@approval.example' })
    const secondReviewer = ['mandatory', 'alternative', 'private second review'].includes(scenario) ? await createUser({ roles: [] }) : undefined
    const employee = tableRef('approvalproof.employee')
    let substitute = false
    registerApp({ name: 'approvalproof',
      administration: { version: 1, targets: { [employee.name]: { person: 'person' } },
        memberships: { table: 'approvalproof.membership', person: 'person', dimensions: { store: ['store'] } },
        approvals: [{ id: 'phone-correction', table: employee.name, operation: 'update', columns: ['phone'],
          outcome: 'approval', approverRole: 'Contact Reviewer',
          ...(scenario === 'self service' ? { maker: { self: false } } : {}),
          ...(scenario === 'alternative' ? { alternativeGroup: 'either' } : {}),
          ...(scenario === 'wrong authority scope' ? { authorityRole: 'Contact Office' } : {}) },
          ...(scenario === 'self service' ? [{ id: 'own-contact', table: employee.name, operation: 'update' as const,
            columns: ['phone'], maker: { self: true, role: 'Contact Maker' }, outcome: 'apply_and_log' as const }] : []),
          ...(secondReviewer ? [{ id: 'second-review', table: employee.name, operation: 'update' as const, columns: [scenario === 'private second review' ? 'emergency_contact' : 'phone'],
            outcome: 'approval' as const, approverRole: 'Second Reviewer',
            ...(scenario === 'alternative' ? { alternativeGroup: 'either' } : {}) },
          { id: 'log-rule', table: employee.name, operation: 'update' as const, columns: ['phone'], outcome: 'apply_and_log' as const }] : [])] },
      tables: [
        { name: employee.name, id_pattern: 'prompt', track_changes: true, columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'phone', column_type: 'Data' },
          { column_name: 'emergency_contact', column_type: 'Data' },
        ] },
        { name: 'approvalproof.membership', id_pattern: 'prompt', columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'store', column_type: 'Data' },
        ] },
      ], roles: ['Contact Maker', 'Contact Reviewer', 'Contact Office', 'Second Reviewer'],
      permissions: [
        { table: employee.name, role: 'Contact Maker', operations: { read: ['phone', 'emergency_contact'], update: ['phone', 'emergency_contact'] } },
        { table: employee.name, role: 'Contact Reviewer', operations: { read: ['phone'], approve: ['phone'] } },
        { table: employee.name, role: 'Second Reviewer', operations: { read: ['phone', 'emergency_contact'], approve: ['phone', 'emergency_contact'] } },
      ], doc_events: { [employee.name]: {
        before_save(ctx) { if (substitute && scenario !== 'after hook') ctx.row.phone = scenario === 'erased hook' ? 'original' : 'substituted' },
        async after_save(ctx) {
          if (substitute && scenario === 'after hook') await ctx.tx`update approvalproof.employee set phone = 'substituted' where row_id = ${String(ctx.row.row_id)}`
        },
      } },
      fixtures: [
        { table: employee.name, rows: [{ row_id: 'contact', person: maker.user, phone: 'original' },
          { row_id: 'outside', person: reviewer.user, phone: 'outside-original' }] },
        { table: 'approvalproof.membership', rows: [{ row_id: 'membership', person: maker.user, store: 'A' },
          { row_id: 'outside-membership', person: reviewer.user, store: 'B' }] },
      ],
    })
    await installApp('approvalproof')
    if (scenario === 'uninstalled candidate') registerApp({ name: 'approvalproof', tables: [] })
    const events: RealtimeEvent[] = []
    const stop = onEvent(event => { if (event.channel === `row:${employee.name}:contact`) events.push(event) })
    try {
      const scope = await saveSystemRow('Scope', { app: 'approvalproof', mode: 'named', tuples: [{ store: 'A' }] }, 'bootstrap')
      const assignment = await saveSystemRow('Role Assignment', { app: 'approvalproof', person: maker.user,
        role: 'Contact Maker', scope: scope.row_id }, 'bootstrap')
      for (const person of [maker.user, reviewer.user]) await saveSystemRow('Role Assignment', { app: 'approvalproof', person,
        role: 'Contact Reviewer', scope: scope.row_id }, 'bootstrap')
      if (secondReviewer) await saveSystemRow('Role Assignment', { app: 'approvalproof', person: secondReviewer.user,
        role: 'Second Reviewer', scope: scope.row_id }, 'bootstrap')
      if (scenario === 'wrong authority scope') {
        const outside = await saveSystemRow('Scope', { app: 'approvalproof', mode: 'named', tuples: [{ store: 'B' }] }, 'bootstrap')
        await saveSystemRow('Authority', { app: 'approvalproof', scope: scope.row_id, holder_role: 'Contact Office', enabled: true }, 'bootstrap')
        await saveSystemRow('Role Assignment', { app: 'approvalproof', person: reviewer.user, role: 'Contact Office', scope: outside.row_id }, 'bootstrap')
      }
      const current = await maker.get<Record<string, unknown>>(employee.rowUrl('contact'))
      await expectApiError(reviewer.post('/api/save_row', { table: employee.name,
        row: { row_id: 'contact', updated_at: current.updated_at, phone: 'direct-edit' } }), { status: 403 })
      if (scenario === 'import revert') {
        const version = await saveSystemRow('Version', { ref_table: employee.name, ref_name: 'contact',
          data: { changed: [['phone', 'before-import', 'original']] } }, 'bootstrap')
        const log = await saveSystemRow('Import Log', { ref_table: employee.name, run_id: 'held-revert',
          touched: [{ row_id: 'contact', action: 'updated', stamp: current.updated_at, version: version.row_id }] }, 'bootstrap')
        expect(await maker.post(`${employee.url}:import-revert`, { run_id: 'held-revert' })).toMatchObject({
          restored: 0, deleted: 0, failed: [], pending: [{ outcome: 'pending_approval' }],
        })
        expect(await maker.get(employee.rowUrl('contact'))).toMatchObject({ phone: 'original' })
        expect((await sql`select reverted_at from featherbase.import_log where row_id = ${String(log.row_id)}`)[0].reverted_at).toBeNull()
        return
      }
      if (scenario === 'bulk' || scenario === 'import') {
        const result = scenario === 'bulk'
          ? await maker.post<Record<string, unknown>>(`${employee.url}:bulk-edit`, {
            rows: ['contact', 'outside'], values: { phone: 'bulk-correction' },
          })
          : await maker.post<Record<string, unknown>>(`${employee.url}:import`, {
            key_column: 'row_id', rows: [{ row_id: 'contact', phone: 'import-correction' }, { row_id: 'outside', phone: 'forbidden' }],
          })
        expect(result).toMatchObject({ ...(scenario === 'bulk' ? { changed: 0 } : { updated: 0, inserted: 0 }), outcomes: [
          { row_id: 'contact', outcome: 'pending_approval' }, { row_id: 'outside', outcome: 'rejected' },
        ] })
        expect(await maker.get(employee.rowUrl('contact'))).toMatchObject({ phone: 'original' })
        expect((await sql`select phone from approvalproof.employee where row_id = 'outside'`)[0].phone).toBe('outside-original')
        expect((await sql`select count(*)::int as n from featherbase.proposal where maker = ${maker.user}`)[0].n).toBe(1)
        expect((await sql`select count(*)::int as n from featherbase.import_source where ref_table = ${employee.name}`)[0].n).toBe(0)
        return
      }
      const response = scenario === 'patch' ? await maker.fetch(employee.rowUrl('contact'), { method: 'PATCH',
        body: JSON.stringify({ updated_at: current.updated_at, phone: 'corrected' }) }) : undefined
      if (response) expect(response.status).toBe(202)
      const held: { outcome: string; proposal: string; version: number } = response ? await response.json() : await maker.post('/api/save_row', {
        table: employee.name, row: { row_id: 'contact', updated_at: current.updated_at, phone: 'corrected',
          ...(scenario === 'private second review' ? { emergency_contact: 'private-proposed' } : {}) },
      })
      if (scenario === 'self service') {
        expect(held).toMatchObject({ phone: 'corrected' })
        expect(await maker.get(employee.rowUrl('contact'))).toMatchObject({ phone: 'corrected' })
        expect(await sql`select state from featherbase.proposal where maker = ${maker.user}`).toEqual([{ state: 'applied' }])
        const [logged] = await sql`select row_id from featherbase.proposal where maker = ${maker.user}`
        const [history] = await sql`select data from featherbase.version where ref_table = ${employee.name} and ref_name = 'contact'`
        expect(history.data).toMatchObject({ approval: { proposal: logged.row_id, maker: maker.user, reviewers: [] } })
        return
      }
      expect(held).toMatchObject({ outcome: 'pending_approval', version: 1 })
      expect(await maker.get(employee.rowUrl('contact'))).toMatchObject({ phone: 'original', updated_at: current.updated_at })
      expect((await sql`select count(*)::int as n from featherbase.version where ref_table = ${employee.name}`)[0].n).toBe(0)
      if (scenario === 'approval') {
        expect(events).toEqual([])
        expect(await sql`select recipient from featherbase.email_queue where ref_table = ${employee.name} and reference_name = 'contact'`)
          .toEqual([{ recipient: 'reviewer@approval.example' }])
        expect(await reviewer.get(`/api/administration/proposals?table=${employee.name}`)).toMatchObject({ data: [{
          proposal: held.proposal, version: 1, row_id: 'contact',
          changes: [{ column: 'phone', original: 'original', current: 'original', proposed: 'corrected' }],
        }] })
        const stranger = await createUser({ roles: [] })
        expect(await stranger.get(`/api/administration/proposals?table=${employee.name}`)).toEqual({ data: [] })
      }
      const decision = { proposal: held.proposal, version: held.version, decision: 'approve' }
      await expectApiError(maker.post('/api/administration/review', decision), { status: 403 })
      if (scenario === 'private second review') {
        await sql`update approvalproof.employee set emergency_contact = 'private-current' where row_id = 'contact'`
        const result = await reviewer.post<{ changes: { column: string }[] }>('/api/administration/review', decision)
        expect(result.changes.map(change => change.column)).toEqual(['phone'])
        expect(JSON.stringify(result)).not.toContain('private-')
        return
      }
      if (scenario === 'rejection') {
        await expectApiError(reviewer.post('/api/administration/review', { ...decision, decision: 'reject' }), { status: 417 })
        expect(await reviewer.post('/api/administration/review', { ...decision, decision: 'reject', reason: 'Wrong number' }))
          .toMatchObject({ outcome: 'rejected' })
        expect(await maker.get(employee.rowUrl('contact'))).toMatchObject({ phone: 'original' })
        return
      }
      if (scenario === 'revoked maker' || scenario === 'disabled maker' || scenario === 'wrong authority scope') {
        if (scenario === 'revoked maker') await sql`update featherbase.role_assignment set revoked_at = now() where row_id = ${String(assignment.row_id)}`
        if (scenario === 'disabled maker') await sql`update featherbase.person set enabled = false where row_id = ${maker.user}`
        await expectApiError(reviewer.post('/api/administration/review', decision), { status: 403 })
        expect((await sql`select phone from approvalproof.employee where row_id = 'contact'`)[0].phone).toBe('original')
        if (scenario !== 'wrong authority scope')
          expect(await reviewer.post('/api/administration/review', { ...decision, decision: 'reject', reason: 'Access withdrawn' }))
            .toMatchObject({ outcome: 'rejected' })
        return
      }
      if (scenario === 'changed hook' || scenario === 'erased hook' || scenario === 'after hook') {
        substitute = true
        await expectApiError(reviewer.post('/api/administration/review', decision), { status: 409 })
        expect(await maker.get(employee.rowUrl('contact'))).toMatchObject({ phone: 'original' })
        return
      }
      if (scenario === 'conflict' || scenario === 'already corrected') {
        const newer = scenario === 'already corrected' ? 'corrected' : 'newer'
        await sql`update approvalproof.employee set phone = ${newer}, updated_at = clock_timestamp() where row_id = 'contact'`
        const conflict = await reviewer.post<Record<string, unknown>>('/api/administration/review', decision)
        expect(conflict).toMatchObject({ outcome: 'conflict', version: 2,
          changes: [{ column: 'phone', original: 'original', current: newer, proposed: 'corrected' }] })
        expect(await maker.get(employee.rowUrl('contact'))).toMatchObject({ phone: newer })
        await expectApiError(reviewer.post('/api/administration/review', decision), { status: 409 })
        decision.version = 2
      }
      if (scenario === 'mandatory') {
        expect(await reviewer.post('/api/administration/review', decision)).toMatchObject({ outcome: 'pending_approval' })
        expect(await maker.get(employee.rowUrl('contact'))).toMatchObject({ phone: 'original' })
        await expectApiError(reviewer.post('/api/administration/review', decision), { status: 409 })
        expect(await secondReviewer!.post('/api/administration/review', decision)).toMatchObject({ outcome: 'applied' })
      } else expect(await reviewer.post('/api/administration/review', decision)).toMatchObject({ outcome: 'applied' })
      expect(await maker.get(employee.rowUrl('contact'))).toMatchObject({ phone: 'corrected' })
      if (scenario === 'approval') expect(events).toEqual([{
        channel: `row:${employee.name}:contact`, event: 'updated', payload: { table: employee.name, row_id: 'contact' },
      }])
      await expectApiError(reviewer.post('/api/administration/review', decision), { status: 409 })
      const [history] = await sql`select data from featherbase.version where ref_table = ${employee.name} and ref_name = 'contact'`
      expect(history.data).toMatchObject({ approval: { proposal: held.proposal, maker: maker.user,
        reviewers: scenario === 'mandatory' ? [reviewer.user, secondReviewer!.user] : [reviewer.user] } })
    } finally { stop(); suspendRuntimeApp('approvalproof') }
  })
})
