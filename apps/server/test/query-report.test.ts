import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { runQueryReport, parseFilters } from '../src/query-report'
import { areq } from './helpers'

// RPT-004: admin-authored SQL reports run with bound filter params, read-only;
// authoring is gated to System Managers even for users who can otherwise edit
// Report documents.

const ROLE = 'Rpt Srv Author'
const AUTHOR = 'rpt-srv-author@x.com' // has write on Report, NOT System Manager
const REPORT = 'Rpt Srv Recent'

async function cleanup() {
  await sql`delete from tab_report where name in (${REPORT}, 'Rpt Srv Builder', 'Rpt Srv Evil')`
  await sql`delete from tab_docperm where ref_doctype = 'Report' and role = ${ROLE}`
  await sql`delete from tab_has_role where parent = ${AUTHOR}`
  await sql`delete from tab_user where name = ${AUTHOR}`
  await sql`delete from tab_role where name = ${ROLE}`
}

async function save(doctype: string, doc: Record<string, unknown>) {
  const res = await areq('/api/save_doc', { method: 'POST', body: JSON.stringify({ doctype, doc }) })
  if (res.status !== 201) throw new Error(`save ${doctype}: ${res.status} ${await res.text()}`)
}

beforeAll(async () => {
  await cleanup()
  // A role that can fully edit Report docs, and a user holding only that role.
  await save('Role', { name: ROLE })
  await save('DocPerm', { ref_doctype: 'Report', role: ROLE, can_read: true, can_write: true, can_create: true })
  await save('User', { name: AUTHOR, email: AUTHOR, enabled: true, roles: [{ role: ROLE }] })

  // Admin authors a query report using a date filter placeholder.
  await save('Report', {
    name: REPORT,
    ref_doctype: 'User',
    report_type: 'Query Report',
    query: 'select name, creation from tab_user where creation >= {from_date} order by name',
  })
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('RPT-004: query reports', () => {
  it('parses filter placeholders in first-seen order, deduped', () => {
    expect(parseFilters('select 1 where a={x} and b={y} or c={x}')).toEqual(['x', 'y'])
  })

  it('runs with a bound date filter (and returns nothing for a future date)', async () => {
    const past = await runQueryReport(REPORT, { from_date: '2000-01-01' }, 'Administrator')
    expect(past.columns).toEqual(['name', 'creation'])
    expect(past.rows.some((r) => r.name === 'Administrator')).toBe(true)

    const future = await runQueryReport(REPORT, { from_date: '2999-01-01' }, 'Administrator')
    expect(future.rows).toHaveLength(0)
  })

  it('binds filters as parameters, so a malicious value is inert', async () => {
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

  it('rejects non-SELECT SQL and blocks writes even if attempted', async () => {
    await save('Report', {
      name: 'Rpt Srv Evil',
      ref_doctype: 'User',
      report_type: 'Query Report',
      query: 'update tab_user set full_name = full_name',
    })
    await expect(runQueryReport('Rpt Srv Evil', {}, 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError',
    })
  })

  it('gates SQL authoring to System Managers, even for Report editors', async () => {
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
