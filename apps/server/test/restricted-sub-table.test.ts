import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { createUserWithRole, grantRole, patchDoc, tableRef } from './fixtures'
import { renderPrintHtml } from '../src/print'

// #341: a restricted column on a sub-table row is hidden exactly as one on
// the parent row is — from the form, the save's reply and printing.
const CHILD = 'Rst Quote Line'
const PARENT = 'Rst Quote'
const ROLE = 'Rst Sales'
const CTABLE = 'featherbase.rst_quote_line'
const parent = tableRef(PARENT)

async function setup(admin: TestClient, createUser: CreateUserFn, tier: 'basic' | 'restricted' = 'basic') {
  await admin.post('/api/table_def', {
    name: CHILD,
    kind: 'sub_table',
    columns: [
      { column_name: 'item', column_type: 'Data' },
      { column_name: 'unit_cost', column_type: 'Currency', tier: 'restricted', default_value: '1' },
    ],
  })
  await admin.post('/api/table_def', {
    name: PARENT,
    columns: [
      { column_name: 'customer', column_type: 'Data' },
      { column_name: 'margin', column_type: 'Currency', tier: 'restricted' },
      { column_name: 'lines', column_type: 'Sub-table', row_table: CHILD },
    ],
  })
  const user = await createUserWithRole(admin, createUser, {
    role: ROLE,
    table: PARENT,
    tier: 'basic',
    can_read: true,
    can_write: true,
    can_create: true,
  })
  if (tier === 'restricted')
    await grantRole(admin, { role: ROLE, table: PARENT, tier: 'restricted', can_read: true, can_write: true })
  const doc = await admin.post<Record<string, any>>('/api/save_row', {
    table: PARENT,
    row: { customer: 'Acme', margin: 900, lines: [{ item: 'Bolt', unit_cost: 4200 }] },
  })
  return { user, name: String(doc.row_id) }
}

describe('#341: restricted columns on sub-table rows', () => {
  test('a restricted-tier grant on the parent shows the child row’s restricted column', async ({ admin, createUser }) => {
    const { user, name } = await setup(admin, createUser, 'restricted')
    const doc = await user.get<Record<string, any>>(parent.rowUrl(name))
    expect(Number(doc.lines[0].unit_cost)).toBe(4200)
  })

  test('a restricted-tier grant on the sub-table itself shows it too, as a direct list of it would', async ({ admin, createUser }) => {
    const { user, name } = await setup(admin, createUser)
    await grantRole(admin, { role: ROLE, table: CHILD, tier: 'basic', can_read: true })
    await grantRole(admin, { role: ROLE, table: CHILD, tier: 'restricted', can_read: true })
    const doc = await user.get<Record<string, any>>(parent.rowUrl(name))
    expect(Number(doc.lines[0].unit_cost)).toBe(4200)
    expect('margin' in doc).toBe(false)
  })

  test('the reply to a save carries no restricted column on the row', async ({ admin, createUser }) => {
    const { user, name } = await setup(admin, createUser)
    const cur = await user.get<Record<string, any>>(parent.rowUrl(name))
    const saved = await patchDoc<Record<string, any>>(user, parent.rowUrl(name), {
      updated_at: cur.updated_at,
      customer: 'Acme Ltd',
      lines: cur.lines,
    })
    expect(saved.customer).toBe('Acme Ltd')
    expect('margin' in saved).toBe(false)
  })

  test('a basic-tier writer can neither overwrite nor set a hidden child column', async ({ admin, createUser }) => {
    const { user, name } = await setup(admin, createUser)
    const cur = await user.get<Record<string, any>>(parent.rowUrl(name))
    // The form echoes the line it was shown (no unit_cost) and adds one
    // that tries to set the hidden column.
    await expect(patchDoc(user, parent.rowUrl(name), {
      updated_at: cur.updated_at,
      lines: [{ ...cur.lines[0], item: 'Bolt M8' }, { item: 'Nut', unit_cost: 77 }],
    })).rejects.toMatchObject({ status: 403 })
    const unchanged = await admin.get<Record<string, any>>(parent.rowUrl(name))
    expect(unchanged.updated_at).toBe(cur.updated_at)
    expect(unchanged.lines.map((r: Record<string, unknown>) => [r.item, Number(r.unit_cost)])).toEqual([['Bolt', 4200]])
    // Omitting the hidden value permits the edit and preserves the stored cost.
    // A new line gets its metadata default, not a caller-supplied hidden value.
    await patchDoc(user, parent.rowUrl(name), {
      updated_at: cur.updated_at,
      lines: [{ ...cur.lines[0], item: 'Bolt M8' }, { item: 'Nut' }],
    })
    const rows = await sql.unsafe(
      `select item, unit_cost from ${CTABLE} where parent = '${name}' order by position`,
    )
    expect(rows.map((r) => [r.item, Number(r.unit_cost)]).filter(([item]) => item === 'Nut')).toEqual([['Nut', 1]])
  })

  test('printing the row leaves the restricted column out', async ({ admin, createUser }) => {
    const { user, name } = await setup(admin, createUser)
    const html = await renderPrintHtml(PARENT, name, user.user!)
    expect(html).not.toContain('<dt>margin</dt>')
  })

  test('someone editing through a share gets the whole row back, as when they open it', async ({ admin, createUser }) => {
    const { name } = await setup(admin, createUser)
    const guest = await createUser({ roles: [] })
    await admin.post('/api/save_row', { table: 'Share', row: { share_table: PARENT, share_name: name, person: guest.user, read: true, write: true } })
    const cur = await guest.get<Record<string, any>>(parent.rowUrl(name))
    const saved = await guest.post<Record<string, any>>('/api/save_row', {
      table: PARENT,
      row: { row_id: name, updated_at: cur.updated_at, customer: 'Acme Ltd' },
    })
    expect(saved.customer).toBe('Acme Ltd')
    expect(Number(saved.margin)).toBe(900)
    expect(Number(saved.lines[0].unit_cost)).toBe(4200)
  })
})
