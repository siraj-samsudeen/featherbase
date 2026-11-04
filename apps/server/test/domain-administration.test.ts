import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { registerApp, installApp, suspendRuntimeApp } from '../src/apps'
import { expectApiError, grantRole, makeTable, tableRef } from './fixtures'
import { eventVisibleTo } from '../src/realtime'
import { getMeta } from '../src/meta'
import { saveSystemRow } from '../src/document'
import { sql } from '../src/db'
import { provisionApp } from '../src/app-lifecycle'

const employee = tableRef('contactproof.employee')

describe('domain administration', () => {
  test.for(['store', 'section', 'after hook', 'raw assignment', 'rename', 'lifecycle'] as const)('%s grants constrain organisational mappings without a Person target', async (dimension, { admin, createUser }) => {
    const manager = await createUser({ roles: [] })
    const mapping = tableRef('orgproof.mapping')
    registerApp({ name: 'orgproof',
      administration: { version: 1, targets: { [mapping.name]: { dimensions: { store: ['section.store'], section: ['section'] } } },
        memberships: { table: 'orgproof.membership', person: 'person', dimensions: {} } },
      tables: [
        { name: 'orgproof.membership', columns: [{ column_name: 'person', column_type: 'Reference', reference_table: 'Person' }] },
        { name: 'orgproof.section', id_pattern: 'prompt', columns: [{ column_name: 'store', column_type: 'Data' }] },
        { name: mapping.name, id_pattern: 'prompt', is_submittable: true, decides_scope: dimension === 'lifecycle', columns: [
          { column_name: 'section', column_type: 'Reference', reference_table: 'orgproof.section' },
          { column_name: 'subcategory', column_type: 'Data' },
        ] },
      ], roles: ['Mapping Manager'], permissions: [{ table: mapping.name, role: 'Mapping Manager',
        operations: { read: '*', create: '*', update: '*', delete: true, submit: true, cancel: true, amend: true } }],
      doc_events: { [mapping.name]: { async after_save(ctx) {
        if (ctx.row.subcategory === 'redirect') await ctx.tx`update orgproof.mapping set section = 'B1' where row_id = ${String(ctx.row.row_id)}`
      } } }, fixtures: [
        { table: 'orgproof.section', rows: [{ row_id: 'A1', store: 'A' }, { row_id: 'A2', store: 'A' }, { row_id: 'B1', store: 'B' }] },
        { table: mapping.name, rows: ['A1', 'A2', 'B1'].map(section => ({ row_id: section, section, subcategory: `category-${section}` })) },
      ],
    })
    await installApp('orgproof')
    try {
      const scope = await saveSystemRow('Scope', { app: 'orgproof', mode: 'named',
        tuples: [dimension === 'store' ? { store: 'A' } : { store: 'A', section: 'A1' }] }, 'bootstrap')
      await saveSystemRow('Role Assignment', { app: 'orgproof', person: manager.user, role: 'Mapping Manager', scope: scope.row_id }, 'bootstrap')
      if (dimension === 'store') {
        const identity = await manager.get<{ roles: string[]; capabilities: { tables: string[]; creatable: string[] } }>('/api/whoami')
        expect(identity.capabilities.tables).toContain(mapping.name)
        expect(identity.capabilities.creatable).toContain(mapping.name)
        expect(identity.roles).not.toContain('Mapping Manager')
      }
      const rows = await manager.get<{ data: { row_id: string }[] }>(mapping.listUrl({ fields: ['row_id'] }))
      expect(rows.data.map(row => row.row_id).sort()).toEqual(dimension === 'store' ? ['A1', 'A2'] : ['A1'])
      await expectApiError(manager.get(mapping.rowUrl('B1')), { status: 403 })
      const current = await manager.get<Record<string, unknown>>(mapping.rowUrl('A1'))
      if (dimension === 'lifecycle') {
        await expectApiError(manager.post(`${mapping.rowUrl('B1')}:submit`, {}), { status: 403 })
        expect(await manager.post(`${mapping.rowUrl('A1')}:submit`, {})).toMatchObject({ status: 'submitted' })
        expect(await manager.post(`${mapping.rowUrl('A1')}:cancel`, {})).toMatchObject({ status: 'cancelled' })
        expect(await manager.post(`${mapping.rowUrl('A1')}:amend`, {})).toMatchObject({ status: 'draft', section: 'A1' })
        return
      }
      if (dimension === 'raw assignment') {
        await expectApiError(admin.post('/api/save_row', { table: 'Assignment Rule', row: {
          row_id: 'unsafe-rule', ref_table: mapping.name, assign_to_field: 'subcategory',
        } }), { status: 417 })
        return
      }
      if (dimension === 'rename') {
        await expectApiError(manager.post(`${mapping.rowUrl('A1')}:rename`, { new_name: 'changed-id' }), { status: 403 })
        expect(await manager.get(mapping.rowUrl('A1'))).toMatchObject({ section: 'A1' })
        return
      }
      if (dimension === 'after hook') {
        await expectApiError(manager.post('/api/save_row', { table: mapping.name,
          row: { row_id: 'A1', updated_at: current.updated_at, subcategory: 'redirect' } }), { status: 409 })
        expect((await sql`select section, subcategory from orgproof.mapping where row_id = 'A1'`)[0])
          .toEqual({ section: 'A1', subcategory: 'category-A1' })
        return
      }
      await expectApiError(manager.post('/api/save_row', { table: mapping.name,
        row: { row_id: 'A1', updated_at: current.updated_at, section: 'B1' } }), { status: 403 })
      const transfer = () => manager.post('/api/save_row', { table: mapping.name,
        row: { row_id: 'A1', updated_at: current.updated_at, section: 'A2' } })
      if (dimension === 'store') expect(await transfer()).toMatchObject({ section: 'A2' })
      else await expectApiError(transfer(), { status: 403 })
      await expectApiError(manager.post('/api/save_row', { table: mapping.name,
        row: { row_id: 'outside', section: 'B1', subcategory: 'forbidden' } }), { status: 403 })
      const created = await manager.post<Record<string, unknown>>('/api/save_row', { table: mapping.name,
        row: { row_id: 'new', section: 'A1', subcategory: 'allowed' } })
      expect(created).toMatchObject({ section: 'A1', subcategory: 'allowed' })
      const removed = await manager.fetch(`${mapping.rowUrl('new')}?updated_at=${encodeURIComponent(String(created.updated_at))}`, { method: 'DELETE' })
      expect(removed.ok).toBe(true)
      expect(await sql`select row_id from orgproof.mapping where row_id in ('new', 'outside')`).toEqual([])
      expect((await sql`select subcategory from orgproof.mapping where row_id = 'B1'`)[0].subcategory).toBe('category-B1')
    } finally { suspendRuntimeApp('orgproof') }
  })

  test('staffing scope follows the appointment rather than another membership of its person', async ({ createUser }) => {
    const user = await createUser({ roles: [] })
    const member = tableRef('contactproof.membership')
    registerApp({ name: 'contactproof',
      administration: { version: 1, targets: { [member.name]: { person: 'person' } },
        memberships: { table: member.name, person: 'person', dimensions: { store: ['store'] } } },
      tables: [{ name: member.name, id_pattern: 'prompt', columns: [
        { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
        { column_name: 'store', column_type: 'Data' },
      ] }], roles: ['Scoped Staffing'], permissions: [{ table: member.name, role: 'Scoped Staffing',
        operations: { read: '*', update: '*', create: '*' } }], fixtures: [{ table: member.name, rows: [
        { row_id: 'inside', person: user.user, store: 'A' }, { row_id: 'outside', person: user.user, store: 'B' },
      ] }],
    })
    await installApp('contactproof')
    try {
      const scope = await saveSystemRow('Scope', { app: 'contactproof', mode: 'named', tuples: [{ store: 'A' }] }, 'bootstrap')
      await saveSystemRow('Role Assignment', { app: 'contactproof', person: user.user, role: 'Scoped Staffing', scope: scope.row_id }, 'bootstrap')
      expect(await user.get(member.listUrl({ fields: ['row_id', 'store'] }))).toMatchObject({ data: [{ row_id: 'inside', store: 'A' }], total: 1 })
      await expectApiError(user.get(member.rowUrl('outside')), { status: 403 })
      const current = await user.get<Record<string, unknown>>(member.rowUrl('inside'))
      await expectApiError(user.post('/api/save_row', { table: member.name,
        row: { row_id: 'inside', updated_at: current.updated_at, store: 'B' } }), { status: 403 })
      await expectApiError(user.post('/api/save_row', { table: member.name,
        row: { row_id: 'forbidden', person: user.user, store: 'B' } }), { status: 403 })
      expect(await user.post('/api/save_row', { table: member.name,
        row: { row_id: 'allowed', person: user.user, store: 'A' } })).toMatchObject({ store: 'A' })
    } finally { suspendRuntimeApp('contactproof') }
  })

  test('derived dimensions refuse ambiguous or dangling membership facts', async ({ createUser }) => {
    const reader = await createUser({ roles: [] })
    registerApp({ name: 'contactproof',
      administration: { version: 1, targets: { [employee.name]: { person: 'person' } },
        memberships: { table: 'contactproof.membership', person: 'person',
          dimensions: { store: ['store', 'section.store'] } } },
      tables: [
        { name: employee.name, id_pattern: 'prompt', columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'phone', column_type: 'Data' },
        ] },
        { name: 'contactproof.section', id_pattern: 'prompt', columns: [{ column_name: 'store', column_type: 'Data' }] },
        { name: 'contactproof.membership', id_pattern: 'prompt', columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'store', column_type: 'Data' },
          { column_name: 'section', column_type: 'Reference', reference_table: 'contactproof.section' },
        ] },
      ], roles: ['Derived Contact Reader'],
      permissions: [{ table: employee.name, role: 'Derived Contact Reader', operations: { read: ['phone'] } }],
      fixtures: [
        { table: employee.name, rows: [{ row_id: 'contact', person: reader.user, phone: 'visible' }] },
        { table: 'contactproof.section', rows: [{ row_id: 'section', store: 'A' }] },
        { table: 'contactproof.membership', rows: [{ row_id: 'membership', person: reader.user, section: 'section' }] },
      ],
    })
    await installApp('contactproof')
    try {
      const scope = await saveSystemRow('Scope', { app: 'contactproof', mode: 'named', tuples: [{ store: 'A' }] }, 'provisioning')
      await saveSystemRow('Role Assignment', { app: 'contactproof', person: reader.user,
        role: 'Derived Contact Reader', scope: scope.row_id }, 'provisioning')
      expect(await reader.get(employee.rowUrl('contact'))).toMatchObject({ phone: 'visible' })
      await sql`update contactproof.membership set store = 'B' where row_id = 'membership'`
      await expectApiError(reader.get(employee.rowUrl('contact')), { status: 403 })
      expect(await reader.get(employee.listUrl({ fields: ['phone'] }))).toMatchObject({ total: 0 })
      await sql`update contactproof.membership set store = 'A', section = 'missing' where row_id = 'membership'`
      await expectApiError(reader.get(employee.rowUrl('contact')), { status: 403 })
      await sql`update contactproof.membership set section = null where row_id = 'membership'`
      expect(await reader.get(employee.rowUrl('contact'))).toMatchObject({ phone: 'visible' })
    } finally { suspendRuntimeApp('contactproof') }
  })

  test.for(['contactproof.membership', 'Person'])('reporting subtrees through %s follow only current acyclic appointments', async (reportingTable, { createUser }) => {
    const holder = await createUser({ roles: [] })
    const leader = await createUser({ roles: [] })
    const worker = await createUser({ roles: [] })
    const ended = await createUser({ roles: [] })
    const future = await createUser({ roles: [] })
    const parent = (name: 'holder' | 'leader' | 'worker') => reportingTable === 'Person' ? { holder, leader, worker }[name].user : name
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
    registerApp({ name: 'contactproof',
      administration: { version: 1, targets: { [employee.name]: { person: 'person' } },
        memberships: { table: 'contactproof.membership', person: 'person', reportsTo: 'reports_to',
          startsOn: 'starts_on', endsOn: 'ends_on', dimensions: {} } },
      tables: [
        { name: employee.name, id_pattern: 'prompt', columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'phone', column_type: 'Data' },
        ] },
        { name: 'contactproof.membership', id_pattern: 'prompt', columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'reports_to', column_type: 'Reference', reference_table: reportingTable },
          { column_name: 'starts_on', column_type: 'Date' }, { column_name: 'ends_on', column_type: 'Date' },
        ] },
      ], roles: ['Subtree Reader'],
      permissions: [{ table: employee.name, role: 'Subtree Reader', operations: { read: ['phone'] } }],
      fixtures: [
        { table: employee.name, rows: Object.entries({ holder, leader, worker, ended, future }).map(([row_id, person]) =>
          ({ row_id, person: person.user, phone: row_id })) },
        { table: 'contactproof.membership', rows: [
          { row_id: 'holder', person: holder.user },
          { row_id: 'leader', person: leader.user, reports_to: parent('holder'), starts_on: today },
          { row_id: 'worker', person: worker.user, reports_to: parent('leader') },
          { row_id: 'ended', person: ended.user, reports_to: parent('holder'), ends_on: today },
          { row_id: 'future', person: future.user, reports_to: parent('holder'), starts_on: '2999-01-01' },
        ] },
      ],
    })
    await installApp('contactproof')
    try {
      const scope = await saveSystemRow('Scope', { app: 'contactproof', mode: 'subtree' }, 'provisioning')
      const assignment = await saveSystemRow('Role Assignment', { app: 'contactproof', person: holder.user,
        role: 'Subtree Reader', scope: scope.row_id, starts_on: today }, 'provisioning')
      const listing = employee.listUrl({ fields: ['row_id'], order_by: 'row_id asc' })
      expect(await holder.get(listing)).toMatchObject({ total: 2, data: [{ row_id: 'leader' }, { row_id: 'worker' }] })
      for (const id of ['holder', 'ended', 'future']) await expectApiError(holder.get(employee.rowUrl(id)), { status: 403 })
      // Legacy corrupt facts cannot turn a recursive scope into all access.
      await sql`update contactproof.membership set reports_to = ${parent('worker')} where row_id = 'holder'`
      expect(await holder.get(listing)).toMatchObject({ total: 0, data: [] })
      await sql`update contactproof.membership set reports_to = null where row_id = 'holder'`
      expect(await holder.get(employee.rowUrl('worker'))).toMatchObject({ phone: 'worker' })
      if (reportingTable === 'Person') {
        await sql`insert into contactproof.membership (row_id, person) values ('second-office', ${holder.user})`
        expect(await holder.get(listing)).toMatchObject({ total: 0, data: [] })
        await sql`delete from contactproof.membership where row_id = 'second-office'`
      }
      // Expiry is automatic and end-exclusive, including the assignment itself.
      await sql`update featherbase.role_assignment set starts_on = '2000-01-01', ends_on = ${today}
        where row_id = ${String(assignment.row_id)}`
      await expectApiError(holder.get(employee.rowUrl('worker')), { status: 403 })
    } finally { suspendRuntimeApp('contactproof') }
  })

  test.for(['named', 'self', 'direct_reports'] as const)('%s assignments retain their complete scope', async (mode, { admin, createUser }) => {
    const reader = await createUser({ roles: [] })
    const priya = mode === 'self' ? reader : await createUser({ roles: [] })
    const ravi = await createUser({ roles: [] })
    registerApp({
      name: 'contactproof',
      administration: { version: 1, targets: { [employee.name]: { person: 'person' } },
        memberships: { table: 'contactproof.membership', person: 'person', reportsTo: 'reports_to',
          dimensions: { store: ['store'], department: ['department'] } } },
      tables: [
        { name: employee.name, id_pattern: 'prompt', columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'phone', column_type: 'Data' },
        ] },
        { name: 'contactproof.membership', id_pattern: 'prompt', columns: [
          { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
          { column_name: 'store', column_type: 'Data' },
          { column_name: 'department', column_type: 'Data' },
          { column_name: 'reports_to', column_type: 'Reference', reference_table: 'contactproof.membership' },
        ] },
      ],
      roles: ['Scoped Contact Reader', 'Contact Directory'],
      permissions: [{ table: employee.name, role: 'Scoped Contact Reader', operations: {
        read: ['phone'], create: ['phone', 'person'], update: ['phone', 'person'],
      } }, { table: employee.name, role: 'Contact Directory', operations: { read: ['person'] } }],
      fixtures: [
        { table: employee.name, rows: [
          { row_id: 'priya', person: priya.user, phone: 'permitted' },
          { row_id: 'ravi', person: ravi.user, phone: 'private' },
        ] },
        { table: 'contactproof.membership', rows: [
          { row_id: 'reader-office', person: reader.user, store: 'A', department: 'Office' },
          { row_id: 'priya-a', person: priya.user, store: 'A', department: 'Homeware', reports_to: 'reader-office' },
          { row_id: 'priya-b', person: priya.user, store: 'B', department: 'Clothing' },
          { row_id: 'ravi-a', person: ravi.user, store: 'A', department: 'Clothing', reports_to: 'priya-a' },
          { row_id: 'ravi-b', person: ravi.user, store: 'B', department: 'Homeware' },
        ] },
      ],
    })
    await installApp('contactproof')
    try {
      const scope = await saveSystemRow('Scope', { app: 'contactproof', mode,
        tuples: mode === 'named' ? [{ store: 'A', department: 'Homeware' }, { store: 'B', department: 'Clothing' }] : null }, 'provisioning')
      await saveSystemRow('Role Assignment', { app: 'contactproof', person: reader.user,
        role: 'Scoped Contact Reader', scope: scope.row_id }, 'provisioning')
      expect(await reader.get(employee.rowUrl('priya'))).toMatchObject({ phone: 'permitted' })
      await expectApiError(reader.get(employee.rowUrl('ravi')), { status: 403 })
      expect(await reader.get(employee.listUrl({ fields: ['row_id', 'phone'] })))
        .toMatchObject({ total: 1, data: [{ row_id: 'priya', phone: 'permitted' }] })
      if (mode === 'named') {
        await sql`update contactproof.membership set reports_to = null where row_id = 'priya-a'`
        expect(await reader.get(employee.rowUrl('priya'))).toMatchObject({ phone: 'permitted' })
        const directoryReader = await provisionApp('contactproof', () => createUser({ roles: ['Contact Directory'] }))
        await saveSystemRow('Role Assignment', { app: 'contactproof', person: directoryReader.user,
          role: 'Scoped Contact Reader', scope: scope.row_id }, 'provisioning')
        expect(await directoryReader.get(employee.listUrl({ fields: ['row_id', 'phone'], order_by: 'phone asc' })))
          .toMatchObject({ total: 2, data: [{ row_id: 'priya', phone: 'permitted' }, { row_id: 'ravi', phone: null }] })
        expect(await directoryReader.get(employee.rowUrl('ravi'))).not.toHaveProperty('phone')
        expect(await directoryReader.get(employee.listUrl({ fields: ['row_id'], filters: [['phone', '=', 'private']] })))
          .toMatchObject({ total: 0, data: [] })
      }
      const current = await reader.get<Record<string, unknown>>(employee.rowUrl('priya'))
      const changed = await reader.post<Record<string, unknown>>('/api/save_row', { table: employee.name,
        row: { row_id: 'priya', updated_at: current.updated_at, phone: 'corrected' } })
      expect(changed).toMatchObject({ phone: 'corrected' })
      await expectApiError(reader.post('/api/save_row', { table: employee.name,
        row: { row_id: 'priya', updated_at: changed.updated_at, person: ravi.user, phone: 'must-roll-back' },
      }), { status: 403 })
      expect(await reader.get(employee.rowUrl('priya'))).toMatchObject({ phone: 'corrected' })
      expect(await reader.post('/api/save_row', { table: employee.name,
        row: { row_id: 'new-priya', person: priya.user, phone: 'created-in-scope' },
      })).toMatchObject({ phone: 'created-in-scope' })
      await expectApiError(reader.post('/api/save_row', { table: employee.name,
        row: { row_id: 'new-ravi', person: ravi.user, phone: 'forbidden' },
      }), { status: 403 })
      // A second contribution can cover Ravi without authorizing a transfer
      // between the two independent responsibilities.
      const otherScope = await saveSystemRow('Scope', { app: 'contactproof', mode: 'named',
        tuples: [{ store: 'A', department: 'Clothing' }] }, 'provisioning')
      await saveSystemRow('Role Assignment', { app: 'contactproof', person: reader.user,
        role: 'Scoped Contact Reader', scope: otherScope.row_id }, 'provisioning')
      expect(await reader.get(employee.rowUrl('ravi'))).toMatchObject({ phone: 'private' })
      await expectApiError(reader.post('/api/save_row', { table: employee.name,
        row: { row_id: 'priya', updated_at: changed.updated_at, person: ravi.user, phone: 'must-roll-back' },
      }), { status: 403 })
      expect(await reader.get(employee.rowUrl('priya'))).toMatchObject({ phone: 'corrected' })
      await expectApiError(admin.post('/api/save_row', { table: 'Role Assignment', row: {
        app: 'contactproof', person: reader.user, role: 'Scoped Contact Reader', scope: scope.row_id,
      } }), { status: 403 })
      if (mode === 'named') {
        await sql`update featherbase.scope set tuples = '[]'::jsonb where row_id = ${String(scope.row_id)}`
        await expectApiError(reader.get(employee.rowUrl('priya')), { status: 403 })
        await expectApiError(reader.post('/api/save_row', { table: employee.name,
          row: { row_id: 'priya', updated_at: changed.updated_at, phone: 'empty-scope-must-not-save' },
        }), { status: 403 })
        expect((await sql`select phone from contactproof.employee where row_id = 'priya'`)[0].phone).toBe('corrected')
      }
    } finally { suspendRuntimeApp('contactproof') }
  })

  test('creating reading and updating use independent column selections', async ({ admin, createUser }) => {
    const contacts = await makeTable(admin, {
      name: 'Independent Contact',
      columns: ['name', 'employee_number', 'phone', 'emergency_contact'],
    })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Independent Contact Maintainer' } })
    const meta = await getMeta(contacts.name)
    for (const [operation, columns] of [
      ['create', ['name', 'employee_number', 'phone']],
      ['read', ['name', 'employee_number']],
      ['update', ['phone']],
    ] as const) {
      await admin.post('/api/save_row', { table: 'Permission', row: {
        ref_table: contacts.name, role: 'Independent Contact Maintainer', operation, scope_mode: 'all',
        columns: columns.map((name) => ({ target_column: meta.columns.find((column) => column.column_name === name)!.row_id })),
      } })
    }
    const maintainer = await createUser({ roles: ['Independent Contact Maintainer'] })
    const created = await maintainer.post<Record<string, unknown>>('/api/save_row', {
      table: contacts.name, row: { name: 'Priya', employee_number: 'DEMO-003', phone: 'original' },
    })
    expect(created).toMatchObject({ name: 'Priya', employee_number: 'DEMO-003' })
    expect(created).not.toHaveProperty('phone')
    const url = contacts.rowUrl(String(created.row_id))
    const changed = await maintainer.post<Record<string, unknown>>('/api/save_row', {
      table: contacts.name, row: { row_id: created.row_id, updated_at: created.updated_at, phone: 'corrected' },
    })
    expect(await admin.get(url)).toMatchObject({ phone: 'corrected' })
    expect(await maintainer.get(url)).not.toHaveProperty('phone')
    await expectApiError(maintainer.get(contacts.listUrl({ fields: ['phone'] })), { status: 417 })
    await expectApiError(maintainer.post('/api/save_row', {
      table: contacts.name,
      row: { row_id: created.row_id, updated_at: changed.updated_at, phone: 'partial', employee_number: 'FORBIDDEN' },
    }), { status: 403 })
    expect(await admin.get(url)).toMatchObject({ phone: 'corrected', employee_number: 'DEMO-003' })
    await expectApiError(maintainer.post('/api/save_row', {
      table: contacts.name, row: { name: 'Ravi', emergency_contact: 'ungranted' },
    }), { status: 403 })
    expect(await admin.get(contacts.listUrl({}))).toMatchObject({ total: 1 })
  })

  test('a creator-only Column grant never borrows another grants unrestricted Row scope', async ({ admin, createUser }) => {
    const contacts = await makeTable(admin, { name: 'Mixed Scope Contact', track_changes: true, columns: ['name', 'phone'] })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Mixed Contact Reader' } })
    const meta = await getMeta(contacts.name)
    for (const [operation, scope_mode, names] of [
      ['create', 'all', ['name', 'phone']],
      ['read', 'all', ['name']],
      ['read', 'creator', ['phone']],
      ['update', 'all', ['name']],
      ['update', 'creator', ['phone']],
    ] as const) {
      await admin.post('/api/save_row', { table: 'Permission', row: {
        ref_table: contacts.name, role: 'Mixed Contact Reader', operation, scope_mode,
        columns: names.map((name) => ({ target_column: meta.columns.find((column) => column.column_name === name)!.row_id })),
      } })
    }
    const reader = await createUser({ roles: ['Mixed Contact Reader'] })
    const own = await reader.post<{ row_id: string }>('/api/save_row', {
      table: contacts.name, row: { name: 'Own', phone: '999-own' },
    })
    const other = await admin.post<{ row_id: string }>('/api/save_row', {
      table: contacts.name, row: { name: 'Other', phone: '111-secret' },
    })
    const before = await admin.get<Record<string, unknown>>(contacts.rowUrl(other.row_id))
    await expectApiError(reader.post('/api/save_row', { table: contacts.name,
      row: { row_id: other.row_id, updated_at: before.updated_at, phone: 'must-not-borrow-name-scope' },
    }), { status: 403 })
    expect(await admin.get(contacts.rowUrl(other.row_id))).toMatchObject({ phone: '111-secret', updated_at: before.updated_at })
    expect(await reader.get(contacts.rowUrl(other.row_id))).not.toHaveProperty('phone')
    expect(await reader.get(contacts.listUrl({ fields: ['row_id', 'name', 'phone'], order_by: 'name asc' })))
      .toMatchObject({ total: 2, data: [
        { row_id: other.row_id, name: 'Other', phone: null },
        { row_id: own.row_id, name: 'Own', phone: '999-own' },
      ] })
    expect(await reader.get(contacts.listUrl({ filters: [['phone', '=', '111-secret']] })))
      .toMatchObject({ total: 0, data: [] })
    expect(await reader.get(contacts.listUrl({ fields: ['row_id'], order_by: 'phone asc' })))
      .toMatchObject({ data: [{ row_id: own.row_id }, { row_id: other.row_id }] })
    await grantRole(admin, { table: 'Version', role: 'Mixed Contact Reader', can_read: true })
    for (const row of [own, other]) {
      const current = await admin.get<Record<string, unknown>>(contacts.rowUrl(row.row_id))
      await admin.post('/api/save_row', { table: contacts.name, row: { ...current, phone: 'changed-phone' } })
    }
    const history = tableRef('Version')
    const listing = history.listUrl({ fields: ['row_id', 'ref_name'], filters: [['ref_table', '=', contacts.name]] })
    const visible = await reader.get<{ data: { row_id: string; ref_name: string }[] }>(listing)
    expect(visible.data.map((row) => row.ref_name)).toEqual([own.row_id])
    expect((await reader.fetch(history.rowUrl(visible.data[0].row_id))).status).toBe(200)
    const all = await admin.get<{ data: { row_id: string; ref_name: string }[] }>(listing)
    const hidden = all.data.find((row) => row.ref_name === other.row_id)!
    expect((await reader.fetch(history.rowUrl(hidden.row_id))).status).toBe(403)
  })

  test.for(['request', 'hook'] as const)('an ungranted contact detail from %s rejects the entire correction', async (source, { admin, createUser }) => {
    registerApp({
      name: 'contactproof',
      tables: [{ name: employee.name, id_pattern: 'prompt', columns: [
        { column_name: 'phone', column_type: 'Data' },
        { column_name: 'employee_number', column_type: 'Data', tier: 'restricted' },
      ] }],
      doc_events: { [employee.name]: { before_save(ctx) {
        if (source === 'hook' && ctx.row.phone === 'changed') ctx.row.employee_number = 'FORBIDDEN'
      } } },
      fixtures: [{ table: employee.name, rows: [
        { row_id: 'priya', phone: 'demo-phone-priya', employee_number: 'DEMO-003' },
      ] }],
    })
    await installApp('contactproof')
    try {
      await grantRole(admin, { role: 'Contact Editor', table: employee.name, can_read: true, can_write: true })
      await grantRole(admin, { role: 'Contact Auditor', table: employee.name, tier: 'restricted', can_read: true })
      // The identifier is readable, but the only write grant covers phone.
      const editor = await createUser({ roles: ['Contact Editor', 'Contact Auditor'] })
      const before = await editor.get<Record<string, unknown>>(employee.rowUrl('priya'))
      expect(before.employee_number).toBe('DEMO-003')
      await expectApiError(editor.post('/api/save_row', {
        table: employee.name,
        row: { row_id: 'priya', updated_at: before.updated_at, phone: 'changed',
          ...(source === 'request' ? { employee_number: 'FORBIDDEN' } : {}),
        },
      }), { status: 403 })
      expect(await editor.get(employee.rowUrl('priya'))).toMatchObject({
        phone: 'demo-phone-priya', employee_number: 'DEMO-003', updated_at: before.updated_at,
      })
      expect(await editor.post('/api/save_row', {
        table: employee.name,
        row: { row_id: 'priya', updated_at: before.updated_at, phone: 'permitted', employee_number: 'DEMO-003' },
      })).toMatchObject({ phone: 'permitted', employee_number: 'DEMO-003' })
    } finally {
      suspendRuntimeApp('contactproof')
    }
  })

  test('platform administrators read app contacts only through their domain grants', async ({ admin, createUser }) => {
    registerApp({
      name: 'contactproof',
      tables: [{ name: employee.name, id_pattern: 'prompt', columns: [
        { column_name: 'name', column_type: 'Data' },
        { column_name: 'phone', column_type: 'Data' },
      ] }],
      fixtures: [{ table: employee.name, rows: [
        { row_id: 'priya', name: 'Priya', phone: 'demo-phone-priya' },
        { row_id: 'ravi', name: 'Ravi', phone: 'demo-phone-ravi' },
      ] }],
    })
    await installApp('contactproof')
    try {
      const platformAdmin = await createUser({ roles: ['System Manager'] })
      for (const caller of [platformAdmin, admin]) {
        await expectApiError(caller.get(employee.rowUrl('priya')), { status: 403 })
        await expectApiError(caller.get(employee.listUrl({ fields: ['name', 'phone'] })), { status: 403 })
      }
      // A real domain grant, rather than the platform role, enables the same request.
      await grantRole(admin, { role: 'Contact Reader', table: employee.name, can_read: true })
      const reader = await createUser({ roles: ['System Manager', 'Contact Reader'] })
      expect(await reader.get(employee.rowUrl('priya'))).toMatchObject({
        row_id: 'priya', name: 'Priya', phone: 'demo-phone-priya',
      })
      await admin.post('/api/save_row', {
        table: 'Data Scope',
        row: { person: reader.user, allow_table: employee.name, for_value: 'ravi' },
      })
      await expectApiError(reader.get(employee.rowUrl('priya')), { status: 403 })
      expect(await reader.get(employee.rowUrl('ravi'))).toMatchObject({ row_id: 'ravi' })
      expect(await reader.get(employee.listUrl({ fields: ['name', 'phone'] }))).toMatchObject({
        data: [{ name: 'Ravi', phone: 'demo-phone-ravi' }], total: 1,
      })
      for (const [row_id, visible] of [['priya', false], ['ravi', true]] as const) {
        expect(await eventVisibleTo(reader.user!, {
          channel: `list:${employee.name}`, event: 'updated', payload: { table: employee.name, row_id },
        })).toBe(visible)
      }
    } finally {
      // App registrations live outside the SQL rollback sandbox.
      suspendRuntimeApp('contactproof')
    }
  })

  test('platform administrators cannot read app contacts through their comments', async ({ admin, createUser }) => {
    registerApp({
      name: 'contactproof',
      tables: [{ name: employee.name, id_pattern: 'prompt', columns: [{ column_name: 'phone', column_type: 'Data' }] }],
      fixtures: [{ table: employee.name, rows: [{ row_id: 'priya', phone: 'demo-phone-priya' }] }],
    })
    await installApp('contactproof')
    try {
      await grantRole(admin, { role: 'Contact Reader', table: employee.name, can_read: true })
      await grantRole(admin, { role: 'Contact Reader', table: 'Comment', can_read: true, can_create: true })
      const reader = await createUser({ roles: ['Contact Reader'] })
      const comment = await reader.post<{ row_id: string }>('/api/save_row', {
        table: 'Comment', row: { ref_table: employee.name, ref_name: 'priya', content: 'Operational phone: demo-phone-priya' },
      })
      const comments = tableRef('Comment')
      await expectApiError(admin.get(comments.rowUrl(comment.row_id)), { status: 403 })
      expect(await admin.get(comments.listUrl({ filters: [['ref_table', '=', employee.name]] }))).toMatchObject({ data: [], total: 0 })
      expect(await reader.get(comments.rowUrl(comment.row_id))).toMatchObject({ content: 'Operational phone: demo-phone-priya' })
    } finally {
      suspendRuntimeApp('contactproof')
    }
  })
})
