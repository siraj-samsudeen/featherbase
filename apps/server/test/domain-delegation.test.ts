import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { registerApp, installApp, suspendRuntimeApp } from '../src/apps'
import { expectApiError, tableRef } from './fixtures'
import { saveSystemRow } from '../src/document'
import { sql } from '../src/db'

describe('bounded delegation', () => {
  test('job appointments cannot confer unbounded access-admin authority', async ({ admin, createUser }) => {
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Staffing' } })
    const meera = await createUser({ roles: ['Staffing'] })
    const arun = await createUser({ roles: [] })
    registerApp({ name: 'jobproof',
      administration: { version: 1, targets: { 'jobproof.appointment': { person: 'person' }, 'jobproof.employee': { person: 'person' } },
        memberships: { table: 'jobproof.appointment', person: 'person', startsOn: 'starts_on', endsOn: 'ends_on',
          dimensions: { store: ['store'] } },
        jobs: { column: 'job', capabilities: [
          { job: 'manager', role: 'Job Contact Admin', dimensions: ['store'] },
          { job: 'manager', role: 'Job Access Admin', dimensions: ['store'] },
          { job: 'reviewer', role: 'Job Contact Reviewer', dimensions: ['store'] },
        ] } },
      tables: [
        { name: 'jobproof.employee', id_pattern: 'prompt', columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'phone', column_type: 'Data' },
        ] },
        { name: 'jobproof.appointment', id_pattern: 'prompt', columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'store', column_type: 'Data' }, { column_name: 'job', column_type: 'Data' },
          { column_name: 'starts_on', column_type: 'Date' }, { column_name: 'ends_on', column_type: 'Date' },
        ] },
      ], roles: ['Job Contact Admin', 'Job Access Admin', 'Job Contact Reviewer', 'Staffing'],
      permissions: [
        { table: 'jobproof.employee', role: 'Job Contact Admin', operations: { read: ['phone'], update: ['phone'] } },
        { table: 'jobproof.employee', role: 'Job Contact Reviewer', operations: { approve: ['phone'] } },
        { table: 'jobproof.appointment', role: 'Staffing', operations: {
          read: ['person', 'store', 'job', 'starts_on', 'ends_on'],
          create: ['person', 'store', 'job', 'starts_on', 'ends_on'], update: ['job', 'ends_on'], delete: true,
        } },
      ], fixtures: [
        { table: 'jobproof.employee', rows: [{ row_id: 'arun', person: arun.user, phone: 'original' }] },
        { table: 'jobproof.appointment', rows: [
          { row_id: 'meera', person: meera.user, store: 'A', job: 'manager' },
          { row_id: 'arun', person: arun.user, store: 'A', job: 'worker' },
        ] },
      ],
    })
    await installApp('jobproof')
    try {
      const scope = await saveSystemRow('Scope', { app: 'jobproof', mode: 'named', tuples: [{ store: 'A' }] }, 'bootstrap')
      const authority = await saveSystemRow('Authority', { app: 'jobproof', scope: scope.row_id,
        holder_role: 'Job Access Admin', office_job: 'manager', enabled: true }, 'bootstrap')
      await saveSystemRow('Delegation Boundary', { app: 'jobproof', authority: authority.row_id,
        required_role: 'Job Access Admin', action: 'grant', target_role: 'Job Contact Admin',
        max_scope: scope.row_id, recipient_scope: scope.row_id }, 'bootstrap')
      const contact = tableRef('jobproof.employee').rowUrl('arun')
      expect(await meera.get(contact)).toMatchObject({ phone: 'original' })
      await sql`update installed_app set enabled = false where name = 'jobproof'`
      const disabled = await meera.get<{ capabilities: { tables: string[] } }>('/api/whoami')
      expect(disabled.capabilities.tables).not.toContain('jobproof.employee')
      await sql`update installed_app set enabled = true where name = 'jobproof'`
      await meera.post('/api/administration/grant', { app: 'jobproof', person: arun.user,
        role: 'Job Contact Admin', scope: scope.row_id })
      const appointments = tableRef('jobproof.appointment')
      const arunRow = await meera.get<Record<string, unknown>>(appointments.rowUrl('arun'))
      await expectApiError(meera.post('/api/save_row', { table: appointments.name,
        row: { ...arunRow, job: 'manager' } }), { status: 403 })
      expect(await meera.get(appointments.rowUrl('arun'))).toMatchObject({ job: 'worker' })
      await expectApiError(meera.post('/api/save_row', { table: appointments.name,
        row: { row_id: 'acting', person: arun.user, job: 'manager', store: 'A', starts_on: '2999-01-01' } }), { status: 403 })
      const own = await meera.get<Record<string, unknown>>(appointments.rowUrl('meera'))
      await expectApiError(meera.post('/api/save_row', { table: appointments.name,
        row: { ...own, ends_on: '2000-01-01' } }), { status: 403 })
      expect(await meera.get(appointments.rowUrl('meera'))).toMatchObject({ ends_on: null })
      // Grant-only cannot end an appointment. Once the two revoke boundaries
      // exist, shortening its authorised period needs no grant authority.
      for (const role of ['Job Contact Admin', 'Job Access Admin'])
        await saveSystemRow('Delegation Boundary', { app: 'jobproof', authority: authority.row_id,
          required_role: 'Job Access Admin', action: 'revoke', target_role: role,
          max_scope: scope.row_id, recipient_scope: scope.row_id }, 'bootstrap')
      await meera.post('/api/save_row', { table: appointments.name, row: { ...own, ends_on: '2999-01-01' } })
      const shortened = await meera.get<Record<string, unknown>>(appointments.rowUrl('meera'))
      expect(shortened).toMatchObject({ ends_on: '2999-01-01T00:00:00.000Z' })
      // Removing the old powers is authorised, but a replacement also adds
      // reviewer power. Both checks must pass before either change persists.
      await expectApiError(meera.post('/api/save_row', { table: appointments.name,
        row: { ...shortened, job: 'reviewer' } }), { status: 403 })
      expect(await meera.get(appointments.rowUrl('meera'))).toMatchObject({
        job: 'manager', ends_on: '2999-01-01T00:00:00.000Z', updated_at: shortened.updated_at,
      })
      // Revoke authority permits shortening, never restoring an open-ended
      // appointment that confers Access Admin without its grant boundary.
      await expectApiError(meera.post('/api/save_row', { table: appointments.name,
        row: { ...shortened, ends_on: null } }), { status: 403 })
      expect(await meera.get(appointments.rowUrl('meera'))).toMatchObject({ ends_on: shortened.ends_on })
      await meera.post('/api/save_row', { table: appointments.name, row: { ...shortened, ends_on: '2000-01-01' } })
      await expectApiError(meera.get(contact), { status: 403 })
    } finally { suspendRuntimeApp('jobproof') }
  })

  test.for(['independent actions', 'descendant provenance', 'shared role edits'] as const)('%s retain scoped authority', async (scenario, { admin, createUser }) => {
    const meera = await createUser({ roles: [] })
    const arun = await createUser({ roles: [] })
    const ravi = await createUser({ roles: [] })
    registerApp({ name: 'delegationproof',
      administration: { version: 1, targets: { 'delegationproof.employee': { person: 'person' } },
        memberships: { table: 'delegationproof.membership', person: 'person',
          dimensions: { store: ['store'] } } },
      tables: [
        { name: 'delegationproof.employee', id_pattern: 'prompt', columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'phone', column_type: 'Data' },
        ] },
        { name: 'delegationproof.membership', id_pattern: 'prompt', columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'store', column_type: 'Data' },
        ] },
      ], roles: ['Contact Admin', 'Contact Access Admin'],
      permissions: [{ table: 'delegationproof.employee', role: 'Contact Admin', operations: { read: ['phone'], update: ['phone'] } }],
      fixtures: [
        { table: 'delegationproof.employee', rows: [{ row_id: 'arun', person: arun.user, phone: 'original' }] },
        { table: 'delegationproof.membership', rows: [
          { row_id: 'meera', person: meera.user, store: 'A' },
          { row_id: 'arun', person: arun.user, store: 'A' },
          { row_id: 'ravi', person: ravi.user, store: 'A' },
        ] },
      ],
    })
    await installApp('delegationproof')
    try {
      const scope = await saveSystemRow('Scope', { app: 'delegationproof', mode: 'named', tuples: [{ store: 'A' }] }, 'bootstrap')
      const outside = await saveSystemRow('Scope', { app: 'delegationproof', mode: 'named', tuples: [{ store: 'B' }] }, 'bootstrap')
      await saveSystemRow('Role Assignment', { app: 'delegationproof', person: meera.user,
        role: 'Contact Access Admin', scope: scope.row_id }, 'bootstrap')
      const authority = await saveSystemRow('Authority', { app: 'delegationproof', scope: scope.row_id,
        holder_role: 'Contact Access Admin', enabled: true }, 'bootstrap')
      const grant = await saveSystemRow('Delegation Boundary', { app: 'delegationproof', authority: authority.row_id,
        required_role: 'Contact Access Admin', action: 'grant', target_role: 'Contact Admin',
        max_scope: scope.row_id, recipient_scope: scope.row_id, allow_further_delegation: false }, 'bootstrap')
      const args = { app: 'delegationproof', person: arun.user, role: 'Contact Admin', scope: scope.row_id }
      const contact = tableRef('delegationproof.employee').rowUrl('arun')
      await expectApiError(arun.get(contact), { status: 403 })
      await expectApiError(meera.post('/api/administration/grant', {
        app: args.app, person: args.person, role: args.role,
      }), { status: 417 })
      await expectApiError(arun.get(contact), { status: 403 })
      await expectApiError(admin.post('/api/administration/grant', args), { status: 403 })
      await expectApiError(meera.post('/api/administration/grant', { ...args, scope: outside.row_id }), { status: 403 })
      await expectApiError(meera.post('/api/administration/grant', { ...args, allow_further_delegation: true }), { status: 403 })
      const assigned = await meera.post<{ row_id: string }>('/api/administration/grant', args)
      expect(await arun.get(contact)).toMatchObject({ phone: 'original' })
      expect((await sql`select grantor, authority, delegation_boundary from featherbase.role_assignment
        where row_id = ${assigned.row_id}`)[0]).toMatchObject({ grantor: meera.user,
        authority: authority.row_id, delegation_boundary: grant.row_id })
      if (scenario === 'shared role edits') {
        const [permission] = await sql`select row_id from featherbase.permission
          where ref_table = 'delegationproof.employee' and role = 'Contact Admin' and operation = 'read'`
        const current = await admin.get<Record<string, unknown>>(tableRef('Permission').rowUrl(String(permission.row_id)))
        await expectApiError(admin.post('/api/save_row', { table: 'Permission', row: { ...current, columns: [] } }), { status: 403 })
        expect(await arun.get(contact)).toMatchObject({ phone: 'original' })
        const person = await admin.get<Record<string, unknown>>(tableRef('Person').rowUrl(arun.user!))
        await expectApiError(admin.post('/api/save_row', { table: 'Person', row: { ...person, roles: [{ role: 'Contact Admin' }] } }), { status: 403 })
        await expectApiError(admin.post('/api/service_accounts', { label: 'contact-export', roles: ['Contact Admin'] }), { status: 403 })
        const service = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'empty-contact-export', roles: [] })
        await expectApiError(admin.post(`/api/service_accounts/${service.row_id}/roles`, { roles: ['Contact Admin'] }), { status: 403 })
        // Platform configuration access plus a real scoped revoke boundary
        // can narrow this shared role while all its holders are in Store A.
        await saveSystemRow('Role Assignment', { app: 'delegationproof', person: 'Administrator',
          role: 'Contact Access Admin', scope: scope.row_id }, 'bootstrap')
        await saveSystemRow('Delegation Boundary', { app: 'delegationproof', authority: authority.row_id,
          required_role: 'Contact Access Admin', action: 'revoke', target_role: 'Contact Admin',
          max_scope: scope.row_id, recipient_scope: scope.row_id }, 'bootstrap')
        await admin.post('/api/save_row', { table: 'Permission', row: { ...current, columns: [] } })
        expect(await arun.get(contact)).not.toHaveProperty('phone')
        return
      }
      await expectApiError(meera.post('/api/administration/revoke', { assignment: assigned.row_id }), { status: 403 })
      await saveSystemRow('Delegation Boundary', { app: 'delegationproof', authority: authority.row_id,
        required_role: 'Contact Access Admin', action: 'revoke', target_role: 'Contact Admin',
        max_scope: scope.row_id, recipient_scope: scope.row_id }, 'bootstrap')
      if (scenario === 'descendant provenance') {
        await expectApiError(arun.post('/api/administration/grant', { ...args, person: ravi.user,
          parent_assignment: assigned.row_id }), { status: 403 })
        await sql`update featherbase.delegation_boundary set allow_further_delegation = true where row_id = ${String(grant.row_id)}`
        const parent = await meera.post<{ row_id: string }>('/api/administration/grant', { ...args, allow_further_delegation: true })
        const child = await arun.post<{ row_id: string }>('/api/administration/grant', { ...args,
          person: ravi.user, parent_assignment: parent.row_id })
        expect(await ravi.get(contact)).toMatchObject({ phone: 'original' })
        await sql`update featherbase.role_assignment set parent_assignment = ${child.row_id} where row_id = ${child.row_id}`
        await expectApiError(ravi.get(contact), { status: 403 })
        await sql`update featherbase.role_assignment set parent_assignment = ${parent.row_id} where row_id = ${child.row_id}`
        expect(await ravi.get(contact)).toMatchObject({ phone: 'original' })
        await meera.post('/api/administration/revoke', { assignment: parent.row_id })
        // Arun's independent grant remains, but cannot replace the child's
        // recorded parent or keep that child's authority alive.
        expect(await arun.get(contact)).toMatchObject({ phone: 'original' })
        await expectApiError(ravi.get(contact), { status: 403 })
        return
      }
      await meera.post('/api/administration/revoke', { assignment: assigned.row_id })
      await expectApiError(arun.get(contact), { status: 403 })
      await sql`delete from featherbase.delegation_boundary where row_id = ${String(grant.row_id)}`
      await expectApiError(meera.post('/api/administration/grant', args), { status: 403 })
    } finally { suspendRuntimeApp('delegationproof') }
  })
})
