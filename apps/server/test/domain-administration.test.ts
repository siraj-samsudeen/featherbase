import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { registerApp, installApp, suspendRuntimeApp } from '../src/apps'
import { expectApiError, grantRole, makeTable, tableRef } from './fixtures'
import { eventVisibleTo } from '../src/realtime'
import { getMeta } from '../src/meta'

const employee = tableRef('contactproof.employee')

describe('domain administration', () => {
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
