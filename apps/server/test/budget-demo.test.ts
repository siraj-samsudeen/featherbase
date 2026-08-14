import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

// Spec 0007: the budget-books-demo sample app is the scenario world from
// the design document — this suite installs it in the sandbox and drives
// the three approval lanes (standard, fast-lane-with-flag, DOA→CFO)
// end-to-end, plus the M2 governance/compare endpoints.

const T = encodeURIComponent
const CHANGE = `/api/table/${T('Budget Change')}`

const BOOKS = ['Sales Budget 2026', 'Opex Budget 2026']

// Install the app — or, when it is already installed in this database (the
// dev DB carries a live install), reset it to factory state INSIDE the
// test's rolled-back transaction: books back to working, versions and
// changes purged, measure values restored. Direct SQL is fine here — the
// sandbox rolls every bit of it back.
async function install(admin: TestClient) {
  const res = await admin.fetch('/api/install_app', {
    method: 'POST',
    body: JSON.stringify({ name: 'budget-books-demo' }),
  })
  if (res.status === 409) {
    // A concurrent session may have left another ACTIVE workflow on Budget
    // Change — getActiveWorkflow picks the newest, which would shadow the
    // demo's lanes. (Finding for the owner: the platform does not enforce
    // one-active-workflow-per-table.)
    await sql`update workflow set is_active = false
      where ref_table = 'Budget Change' and name <> 'Budget Approval'`
    // Factory policy fields and over_doa-based conditions (an older live
    // install predates them).
    await sql`update budget_book set doa_amount = 300000, escalation_dir = 'decrease'
      where name = 'Sales Budget 2026'`
    await sql`update budget_book set doa_amount = 500000, escalation_dir = 'increase'
      where name = 'Opex Budget 2026'`
    await sql`update workflow_transition set condition = '!doc.over_doa'
      where parent = 'Budget Approval' and state = 'Pending' and action = 'Approve'`
    await sql`update workflow_transition set condition = 'doc.over_doa'
      where parent = 'Budget Approval' and action = 'Send to CFO'`
    await sql`delete from budget_change_line
      where parent in (select name from budget_change where book = any(${BOOKS}))`
    await sql`delete from budget_change where book = any(${BOOKS})`
    await sql`delete from budget_version_line
      where version in (select name from budget_version where book = any(${BOOKS}))`
    await sql`delete from budget_version where book = any(${BOOKS})`
    await sql`update budget_book set lifecycle = 'working' where name = any(${BOOKS})`
    await sql`update sales_budget_line set apr = 120000 where name = 'SBL-ADY-JUICES'`
    await sql`update opex_budget_line set q1 = 950000, q2 = 950000, q3 = 950000, q4 = 950000
      where name = 'OBL-ADY-ELEC'`
    await sql`update opex_budget_line set q1 = 600000, q2 = 600000, q3 = 600000, q4 = 600000
      where name = 'OBL-ADY-REPAIR'`
    await sql`update opex_budget_line set q1 = 400000, q2 = 400000, q3 = 400000, q4 = 400000
      where name = 'OBL-IT-SOFT'`
    await sql`update opex_budget_line set q1 = 2500000, q2 = 2500000, q3 = 2500000, q4 = 2500000
      where name = 'OBL-IT-SAL'`
    return
  }
  expect([200, 201]).toContain(res.status)
}

async function baseline(admin: TestClient, book: string) {
  return admin.post<Record<string, unknown>>(
    `/api/table/${T('Budget Book')}/${T(book)}:baseline`,
    {},
  )
}

async function makeChange(admin: TestClient, doc: Record<string, unknown>) {
  return admin.post<Record<string, unknown>>(CHANGE, { reason: 'demo lane test', ...doc })
}

async function wfAction(client: TestClient, name: string, action: string) {
  return client.post<Record<string, unknown>>(
    `${CHANGE}/${T(name)}:apply_workflow_action`,
    { action },
  )
}

describe('budget-books-demo: the scenario world installs and its lanes work', () => {
  test('install seeds two working books over differently-shaped tables', async ({ admin }) => {
    await install(admin)
    const sales = await admin.get<Record<string, unknown>>(
      `/api/table/${T('Budget Book')}/${T('Sales Budget 2026')}`,
    )
    expect(sales.lifecycle).toBe('working')
    const opex = await admin.get<Record<string, unknown>>(
      `/api/table/${T('Budget Book')}/${T('Opex Budget 2026')}`,
    )
    expect(opex.lifecycle).toBe('working')
    const res = await baseline(admin, 'Sales Budget 2026')
    expect(res.line_count).toBe(5)
    const res2 = await baseline(admin, 'Opex Budget 2026')
    expect(res2.line_count).toBe(4)
  })

  test('standard lane: requester submits, approver approves within DOA, change applies', async ({
    admin,
    createUser,
  }) => {
    await install(admin)
    await baseline(admin, 'Sales Budget 2026')
    const requester = await createUser({ roles: ['Budget Requester'] })
    const approver = await createUser({ roles: ['Budget Approver'] })
    // Priya proposes reducing Adyar Juices in April (-25,000).
    const change = await makeChange(admin, {
      book: 'Sales Budget 2026',
      change_type: 'revise',
      lines: [{ line_ref: 'SBL-ADY-JUICES', measure_column: 'apr', proposed_value: 95000 }],
    })
    const name = String(change.name)
    // The requester cannot self-approve (no Budget Owner role)…
    await expect(wfAction(requester, name, 'Self-approve')).rejects.toMatchObject({ status: 403 })
    // …but can submit for approval.
    await wfAction(requester, name, 'Submit for approval')
    // Within ±5,00,000 the approver's Approve lands it (condition holds).
    await wfAction(approver, name, 'Approve')
    const line = await admin.get<Record<string, unknown>>(
      `/api/table/${T('Sales Budget Line')}/SBL-ADY-JUICES`,
    )
    expect(Number(line.apr)).toBe(95000)
    const after = await admin.get<Record<string, unknown>>(`${CHANGE}/${T(name)}`)
    expect(after.status).toBe('submitted')
  })

  test('fast lane: a budget owner self-approves a same-owner change, and the CFO is flagged', async ({
    admin,
    createUser,
  }) => {
    await install(admin)
    await baseline(admin, 'Opex Budget 2026')
    const owner = await createUser({ roles: ['Budget Owner'] })
    const change = await makeChange(admin, {
      book: 'Opex Budget 2026',
      change_type: 'revise',
      lines: [{ line_ref: 'OBL-IT-SOFT', measure_column: 'q3', proposed_value: 550000 }],
    })
    expect(change.crosses_owner).toBe(false)
    await wfAction(owner, String(change.name), 'Self-approve')
    const line = await admin.get<Record<string, unknown>>(
      `/api/table/${T('Opex Budget Line')}/OBL-IT-SOFT`,
    )
    expect(Number(line.q3)).toBe(550000)
    // The flag: the Email Rule fired on the workflow-driven submit, queueing
    // mail to the CFO — approved without review is visible, not silent.
    const queued = await sql`
      select recipient from email_queue
      where recipient = 'cfo@demo.featherbase.app'`
    expect(queued.length).toBeGreaterThanOrEqual(1)
  })

  test('fast lane is refused for a change that crosses owners — for everyone', async ({
    admin,
  }) => {
    await install(admin)
    await baseline(admin, 'Opex Budget 2026')
    const change = await makeChange(admin, {
      book: 'Opex Budget 2026',
      change_type: 'transfer',
      lines: [
        { line_ref: 'OBL-ADY-REPAIR', measure_column: 'q3', proposed_value: 400000 },
        { line_ref: 'OBL-IT-SOFT', measure_column: 'q3', proposed_value: 600000 },
      ],
    })
    expect(change.crosses_owner).toBe(true)
    // Condition gates are not bypassed even by Administrator.
    await expect(wfAction(admin, String(change.name), 'Self-approve')).rejects.toMatchObject({
      status: 417,
    })
  })

  test('DOA lane: over ±5,00,000 the approver can only escalate; the CFO lands it', async ({
    admin,
    createUser,
  }) => {
    await install(admin)
    await baseline(admin, 'Opex Budget 2026')
    const requester = await createUser({ roles: ['Budget Requester'] })
    const approver = await createUser({ roles: ['Budget Approver'] })
    const cfo = await createUser({ roles: ['CFO'] })
    // Tariff revision: Electricity +8,00,000 across Q3 (over the DOA).
    const change = await makeChange(admin, {
      book: 'Opex Budget 2026',
      change_type: 'revise',
      lines: [{ line_ref: 'OBL-ADY-ELEC', measure_column: 'q3', proposed_value: 1750000 }],
    })
    const name = String(change.name)
    await wfAction(requester, name, 'Submit for approval')
    // The small-delta Approve's condition fails — even for the approver.
    await expect(wfAction(approver, name, 'Approve')).rejects.toMatchObject({ status: 417 })
    await wfAction(approver, name, 'Send to CFO')
    await wfAction(cfo, name, 'Approve')
    const line = await admin.get<Record<string, unknown>>(
      `/api/table/${T('Opex Budget Line')}/OBL-ADY-ELEC`,
    )
    expect(Number(line.q3)).toBe(1750000)
  })

  test('M2 endpoints: governance status and compare', async ({ admin }) => {
    await install(admin)
    await baseline(admin, 'Opex Budget 2026')
    const draft = await makeChange(admin, {
      book: 'Opex Budget 2026',
      change_type: 'revise',
      lines: [{ line_ref: 'OBL-IT-SOFT', measure_column: 'q4', proposed_value: 999 }],
    })
    // Governance status: active book + the pending draft on this row.
    const gov = await admin.get<{
      book: { name: string; lifecycle: string } | null
      pending: { name: string }[]
    }>(`/api/budget/line/${T('Opex Budget Line')}/OBL-IT-SOFT`)
    expect(gov.book?.name).toBe('Opex Budget 2026')
    expect(gov.pending.map((p) => p.name)).toContain(String(draft.name))
    // Apply one change, then compare v0 → current. BUD-R11: the demo
    // workflow owns the gate, so approval rides a transition (the change is
    // single-owner, so Self-approve's condition holds; admin bypasses the
    // role, not the condition).
    await wfAction(admin, String(draft.name), 'Self-approve')
    const [v0] = await sql`
      select name from budget_version where book = 'Opex Budget 2026' and kind = 'baseline'`
    const cmp = await admin.get<{
      lines: { ref_name: string; status: string; measures: Record<string, { from: number | null; to: number | null }> }[]
      unchanged: number
    }>(
      `/api/budget/compare/${T('Opex Budget 2026')}?from=${String(v0.name)}&to=current`,
    )
    expect(cmp.lines).toHaveLength(1)
    expect(cmp.lines[0].ref_name).toBe('OBL-IT-SOFT')
    expect(cmp.lines[0].status).toBe('changed')
    expect(cmp.lines[0].measures.q4).toEqual({ from: 400000, to: 999 })
    expect(cmp.unchanged).toBe(3)
  })
})
