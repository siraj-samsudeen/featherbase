import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { runQueryReport, parseFilters } from '../src/query-report'

// RPT-004: admin-authored SQL reports run with bound filter params, read-only;
// authoring is gated to System Managers even for users who can otherwise edit
// Report documents.

const ROLE = 'Rpt Srv Author'
const REPORT = 'Rpt Srv Recent'

// A role that can fully edit Report docs, a user holding only that role, and
// the admin-authored query report — rebuilt per test inside the sandbox tx.
async function setup(admin: TestClient) {
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  await admin.post('/api/save_doc', {
    doctype: 'DocPerm',
    doc: { ref_doctype: 'Report', role: ROLE, can_read: true, can_write: true, can_create: true },
  })
  // Admin authors a query report using a date filter placeholder.
  await admin.post('/api/save_doc', {
    doctype: 'Report',
    doc: {
      name: REPORT,
      ref_doctype: 'User',
      report_type: 'Query Report',
      query: 'select name, creation from tab_user where creation >= {from_date} order by name',
    },
  })
}

describe('RPT-004: query reports', () => {
  test('parses filter placeholders in first-seen order, deduped', () => {
    expect(parseFilters('select 1 where a={x} and b={y} or c={x}')).toEqual(['x', 'y'])
  })

  test('runs with a bound date filter (and returns nothing for a future date)', async ({
    admin,
  }) => {
    await setup(admin)
    const past = await runQueryReport(REPORT, { from_date: '2000-01-01' }, 'Administrator')
    expect(past.columns).toEqual(['name', 'creation'])
    expect(past.rows.some((r) => r.name === 'Administrator')).toBe(true)

    const future = await runQueryReport(REPORT, { from_date: '2999-01-01' }, 'Administrator')
    expect(future.rows).toHaveLength(0)
  })

  test('binds filters as parameters, so a malicious value is inert', async ({ admin }) => {
    await setup(admin)
    const res = await runQueryReport(
      REPORT,
      { from_date: '2000-01-01' }, // a real run…
      'Administrator',
    )
    const before = res.rows.length
    // …and an injection attempt via the value is just a (bad) string param.
    await expect(
      runQueryReport(REPORT, { from_date: "x'; drop table tab_user; --" }, 'Administrator'),
    ).rejects.toMatchObject({ type: 'ValidationError' }) // bad date → clean error, no 500
    // The table still exists and still has users.
    const still = await runQueryReport(REPORT, { from_date: '2000-01-01' }, 'Administrator')
    expect(still.rows.length).toBe(before)
  })

  test('rejects non-SELECT SQL and blocks writes even if attempted', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/save_doc', {
      doctype: 'Report',
      doc: {
        name: 'Rpt Srv Evil',
        ref_doctype: 'User',
        report_type: 'Query Report',
        query: 'update tab_user set full_name = full_name',
      },
    })
    await expect(runQueryReport('Rpt Srv Evil', {}, 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError',
    })
  })

  test('gates SQL authoring to System Managers, even for Report editors', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    // The author has write on Report, but is NOT a System Manager.
    const author = await createUser({ roles: [ROLE] })
    const AUTHOR = author.user!

    // The author role CAN create an ordinary (non-SQL) report…
    await expect(
      saveDoc('Report', { name: 'Rpt Srv Builder', ref_doctype: 'User', report_type: 'Report Builder' }, AUTHOR),
    ).resolves.toBeTruthy()

    // …but CANNOT create a Query Report with SQL…
    await expect(
      saveDoc(
        'Report',
        { name: 'Rpt Srv Evil2', ref_doctype: 'User', report_type: 'Query Report', query: 'select name from tab_user' },
        AUTHOR,
      ),
    ).rejects.toMatchObject({ type: 'PermissionError' })

    // …nor edit an existing report's query (pass the exact modified stamp so
    // the gate — not the concurrency check — is what rejects).
    const [{ modified }] = await sql`select modified from tab_report where name = ${REPORT}`
    await expect(
      saveDoc(
        'Report',
        {
          name: REPORT,
          modified: (modified as Date).toISOString(),
          query: 'select name, password_hash from tab_user',
        },
        AUTHOR,
      ),
    ).rejects.toMatchObject({ type: 'PermissionError' })
  })
})
