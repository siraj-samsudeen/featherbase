// #1218: the business roles in shadow, over in-memory Tables. Made-up stores and people.
import { describe, expect, it } from 'vitest'
import { accessChanges, addStartingRoles, businessRoles, explainPerson, giveRole } from './business-roles-server'
import { reads, reportsFor } from './server'
import { STARTING_ROLES } from './starting-roles'
import { istToday } from './report'

type Row = Record<string, unknown>
const today = istToday()
const matches = (row: Row, [column, op, value]: [string, string, unknown]) =>
  op === 'in' ? (value as unknown[]).map(String).includes(String(row[column] ?? '')) : String(row[column] ?? '') === String(value ?? '')

/** The made-up world: Lakeside (plant 9901), a store manager titled Operations Executive, a staff member, a buyer, a head-office person. */
function world(): Record<string, Row[]> {
  return {
    Employee: [
      { row_id: 'E-SM', name: 'Selvi', employee_code: 'E-SM', status: 'Current', person: 'sm' },
      { row_id: 'E-ST', name: 'Siva', employee_code: 'E-ST', status: 'Current', person: 'st' },
      { row_id: 'E-BUY', name: 'Bina', employee_code: 'E-BUY', status: 'Current', person: 'buy' },
      { row_id: 'E-HO', name: 'Omar', employee_code: 'E-HO', status: 'Current', person: 'ho' },
    ],
    'Job Assignment': [
      { row_id: 'J-SM', employee: 'E-SM', job: 'Store Manager', designation: 'D-OPS', site: 'LKS', starts_on: '2026-01-01' },
      { row_id: 'J-ST', employee: 'E-ST', job: 'Staff', site: 'LKS', section: 'S1', starts_on: '2026-01-01' },
      { row_id: 'J-HO', employee: 'E-HO', job: 'Head office staff', site: 'HOF', starts_on: '2026-01-01' },
    ],
    Designation: [{ row_id: 'D-OPS', designation: 'Operations Executive' }],
    'Merchandise Assignment': [{ row_id: 'M-1', employee: 'E-BUY', responsibility: 'Category head', category: 'Sarees', operating_region: 'East', starts_on: '2026-01-01' }],
    Site: [{ row_id: 'LKS', name: 'Lakeside', is_store: true, cluster: 'NORTH', operating_region: 'East' }, { row_id: 'HOF', name: 'Head office', is_store: false }],
    Plant: [{ row_id: '9901', site: 'LKS', plant_type: 'Store' }],
    Section: [{ row_id: 'S1', name: 'Sarees', site: 'LKS', floor: 'F1' }],
    'Section Subcategory': [{ row_id: 'P1', store: 'LKS', section: 'S1', subcategory: '010101001', starts_on: '2026-01-01' }],
    Subcategory: [{ row_id: '010101001', category: 'Sarees', subcategory_type: 'Merchandise' }, { row_id: '010101002', category: 'Sarees', subcategory_type: 'Merchandise' },
      { row_id: '010102001', category: 'Kids', subcategory_type: 'Merchandise' }],
    Cluster: [{ row_id: 'NORTH', name: 'North', cluster_manager: null }],
    Department: [], 'Department Section': [], 'Store Floor': [],
    'dash.report_access': [
      { row_id: 'a1', report: 'vs', job: 'Store Manager' },
      { row_id: 'a2', report: 'sales', role: 'Dash Reader' },
    ],
    'dash.report_bundle': [], 'dash.report_bundle_member': [],
    'dash.business_role': [], 'dash.business_role_permission': [], 'dash.title_map': [], 'dash.role_assignment': [],
  }
}

function context(tables: Record<string, Row[]>, { user = 'mgr', roles = ['Report Access Manager'], payload = {} as unknown, peopleRoles = {} as Record<string, string[]> } = {}) {
  let n = 0
  const list = async (table: string, args: { filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number }) => {
    const rows = (tables[table] ?? []).filter(row => (args.filters ?? []).every(f => matches(row, f)))
    const start = args.limit_start ?? 0
    return rows.slice(start, start + (args.limit_page_length ?? 500))
  }
  return {
    user, roles, payload, userName: 'Manju Manager',
    reject(message: string): never { throw new Error(message) },
    baseTables: { list, available: async (table: string) => table in tables },
    documents: {
      list: async (table: string, args: { filters?: [string, string, unknown][] }) => table === 'dash.report'
        ? [{ report_key: 'vs', report_name: 'Vendor Sales', filter_shape: 'Stores and subcategories' }, { report_key: 'sales', report_name: 'Sales', filter_shape: 'One store and subcategories' }] : list(table, args),
      async create(table: string, values: Row) { const row = { row_id: `${table}-${++n}`, updated_at: '2026-11-17T00:00:00Z', ...values }; (tables[table] ??= []).push(row); return row },
      async update(table: string, values: Row) { const row = tables[table].find(r => r.row_id === values.row_id)!; Object.assign(row, values); return row },
    },
    people: {
      names: async (ids: string[]) => Object.fromEntries(ids.map(id => [id, null])),
      rolesOf: async (person: string) => peopleRoles[person] ?? ['Dash Reader'],
    },
  }
}

/** The world with the starting roles written, as a manager's first click writes them. */
async function seeded() {
  const tables = world()
  await addStartingRoles(context(tables) as never)
  return tables
}
const roleId = (tables: Record<string, Row[]>, name: string) => String(tables['dash.business_role'].find(r => r.role_name === name)!.row_id)

describe('the starting roles', () => {
  it('writes the twelve business roles once', async () => {
    const tables = await seeded()
    expect(tables['dash.business_role'].map(r => r.role_name)).toEqual(STARTING_ROLES.map(r => r.name))
  })

  it('refuses to write them again', async () => {
    const tables = await seeded()
    await expect(addStartingRoles(context(tables) as never)).rejects.toThrow('There are business roles already')
  })
})

describe('the Business Roles page', () => {
  it('reads each permission as a sentence with its reach', async () => {
    const page = await businessRoles(context(await seeded()) as never)
    expect(page.roles.find(r => r.name === 'Store Manager')!.permissions).toContainEqual({ app: 'Dash', level: 'Manager', reach: 'Area', sentence: 'Store Managers can Edit Sections in their Area' })
  })

  it('lists a designation nobody has mapped first, with how many hold it', async () => {
    const page = await businessRoles(context(await seeded()) as never)
    expect(page.titles[0]).toMatchObject({ title: 'Operations Executive', role: null, people: 1, falls_back_to: 'Store Manager' })
  })

  it('is refused to someone who does not manage report access', async () => {
    await expect(businessRoles(context(await seeded(), { roles: ['Team Report Manager'] }) as never)).rejects.toThrow('Only a Report Access Manager')
  })
})

describe('Explain a person', () => {
  it('gives a store manager whose title is not mapped Store Manager at their store, from the HR title', async () => {
    const answer = await explainPerson(context(await seeded(), { payload: { person: 'sm' } }) as never)
    expect(answer.roles.map(r => [r.name, r.source, r.area.parts.map(p => p.name)])).toEqual([['Store Manager', 'From HR title', ['Lakeside']]])
  })

  it('lists their apps and levels', async () => {
    const answer = await explainPerson(context(await seeded(), { payload: { person: 'sm' } }) as never)
    expect(answer.apps.map(a => `${a.app} · ${a.level}`)).toEqual(['Dash · Manager', 'Dash · Reader', 'Tasker · Manager', 'Tickets · User'])
  })

  it('gives a report given to their job, saying why', async () => {
    const answer = await explainPerson(context(await seeded(), { payload: { person: 'sm' } }) as never)
    expect(answer.reports).toEqual([{ key: 'vs', name: 'Vendor Sales', why: ['Given to Store Manager, for Lakeside'] }])
  })

  it('reads a category head\'s area as the category and region of their merchandise assignment', async () => {
    const answer = await explainPerson(context(await seeded(), { payload: { person: 'buy' } }) as never)
    expect(answer.roles.map(r => [r.name, r.source, r.area.parts.map(p => p.name)])).toEqual([['Category Head', 'From merchandise assignment', ['Sarees', 'East']]])
  })

  it('encodes a merchandise area as Dash\'s code prefixes', async () => {
    const answer = await explainPerson(context(await seeded(), { payload: { person: 'buy' } }) as never)
    expect(answer.roles[0].area.prefixes).toEqual(['010101'])
  })

  it('gives head office the whole company', async () => {
    const answer = await explainPerson(context(await seeded(), { payload: { person: 'ho' } }) as never)
    expect(answer.roles[0].area).toMatchObject({ parts: [{ name: 'Whole company' }], stores: 1, subcategories: null })
  })

  it('shows a role also given by hand, with its end date', async () => {
    const tables = await seeded()
    await giveRole(context(tables, { payload: { person: 'st', change: 'Also give', role: roleId(tables, 'Team Leader'), ends_on: '2999-03-31', reason: 'Covering' } }) as never)
    const answer = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
    expect(answer.roles.map(r => [r.name, r.source, r.until])).toEqual([['Staff', 'From HR title', null], ['Team Leader', 'Also given by hand', '2999-03-31']])
  })

  it('replaces the role from the title with a Correct', async () => {
    const tables = await seeded()
    await giveRole(context(tables, { payload: { person: 'ho', change: 'Correct', role: roleId(tables, 'Store Manager') } }) as never)
    const answer = await explainPerson(context(tables, { payload: { person: 'ho' } }) as never)
    expect(answer.roles.map(r => [r.name, r.source])).toEqual([['Store Manager', 'Corrected by hand']])
  })

  it('refuses an end date that has passed', async () => {
    const tables = await seeded()
    await expect(giveRole(context(tables, { payload: { person: 'st', change: 'Also give', role: roleId(tables, 'Team Leader'), ends_on: '2020-01-01' } }) as never)).rejects.toThrow('The end date has passed')
  })
})

describe('who would gain or lose access', () => {
  it('lists staff who hold Dash Reader today as losing Dash', async () => {
    const answer = await accessChanges(context(await seeded()) as never)
    expect(answer.groups.find(g => g.kind === 'loses_dash')!.people.map(p => p.person)).toEqual(['st'])
  })

  it('leaves out a store manager whose access stays the same', async () => {
    const tables = await seeded()
    tables['dash.report_access'] = [{ row_id: 'a1', report: 'vs', job: 'Store Manager' }]
    const answer = await accessChanges(context(tables) as never)
    expect(answer.groups.flatMap(g => g.people).map(p => p.person)).not.toContain('sm')
  })

  it('shows a report given only through Dash Reader as needing a decision', async () => {
    const tables = await seeded()
    tables['Section Subcategory'].push({ row_id: 'P2', store: 'LKS', section: 'S1', subcategory: '010101002', starts_on: '2026-01-01' })
    const answer = await accessChanges(context(tables) as never)
    const sm = answer.groups.flatMap(g => g.people).find(p => p.person === 'sm')!
    expect([sm.kind, sm.decisions.map(d => d.name), sm.lost]).toEqual(['decision', ['Sales'], []])
  })
})

describe('the shadow model decides nothing today', () => {
  /** What reportsFor and can_open answer for the staff member, as the platform hands them their reads. */
  async function todayFor(tables: Record<string, Row[]>) {
    const ctx = { ...context(tables, { user: 'st', roles: ['Dash Reader'] }), authorization: { places: [] } }
    return { reports: (await reportsFor(ctx as never)).map(r => r.report_key), opens: await reads.can_open(ctx as never) }
  }

  it('gives the same reports and the same front door whatever the business role Tables hold', async () => {
    const before = await todayFor(world())
    const tables = await seeded()
    await giveRole(context(tables, { payload: { person: 'st', change: 'Correct', role: roleId(tables, 'Staff') } }) as never)
    tables['dash.title_map'] = []
    expect(await todayFor(tables)).toEqual(before)
  })
})
