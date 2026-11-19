// #1282 F1–F6: the Business Roles reports grid's save, against a world held in memory. Made-up names.
import { describe, expect, it } from 'vitest'
import { changeReportGrants } from './report-grid-server'

type Row = Record<string, unknown>
const ACCESS = 'dash.report_access'

function world(): Record<string, Row[]> {
  return {
    'dash.business_role': [{ row_id: 'sm', role_name: 'Store Manager' }, { row_id: 'tl', role_name: 'Team Leader' }],
    'dash.report': [{ row_id: 'vs', report_key: 'vs' }, { row_id: 'hidden', report_key: 'hidden' }],
    'dash.report_bundle': [{ row_id: 'b1' }],
    [ACCESS]: [
      { row_id: 'g1', report: 'vs', business_role: 'sm', updated_at: 'u1' },
      { row_id: 'g2', report: 'vs', business_role: 'tl', removed: true, updated_at: 'u2' },
      { row_id: 'g3', report: 'vs', person: 'p9', updated_at: 'u3' },
    ],
  }
}

function context(tables: Record<string, Row[]>, changes: unknown, roles = ['Report Access Manager']) {
  let n = 0
  const writes: string[] = []
  const list = async (table: string, args: { limit_start?: number; limit_page_length?: number } = {}) =>
    (tables[table] ?? []).slice(args.limit_start ?? 0, (args.limit_start ?? 0) + Math.min(args.limit_page_length ?? 500, 500))
  return {
    writes,
    ctx: {
      user: 'mgr', userName: 'Manju Manager', roles, payload: { changes },
      reject(message: string): never { throw new Error(message) },
      baseTables: { list },
      documents: {
        // As the caller may read them: one report is hidden from this manager.
        list: async (table: string, args: Row) => (await list(table, args)).filter(r => r.report_key !== 'hidden'),
        async create(table: string, values: Row) { writes.push(`create ${table}`); const row = { row_id: `${table}-${++n}`, ...values }; tables[table]!.push(row); return row },
        async update(table: string, values: Row) {
          const row = tables[table]!.find(r => r.row_id === values.row_id)!
          if (values.updated_at !== row.updated_at) throw new Error('Update requires row_id and updated_at')
          writes.push(`update ${table}`); Object.assign(row, values); return row
        },
      },
    },
  }
}

describe('saving the reports grid', () => {
  it('gives a report or a bundle to a role, and takes one away, as Give a report does', async () => {
    const tables = world()
    const { ctx } = context(tables, [
      { role: 'tl', table: 'dash.report', key: 'vs', from: false, to: true },
      { role: 'tl', table: 'dash.report_bundle', key: 'b1', from: false, to: true },
      { role: 'sm', table: 'dash.report', key: 'vs', from: true, to: false },
    ])
    expect(await changeReportGrants(ctx as never)).toEqual({ saved: 3 })
    expect(tables[ACCESS]!.filter(r => r.business_role && !r.removed).map(r => [r.business_role, r.report ?? r.report_bundle, r.given_by_name]))
      .toEqual([['tl', 'vs', 'Manju Manager'], ['tl', 'b1', 'Manju Manager']])
    expect(tables[ACCESS]!.find(r => r.row_id === 'g1')!.removed).toBe(true)
  })

  it('refuses a tick changed since the grid loaded, writing none of them', async () => {
    const { ctx, writes } = context(world(), [{ role: 'tl', table: 'dash.report_bundle', key: 'b1', from: false, to: true }, { role: 'tl', table: 'dash.report', key: 'vs', from: true, to: false }])
    await expect(changeReportGrants(ctx as never)).rejects.toThrow("Team Leader's grant was changed since you loaded the grid")
    expect(writes).toEqual([])
  })

  it.each([
    ['a report the caller may not read', [{ role: 'tl', table: 'dash.report', key: 'hidden', from: false, to: true }], 'Choose a report or a bundle you may give'],
    ['an unknown role', [{ role: 'nobody', table: 'dash.report', key: 'vs', from: false, to: true }], 'Choose a business role'],
    ['the same cell twice', [{ role: 'tl', table: 'dash.report', key: 'vs', from: false, to: true }, { role: 'tl', table: 'dash.report', key: 'vs', from: false, to: true }], 'Team Leader is changed twice for the same report'],
    ['a change that changes nothing', [{ role: 'tl', table: 'dash.report', key: 'vs', from: false, to: false }], 'A change gives or takes away'],
    ['a Table that gives nothing', [{ role: 'tl', table: 'dash.business_role', key: 'sm', from: false, to: true }], 'Each change names a role and a report or a bundle'],
    ['nothing', [], 'Nothing to save'],
    ['too many', Array.from({ length: 201 }, () => ({ role: 'tl', table: 'dash.report', key: 'vs', from: false, to: true })), 'Save at most 200 changes at once'],
  ])('refuses %s', async (_case, changes, message) => {
    const { ctx, writes } = context(world(), changes)
    await expect(changeReportGrants(ctx as never)).rejects.toThrow(message)
    expect(writes).toEqual([])
  })

  it('is only for those who manage access', async () => {
    const { ctx } = context(world(), [{ role: 'tl', table: 'dash.report', key: 'vs', from: false, to: true }], ['Dash Reader'])
    await expect(changeReportGrants(ctx as never)).rejects.toThrow('Only a Report Access Manager or a System Manager can give reports to business roles')
  })
})
