import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { registerApp, installApp, suspendRuntimeApp } from '../src/apps'
import { expectApiError, grantRole, tableRef } from './fixtures'

const employee = tableRef('contactproof.employee')

describe('domain administration', () => {
  test('platform administration alone cannot read app-owned employee contacts', async ({ admin, createUser }) => {
    registerApp({
      name: 'contactproof',
      tables: [{ name: employee.name, id_pattern: 'prompt', columns: [
        { column_name: 'name', column_type: 'Data' },
        { column_name: 'phone', column_type: 'Data' },
      ] }],
      fixtures: [{ table: employee.name, rows: [{ row_id: 'priya', name: 'Priya', phone: 'demo-phone-priya' }] }],
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
    } finally {
      // App registrations live outside the SQL rollback sandbox.
      suspendRuntimeApp('contactproof')
    }
  })
})
