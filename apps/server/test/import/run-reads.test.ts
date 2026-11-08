import { describe, expect } from 'vitest'
import { test } from '../pg-test'
import { sql } from '../../src/db'
import { saveDoc } from '../../src/document'
import { getMeta } from '../../src/meta'
import { clearControllers, registerController } from '../../src/controllers'
import { writesNoRememberedFacts } from '../../src/permission-reads'
import { platformTableExists } from '../../src/platform-tables'

// #1074: an import of 500 rows asked the same questions 500 times — the
// importer's roles, the Table's scripts, workflow, rules — about 40 round trips
// a row. A run into a Table someone made now asks each once.

const DT = 'Run Reads Asset'
const PATH = `/api/table/${encodeURIComponent(DT)}:import`
const ROWS = 30

// Reads of one platform Table in this test's own transaction: the suite runs
// every request on that transaction, so these are exactly the import's reads.
async function scans(table: string): Promise<number> {
  const [row] = await sql`
    select coalesce(seq_scan, 0) + coalesce(idx_scan, 0) as n from pg_stat_xact_user_tables
    where schemaname = 'featherbase' and relname = ${table}`
  return Number(row?.n ?? 0)
}

const rows = () => Array.from({ length: ROWS }, (_, i) => ({ title: `Asset ${i}` }))

describe('#1074: an import asks each person-and-Table question once', () => {
  test("a System Manager's import into a Table someone made reads their roles and the Table's scripts once", async ({ admin, createUser }) => {
    await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
    const importer = await createUser({ roles: ['System Manager'] })
    const roles = await scans('has_role')
    const scripts = await scans('server_script')
    const res = await importer.post<{ inserted: number }>(PATH, { rows: rows() })
    expect(res.inserted).toBe(ROWS)
    expect(await scans('has_role') - roles).toBeLessThan(5)
    expect(await scans('server_script') - scripts).toBeLessThan(5)
  })

  test('a Table whose controller runs hooks is read row by row, since a hook may change what was read', async ({ admin, createUser }) => {
    await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
    const controller = { table: DT, hooks: { validate: () => {} } }
    registerController(controller)
    try {
      const importer = await createUser({ roles: ['System Manager'] })
      const roles = await scans('has_role')
      await importer.post(PATH, { rows: rows() })
      expect(await scans('has_role') - roles).toBeGreaterThanOrEqual(ROWS)
    } finally {
      clearControllers(DT)
    }
  })

  test('an assignment rule still hands rows out in turn: each assignment moves its turn', async ({ admin }) => {
    const people = ['psn_runreads1', 'psn_runreads2']
    for (const p of people)
      await sql`insert into person ${sql({ row_id: p, created_by: 'Administrator', updated_by: 'Administrator', email: `${p.slice(4)}@x.com`, enabled: true })}`
    await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
    await saveDoc('Assignment Rule', { row_id: 'Run Reads Turns', ref_table: DT, users: people.map((user) => ({ user })) })
    await admin.post(PATH, { rows: rows().slice(0, 4) })
    const todos = await sql`select allocated_to from todo where ref_table = ${DT} order by created_at, row_id`
    expect(todos.map((t) => t.allocated_to)).toEqual([people[0], people[1], people[0], people[1]])
  })

  test("only a Table someone made qualifies: a platform Table's or an app's rows can change what was read", async ({ admin }) => {
    await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
    const made = await getMeta(DT)
    expect(writesNoRememberedFacts(made)).toBe(true)
    expect(writesNoRememberedFacts(await getMeta('Has Role'))).toBe(false)
    expect(writesNoRememberedFacts({ ...made, owner_app: 'tasker' })).toBe(false)
  })

  test('a platform Table not made yet is asked about again', async () => {
    expect(await platformTableExists('run_reads_not_made')).toBe(false)
    expect(await platformTableExists('run_reads_not_made')).toBe(false)
    expect(await platformTableExists('server_script')).toBe(true)
    expect(await platformTableExists('server_script')).toBe(true)
  })
})
