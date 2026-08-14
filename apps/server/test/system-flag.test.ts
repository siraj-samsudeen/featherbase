// #74: the `system` flag on Table metadata. Platform tables (created by the
// migration chain) carry system = true and the Admin groups them; user tables
// can never claim the flag over the API — POST/PUT /api/table_def reject it,
// and the only other write path into table_def (save_row) is ENGINE_MANAGED
// and refused outright (bootstrap.test.ts pins that).

import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { ENGINE_TABLES } from '../migrations/0058_system_flag'

const COLUMNS = [{ column_name: 'title', column_type: 'Data' }]

describe('system flag: the migration chain owns it', () => {
  test('every migration-created table carries system = true', async () => {
    const unflagged = await sql`
      select name from table_def where system = false and name in ${sql(ENGINE_TABLES)}`
    expect(unflagged.map((r) => r.row_id)).toEqual([])
  })

  test('the opt-in Helpdesk demo is never flagged as a platform table', async () => {
    // Whether or not a dev database has installed the sample app, HD Ticket
    // must not sit in the System group.
    const rows = await sql`select 1 from table_def where name = 'HD Ticket' and system = true`
    expect(rows).toHaveLength(0)
  })

  test('a fresh migrated database has zero system = false tables', async ({ skip }) => {
    const rows = await sql`select name from table_def where system = false`
    const names = rows.map((r) => String(r.row_id))
    // A dev database legitimately carries user/opt-in tables (system = false
    // by design) — the strict zero check only holds on a freshly migrated
    // database, which CI always is. Regression target: a future migration
    // creating an engine table without system: true (and without extending
    // ENGINE_TABLES) fails this in CI.
    if (!process.env.CI && names.some((n) => !ENGINE_TABLES.includes(n)))
      skip('dev database carries user/opt-in tables')
    expect(names).toEqual([])
  })
})

describe('system flag: rejected on the public Table API', () => {
  test('POST /api/table_def with system: true is a field-wise 417', async ({ admin }) => {
    await expect(
      admin.post('/api/table_def', { name: 'Sys Claim A', system: true, columns: COLUMNS }),
    ).rejects.toMatchObject({
      status: 417,
      type: 'ValidationError',
      fields: { system: expect.stringContaining('reserved') },
    })
    const rows = await sql`select 1 from table_def where name = 'Sys Claim A'`
    expect(rows).toHaveLength(0)
  })

  test('PUT /api/table_def/:name cannot escalate an existing table to system', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Sys Claim B', columns: COLUMNS })
    await expect(
      admin.put('/api/table_def/Sys%20Claim%20B', { system: true, columns: COLUMNS }),
    ).rejects.toMatchObject({ status: 417, type: 'ValidationError' })
    const [row] = await sql`select system from table_def where name = 'Sys Claim B'`
    expect(row.system).toBe(false)
  })

  test('an API-created table lands as system = false and keeps its module', async ({ admin }) => {
    const meta = await admin.post<{ system: boolean; module: string }>('/api/table_def', {
      name: 'Sys Claim C',
      module: 'Custom',
      columns: COLUMNS,
    })
    expect(meta.system).toBe(false)
    expect(meta.module).toBe('Custom')
  })
})
