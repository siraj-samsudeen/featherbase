// #1282 F1–F6: the Business Roles grid's save, against a world held in memory. Made-up names.
import { describe, expect, it } from 'vitest'
import { PERMISSION_CHANGE, changePermissions, mayChangePermissions } from './permission-grid-server'

type Row = Record<string, unknown>
const ROLE = 'dash.business_role'
const PERMISSION = 'dash.business_role_permission'

function world(): Record<string, Row[]> {
  return {
    [ROLE]: [{ row_id: 'sm', role_name: 'Store Manager' }, { row_id: 'tl', role_name: 'Team Leader' }],
    [PERMISSION]: [
      { row_id: 'p1', business_role: 'sm', app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Sections', reach: 'Area', updated_at: 'u1' },
      { row_id: 'p2', business_role: 'tl', app: 'Tasker', level: 'Manager', verb: 'Edit', thing: 'Tasks', reach: 'Team', updated_at: 'u2' },
    ],
  }
}

function context(tables: Record<string, Row[]>, changes: unknown, roles = ['System Manager']) {
  let n = 0
  // As the platform: pages of at most 500 rows (the save must read every page).
  const list = async (table: string, args: { limit_start?: number; limit_page_length?: number } = {}) =>
    (tables[table] ?? []).slice(args.limit_start ?? 0, (args.limit_start ?? 0) + Math.min(args.limit_page_length ?? 500, 500))
  const writes: string[] = []
  return {
    writes,
    ctx: {
      user: 'mgr', userName: 'Manju Manager', roles, payload: { changes },
      reject(message: string): never { throw new Error(message) },
      baseTables: { list },
      documents: {
        list,
        async create(table: string, values: Row) { writes.push(`create ${table}`); const row = { row_id: `${table}-${++n}`, ...values }; (tables[table] ??= []).push(row); return row },
        // As the platform: an update names the row and the updated_at it was read at, or is refused.
        async update(table: string, values: Row) {
          const row = tables[table]!.find(r => r.row_id === values.row_id)!
          if (!values.updated_at || values.updated_at !== row.updated_at) throw new Error('Update requires row_id and updated_at')
          writes.push(`update ${table}`); Object.assign(row, values, { updated_at: `${row.updated_at}+` }); return row
        },
      },
    },
  }
}

const edit = { app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Sections' }
const tasks = { app: 'Tasker', level: 'Manager', verb: 'Edit', thing: 'Tasks' }

describe('saving the grid', () => {
  it('gives, changes and takes away a reach, each logged with who changed it', async () => {
    const tables = world()
    const { ctx } = context(tables, [
      { role: 'tl', ...edit, from: null, to: 'Own' },
      { role: 'sm', ...edit, from: 'Area', to: 'All' },
      { role: 'tl', ...tasks, from: 'Team', to: null },
    ])
    expect(await changePermissions(ctx as never)).toEqual({ saved: 3 })
    // Taken away is marked removed, never deleted (#1218); a new one is a new row.
    expect(tables[PERMISSION]!.map(r => [r.business_role, r.thing, r.reach, r.removed ?? false])).toEqual([['sm', 'Sections', 'All', false], ['tl', 'Tasks', 'Team', true], ['tl', 'Sections', 'Own', false]])
    expect(tables[PERMISSION_CHANGE]!.map(r => [r.business_role, r.permission, r.from_reach, r.to_reach, r.changed_by_name])).toEqual([
      ['tl', 'Dash · Manager · Edit Sections', '', 'Own', 'Manju Manager'],
      ['sm', 'Dash · Manager · Edit Sections', 'Area', 'All', 'Manju Manager'],
      ['tl', 'Tasker · Manager · Edit Tasks', 'Team', '', 'Manju Manager'],
    ])
  })

  it('gives back a permission taken away, on the same row, and reads a removed row as none', async () => {
    const tables = world()
    tables[PERMISSION]!.push({ row_id: 'p3', business_role: 'tl', app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Sections', reach: 'Area', removed: true, updated_at: 'u3' })
    const { ctx, writes } = context(tables, [{ role: 'tl', ...edit, from: null, to: 'Team' }])
    await changePermissions(ctx as never)
    expect([tables[PERMISSION]!.find(r => r.row_id === 'p3'), writes]).toEqual([expect.objectContaining({ reach: 'Team', removed: false }), [`update ${PERMISSION}`, `create ${PERMISSION_CHANGE}`]])
  })

  it('offers no permission only removed rows hold', async () => {
    const tables = world()
    tables[PERMISSION]!.push({ row_id: 'p4', business_role: 'tl', app: 'Dash', level: 'Manager', verb: 'Close', thing: 'Stores', reach: 'All', removed: true })
    const { ctx } = context(tables, [{ role: 'sm', app: 'Dash', level: 'Manager', verb: 'Close', thing: 'Stores', from: null, to: 'All' }])
    await expect(changePermissions(ctx as never)).rejects.toThrow('Dash · Manager · Close Stores is not a permission any business role has')
  })

  it('finds a permission past the first 500 rows', async () => {
    const tables = world()
    for (let i = 0; i < 600; i++) tables[PERMISSION]!.splice(0, 0, { row_id: `f${i}`, business_role: 'sm', app: 'Filler', level: 'Manager', verb: 'View', thing: `Thing ${i}`, reach: 'Own', updated_at: 'u' })
    const { ctx } = context(tables, [{ role: 'tl', ...tasks, from: 'Team', to: 'All' }])
    expect(await changePermissions(ctx as never)).toEqual({ saved: 1 })
  })

  it('keys each permission row it writes by its role and permission, so a second row for the same pair is refused', async () => {
    const tables = world()
    const { ctx } = context(tables, [{ role: 'tl', ...edit, from: null, to: 'Own' }, { role: 'sm', ...edit, from: 'Area', to: 'All' }])
    await changePermissions(ctx as never)
    expect(tables[PERMISSION]!.filter(r => r.thing === 'Sections').map(r => r.permission_key)).toEqual(['sm / Dash / Manager / Edit / Sections', 'tl / Dash / Manager / Edit / Sections'])
  })

  it('refuses a change whose cell changed since the grid loaded, writing none of them', async () => {
    const tables = world()
    const { ctx, writes } = context(tables, [{ role: 'tl', ...edit, from: null, to: 'Own' }, { role: 'sm', ...edit, from: 'Team', to: 'All' }])
    await expect(changePermissions(ctx as never)).rejects.toThrow('Store Manager · Dash · Manager · Edit Sections was changed since you loaded the grid')
    expect(writes).toEqual([])
  })

  it('refuses a permission no role has, so the grid cannot invent one', async () => {
    const { ctx } = context(world(), [{ role: 'sm', app: 'Dash', level: 'Manager', verb: 'Delete', thing: 'Everything', from: null, to: 'All' }])
    await expect(changePermissions(ctx as never)).rejects.toThrow('Dash · Manager · Delete Everything is not a permission any business role has')
  })

  it.each([
    ['an unknown role', [{ role: 'nobody', ...edit, from: null, to: 'Own' }], 'Choose a business role'],
    ['the same cell twice', [{ role: 'tl', ...edit, from: null, to: 'Own' }, { role: 'tl', ...edit, from: null, to: 'Team' }], 'Team Leader · Dash · Manager · Edit Sections is changed twice'],
    ['a reach that is none of the four', [{ role: 'tl', ...edit, from: null, to: 'Everywhere' }], 'A reach is Own, Team, Area or All, or none'],
    ['a change that changes nothing', [{ role: 'sm', ...edit, from: 'Area', to: 'Area' }], 'A change changes the reach'],
    ['a change with no permission named', [{ role: 'sm', from: null, to: 'Own' }], 'Each change names a role and a permission'],
    ['nothing', [], 'Nothing to save'],
    ['too many', Array.from({ length: 201 }, () => ({ role: 'tl', ...edit, from: null, to: 'Own' })), 'Save at most 200 changes at once'],
  ])('refuses %s', async (_case, changes, message) => {
    const { ctx, writes } = context(world(), changes)
    await expect(changePermissions(ctx as never)).rejects.toThrow(message)
    expect(writes).toEqual([])
  })

  // Siraj, 19-Nov-2026: editing what a role can do is System Manager work (#437); the grid is read-only for anyone else.
  it.each([['a Report Access Manager', ['Report Access Manager']], ['someone with neither', ['Dash Reader']]])(
    'refuses the save to %s, and draws the grid read-only for them', async (_who, roles) => {
      const { ctx, writes } = context(world(), [{ role: 'tl', ...edit, from: null, to: 'Own' }], roles)
      expect(mayChangePermissions(ctx as never)).toBe(false)
      await expect(changePermissions(ctx as never)).rejects.toThrow('Only a System Manager can change what a business role can do')
      expect(writes).toEqual([])
    })
})
