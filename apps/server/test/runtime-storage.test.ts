import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { installApp, registerApp, uninstallApp } from '../src/apps'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

describe('PKG-R2: independent app-owned Task storage', () => {
  test('same local name and row ID do not share columns or values', async ({ admin }) => {
    for (const [owner, column] of [['tasker', 'title'], ['other', 'quantity']]) {
      registerApp({ name: owner, tables: [{
        name: `${owner}.task`, label: 'Task', module: owner, id_pattern: 'prompt',
        columns: [{ column_name: column, column_type: column === 'title' ? 'Data' : 'Int' }],
      }] })
      await installApp(owner)
    }
    try {
      await admin.post('/api/save_row', { table: 'tasker.task', row: { row_id: 'same', title: 'Review returns' } })
      await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'same', quantity: 37 } })
      expect(await admin.get('/api/table/tasker.task/same')).toMatchObject({ title: 'Review returns' })
      // Int is PostgreSQL bigint and uses the existing lossless string wire format.
      expect(await admin.get('/api/table/other.task/same')).toMatchObject({ quantity: '37' })
      expect(await admin.get('/api/table/tasker.task:meta')).toMatchObject({
        name: 'tasker.task', label: 'Task', owner_app: 'tasker', physical_schema: 'tasker', physical_relation: 'task',
      })
      // Move the physical relation without changing identity: a resolver that
      // merely splits the dotted logical name must fail this read and update.
      await sql`alter table tasker.task rename to work_item`
      await sql`update table_def set physical_relation = 'work_item' where name = 'tasker.task'`
      invalidateMeta('tasker.task')
      const row = await admin.get<Record<string, unknown>>('/api/table/tasker.task/same')
      await admin.post('/api/save_row', { table: 'tasker.task', row: { ...row, title: 'Moved storage' } })
      expect(await admin.get('/api/table/tasker.task/same')).toMatchObject({ title: 'Moved storage' })
      expect(await admin.get('/api/table/other.task/same')).toMatchObject({ quantity: '37' })
    } finally {
      await uninstallApp('other')
      await uninstallApp('tasker')
    }
  })
})
