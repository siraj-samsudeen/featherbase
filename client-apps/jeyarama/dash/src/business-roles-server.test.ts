// #1218: the business roles in shadow, over in-memory Tables. Made-up stores and people.
import { describe, expect, it } from 'vitest'
import { accessChanges, addStartingRoles, businessRoles, explainPerson, giveRole, mapTitle } from './business-roles-server'
import { actions, reads, reportsFor } from './server'
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
    Subcategory: [{ row_id: '010101001', subcategory: 'Silk sarees', category: 'Sarees', subcategory_type: 'Merchandise' }, { row_id: '010101002', category: 'Sarees', subcategory_type: 'Merchandise' },
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
  // As the platform does: only the fields asked for come back, so a column the code forgets to ask for is missing here too.
  const list = async (table: string, args: { fields?: string[]; filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number }) => {
    const rows = (tables[table] ?? []).filter(row => (args.filters ?? []).every(f => matches(row, f)))
    const start = args.limit_start ?? 0
    const picked = rows.slice(start, start + (args.limit_page_length ?? 500))
    return args.fields?.length ? picked.map(row => Object.fromEntries(['row_id', ...args.fields!].filter(f => f in row).map(f => [f, row[f]]))) : picked
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
    expect(page.roles.find(r => r.name === 'Store Manager')!.permissions).toContainEqual({ app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Sections', reach: 'Area', sentence: 'Store Managers can Edit Sections in their Area' })
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

/** More people, one per route to a role: a floor, a department, a cluster by job and by name, two sections, a buyer, a head of everything, someone outside the staff list. */
async function richWorld() {
  const tables = await seeded()
  const employee = (row_id: string, name: string, person?: string) => tables.Employee.push({ row_id, name, employee_code: row_id, status: 'Current', ...(person ? { person } : {}) })
  const job = (row_id: string, emp: string, name: string, over: Row = {}) => tables['Job Assignment'].push({ row_id, employee: emp, job: name, site: 'LKS', starts_on: '2026-01-01', ...over })
  employee('E-FM', 'Farah', 'fm'); job('J-FM', 'E-FM', 'Floor Manager', { floor: 'F1' })
  employee('E-DM', 'Deepa', 'dm'); job('J-DM', 'E-DM', 'Department Manager')
  employee('E-CM', 'Asha', 'cm'); job('J-CM', 'E-CM', 'Cluster Manager')
  employee('E-CH', 'Kiran', 'ch'); tables.Cluster[0].cluster_manager = 'E-CH'
  employee('E-TL', 'Tara', 'tl'); job('J-TL1', 'E-TL', 'Team Leader', { section: 'S1' }); job('J-TL2', 'E-TL', 'Team Leader', { section: 'S2' })
  employee('E-MIX', 'Mohan', 'mix'); job('J-MIX1', 'E-MIX', 'Store Manager'); job('J-MIX2', 'E-MIX', 'Team Leader', { section: 'S1' })
  employee('E-B', 'Bala', 'b'); tables['Merchandise Assignment'].push({ row_id: 'M-B', employee: 'E-B', responsibility: 'Buyer', subcategory: '010101001', starts_on: '2026-01-01' })
  employee('E-ALL', 'Hari', 'all'); tables['Merchandise Assignment'].push({ row_id: 'M-ALL', employee: 'E-ALL', responsibility: 'Category head', starts_on: '2026-01-01' })
  employee('E-NONAME', '', 'noname'); job('J-NONAME', 'E-NONAME', 'Staff', { section: 'S1' })
  employee('E-NOSIGNIN', 'Lata'); job('J-NOSIGNIN', 'E-NOSIGNIN', 'Staff', { section: 'S1' })
  tables.Section.push({ row_id: 'S2', name: 'Silk', site: 'LKS', floor: 'F1' })
  tables['Section Subcategory'].push({ row_id: 'P2', store: 'LKS', section: 'S2', subcategory: '010101002', starts_on: '2026-01-01' })
  tables['Store Floor'].push({ row_id: 'F1', name: 'First floor', site: 'LKS' })
  tables['dash.report_bundle'].push({ row_id: 'b1', bundle_name: 'Store pack' })
  tables['dash.report_bundle_member'].push({ row_id: 'bm1', report_bundle: 'b1', report: 'open' })
  tables['dash.report_access'].push({ row_id: 'a3', report_bundle: 'b1', person: 'ext' }, { row_id: 'a4', report: 'vs', person: 'sm' })
  return tables
}
const OPEN = { report_key: 'open', report_name: 'Company notices', filter_shape: 'No filter' }
function richContext(tables: Record<string, Row[]>, options: Parameters<typeof context>[1] = {}) {
  const ctx = context(tables, { peopleRoles: { ext: [], ...options.peopleRoles }, ...options })
  const list = ctx.documents.list
  ctx.documents.list = async (table, args) => (table === 'dash.report' ? [...await list(table, args), OPEN] : list(table, args))
  return ctx
}
const explain = async (tables: Record<string, Row[]>, person: string) => explainPerson(richContext(tables, { payload: { person } }) as never)
const areaOf = async (tables: Record<string, Row[]>, person: string) => (await explain(tables, person)).roles.map(r => [r.name, r.area.parts.map(p => p.name).join(' · ')])

describe('areas on every route to a role', () => {
  it('reads a floor manager\'s area as their floor at their store', async () => {
    expect(await areaOf(await richWorld(), 'fm')).toEqual([['Floor Manager', 'First floor · Lakeside']])
  })

  it('reads a department manager\'s area as their department at their store', async () => {
    expect(await areaOf(await richWorld(), 'dm')).toEqual([['Department Manager', 'Their department · Lakeside']])
  })

  it('reads a cluster manager\'s area as the cluster of their store', async () => {
    expect(await areaOf(await richWorld(), 'cm')).toEqual([['Cluster Manager', 'North']])
  })

  it('reads a named cluster head\'s area as that cluster', async () => {
    expect((await explain(await richWorld(), 'ch')).roles.map(r => [r.name, r.source, r.area.parts[0].name, r.area.stores])).toEqual([['Cluster Manager', 'Named cluster head', 'North', 1]])
  })

  it('reads a team leader\'s two sections, each at their store', async () => {
    expect(await areaOf(await richWorld(), 'tl')).toEqual([['Team Leader', 'Sarees · Lakeside'], ['Team Leader', 'Silk · Lakeside']])
  })

  it('reads a buyer\'s subcategory with every region', async () => {
    expect(await areaOf(await richWorld(), 'b')).toEqual([['Buyer', 'Silk sarees · Every region']])
  })

  it('reads a head with no level named as every subcategory', async () => {
    expect(await areaOf(await richWorld(), 'all')).toEqual([['Category Head', 'Every subcategory · Every region']])
  })

  it('says a role corrected to Buyer at a job has no area there, and why', async () => {
    const tables = await richWorld()
    await giveRole(context(tables, { payload: { person: 'fm', change: 'Correct', role: roleId(tables, 'Buyer') } }) as never)
    expect(await areaOf(tables, 'fm')).toEqual([['Buyer', 'No area: Buyer reaches merchandise, and this person is named only in their job at Lakeside']])
  })

  it('says a Vendor given at a job, with no place named, has no area there, and why', async () => {
    const tables = await richWorld()
    await giveRole(context(tables, { payload: { person: 'fm', change: 'Also give', role: roleId(tables, 'Vendor') } }) as never)
    expect((await areaOf(tables, 'fm'))[1]).toEqual(['Vendor', 'No area: Vendor reaches the place it is given at, and this person is named only in their job at Lakeside'])
  })

  it('leaves out the parts of a job that names no site or section', async () => {
    const tables = await richWorld()
    tables['Job Assignment'].push({ row_id: 'J-BARE', employee: 'E-NOSIGNIN', job: 'Cluster Manager', starts_on: '2026-01-01' })
    tables.Employee.find(e => e.row_id === 'E-NOSIGNIN')!.person = 'bare'
    expect(await areaOf(tables, 'bare')).toEqual([['Staff', 'Sarees · Lakeside'], ['Cluster Manager', '']])
  })
})

describe('someone outside the staff list', () => {
  async function outsider() {
    const tables = await richWorld()
    await giveRole(context(tables, { payload: { person: 'ext', change: 'Also give', role: roleId(tables, 'Master Data Steward') } }) as never)
    return explain(tables, 'ext')
  }

  it('holds a whole-company role that reaches every store, though not on the staff list', async () => {
    expect((await outsider()).roles.map(r => [r.name, r.area.parts[0].name, r.area.stores])).toEqual([['Master Data Steward', 'Whole company', 1]])
  })

  it('gets a report given to them through a bundle, saying so', async () => {
    expect((await outsider()).reports).toEqual([{ key: 'open', name: 'Company notices', why: ['Given to them directly, through Store pack'] }])
  })

  it('opens Dash today by that report alone, and has no name or employee code', async () => {
    const answer = await outsider()
    expect([answer.today.opens, answer.next.opens, answer.name, answer.employee]).toEqual([true, true, 'This person', null])
  })
})

describe('Who would gain or lose access, on every route', () => {
  it('finds head office gaining every store', async () => {
    const answer = await accessChanges(richContext(await richWorld()) as never)
    const ho = answer.groups.flatMap(g => g.people).find(p => p.person === 'ho')!
    expect([ho.kind, ho.stores_gained.map(s => s.name)]).toEqual(['stores', ['Lakeside']])
  })

  it('names someone without a name as Someone', async () => {
    const answer = await accessChanges(richContext(await richWorld()) as never)
    expect(answer.groups.flatMap(g => g.people).find(p => p.person === 'noname')!.name).toBe('Someone')
  })

  it('finds a store manager who also leads a section waiting only on a decision', async () => {
    const answer = await accessChanges(richContext(await richWorld(), { peopleRoles: { mix: ['Dash Reader'] } }) as never)
    expect(answer.groups.flatMap(g => g.people).find(p => p.person === 'mix')?.kind).toBe('decision')
  })
})

describe('the Title Map on the Business Roles page', () => {
  it('counts a job held by someone who cannot sign in', async () => {
    const page = await businessRoles(richContext(await richWorld()) as never)
    expect(page.titles.find(t => t.title === 'Staff')!.people).toBe(3)
  })

  it('lists a role an admin added after the starting roles', async () => {
    const tables = await richWorld()
    tables['dash.business_role'].push({ row_id: 'r-z', role_name: 'Auditor' }, { row_id: 'r-y', role_name: 'Analyst' })
    const page = await businessRoles(richContext(tables) as never)
    expect(page.roles.slice(-2).map(r => r.name)).toEqual(['Analyst', 'Auditor'])
  })

  it('maps a title nobody had mapped', async () => {
    const tables = await richWorld()
    await mapTitle(context(tables, { payload: { title: 'Operations Executive', role: roleId(tables, 'Store Manager') } }) as never)
    const page = await businessRoles(richContext(tables) as never)
    expect(page.titles.find(t => t.title === 'Operations Executive')!.role_name).toBe('Store Manager')
  })

  it('changes a title already mapped', async () => {
    const tables = await richWorld()
    await mapTitle(context(tables, { payload: { title: 'staff', role: roleId(tables, 'Team Leader') } }) as never)
    expect(tables['dash.title_map'].find(r => r.title === 'Staff')!.business_role).toBe(roleId(tables, 'Team Leader'))
  })

  it.each([
    [{ title: '', role: 'x' }, 'Name the title'],
    [{ title: 'Tailor', role: 'gone' }, 'Choose a business role'],
  ])('refuses a mapping %o', async (payload, message) => {
    await expect(mapTitle(context(await richWorld(), { payload }) as never)).rejects.toThrow(message)
  })

  it('reads job titles alone where the instance has no designations', async () => {
    const tables = await richWorld()
    delete tables.Designation
    const page = await businessRoles(richContext(tables) as never)
    expect(page.titles.some(t => t.title === 'Operations Executive')).toBe(false)
  })

  it('keeps a title already mapped when the starting roles are added', async () => {
    const tables = world()
    tables['dash.title_map'].push({ row_id: 't0', title: 'staff', business_role: null })
    await addStartingRoles(context(tables) as never)
    expect(tables['dash.title_map'].filter(r => String(r.title).toLowerCase() === 'staff')).toHaveLength(1)
  })
})

describe('hand changes refused or taken away', () => {
  it.each([
    [{ change: 'Also give', role: 'r' }, 'Choose a person'],
    [{ person: 'st', change: 'Swap', role: 'r' }, 'Choose Correct or Also give'],
    [{ person: 'st', change: 'Also give', role: 'gone' }, 'Choose a business role'],
  ])('refuses %o', async (payload, message) => {
    await expect(giveRole(context(await seeded(), { payload }) as never)).rejects.toThrow(message)
  })

  it('refuses an end date that is not a day', async () => {
    const tables = await seeded()
    await expect(giveRole(context(tables, { payload: { person: 'st', change: 'Also give', role: roleId(tables, 'Staff'), ends_on: '31/03/2027' } }) as never)).rejects.toThrow('The end date is a day')
  })

  it('refuses to explain no one', async () => {
    await expect(explainPerson(context(await seeded(), { payload: {} }) as never)).rejects.toThrow('Choose a person')
  })

  it('takes a hand change away, through Dash\'s own action', async () => {
    const tables = await seeded()
    const { id } = await giveRole(context(tables, { payload: { person: 'st', change: 'Also give', role: roleId(tables, 'Team Leader') } }) as never)
    await actions.remove_role(context(tables, { payload: { id, updated_at: '2026-11-17T00:00:00Z' } }) as never)
    expect((await explain(tables, 'st')).roles.map(r => r.name)).toEqual(['Staff'])
  })

  it('refuses to take away a hand change it is not told of', async () => {
    await expect(actions.remove_role(context(await seeded(), { payload: {} }) as never)).rejects.toThrow('Choose a hand change to remove')
  })
})

describe('Dash\'s reads and actions for the shadow pages', () => {
  it('shows the pages to a Report Access Manager only', async () => {
    const tables = await seeded()
    expect([reads.manages_roles(context(tables) as never), reads.manages_roles(context(tables, { roles: ['Team Report Manager'] }) as never)]).toEqual([true, false])
  })

  it('answers each read and action through the server module', async () => {
    const tables = world()
    await actions.add_starting_roles(context(tables) as never)
    await actions.give_role(context(tables, { payload: { person: 'st', change: 'Also give', role: roleId(tables, 'Team Leader') } }) as never)
    await actions.map_title(context(tables, { payload: { title: 'Tailor', role: roleId(tables, 'Staff') } }) as never)
    const answers = await Promise.all([reads.business_roles(context(tables) as never), reads.explain_person(context(tables, { payload: { person: 'st' } }) as never), reads.access_changes(context(tables) as never)])
    expect(answers.map(a => typeof a)).toEqual(['object', 'object', 'object'])
  })
})

describe('both sides judged by the live rules (Codex adversarial round 1)', () => {
  const WHOLE = { report_key: 'whole', report_name: 'Store target', filter_shape: 'Whole stores' }
  async function withWholeReport(grant: Row) {
    const tables = await seeded()
    tables.Employee.push({ row_id: 'E-TL', name: 'Tara', employee_code: 'E-TL', status: 'Current', person: 'tl' })
    tables['Job Assignment'].push({ row_id: 'J-TL', employee: 'E-TL', job: 'Team Leader', site: 'LKS', section: 'S1', starts_on: '2026-01-01' })
    tables['dash.report_access'] = [grant]
    const ctx = context(tables, { peopleRoles: { tl: [], sm: ['Dash Reader'], st: [], ho: [], buy: [] } })
    const list = ctx.documents.list
    ctx.documents.list = async (table, args) => (table === 'dash.report' ? [...await list(table, args), WHOLE] : list(table, args))
    return { tables, ctx }
  }
  const kindOf = async (ctx: unknown, person: string) => (await accessChanges(ctx as never)).groups.flatMap(g => g.people).find(p => p.person === person)?.kind ?? null

  it('finds a section-only Team Leader given a whole-stores report, closed today, gaining Dash by their role', async () => {
    const { ctx } = await withWholeReport({ row_id: 'g', report: 'whole', person: 'tl' })
    expect(await kindOf(ctx, 'tl')).toBe('gains_dash')
  })

  it('leaves out a store manager given a whole-stores report through their job, the same in both', async () => {
    const { ctx } = await withWholeReport({ row_id: 'g', report: 'whole', job: 'Store Manager' })
    expect(await kindOf(ctx, 'sm')).toBeNull()
  })

  it('agrees with can_open: the Team Leader\'s front door stays shut today', async () => {
    const { tables } = await withWholeReport({ row_id: 'g', report: 'whole', person: 'tl' })
    const reader = { ...context(tables, { user: 'tl', roles: [] }), authorization: { places: [] } }
    const list = reader.documents.list
    reader.documents.list = async (table, args) => (table === 'dash.report' ? [WHOLE] : list(table, args))
    expect(await reads.can_open(reader as never)).toBe(false)
  })
})

describe('one comparison per person, drawn by both pages (verifier round 1)', () => {
  const kinds = async (tables: Record<string, Row[]>, person: string, roles: Record<string, string[]> = {}) =>
    (await accessChanges(context(tables, { peopleRoles: roles }) as never)).groups.filter(g => g.people.some(p => p.person === person)).map(g => g.kind)

  it('shows head office, who opens Dash today and reaches nothing, reaching every store in both pages', async () => {
    const tables = await seeded()
    const explained = await explainPerson(context(tables, { payload: { person: 'ho' } }) as never)
    expect([explained.today, explained.change.kinds, explained.change.stores_gained.map(s => s.name), await kinds(tables, 'ho')])
      .toEqual([{ opens: true, reports: 0, stores: 0 }, ['stores'], ['Lakeside'], ['stores']])
  })

  it('lists under Needs A Decision only reports that reach the person today', async () => {
    const explained = await explainPerson(context(await seeded(), { payload: { person: 'ho' } }) as never)
    expect(explained.change.decisions).toEqual([])
  })

  it('never lists a report both as Would Get and as Needs A Decision, before or after a Correct', async () => {
    const tables = await seeded()
    const before = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
    await giveRole(context(tables, { payload: { person: 'st', change: 'Correct', role: roleId(tables, 'Store Manager'), site: 'LKS' } }) as never)
    const after = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
    expect([before.change.decisions.map(d => d.name), after.reports.map(r => r.name), after.change.decisions.map(d => d.name), after.roles[0].area.parts.map(p => p.name)])
      .toEqual([['Sales'], ['Vendor Sales'], ['Sales'], ['Lakeside']])
  })

  it('puts someone in every group that applies', async () => {
    expect(await kinds(await seeded(), 'st')).toEqual(['loses_dash', 'stores', 'decision'])
  })

  it('refuses a place that is not a store', async () => {
    const tables = await seeded()
    await expect(giveRole(context(tables, { payload: { person: 'st', change: 'Correct', role: roleId(tables, 'Store Manager'), site: 'HOF' } }) as never)).rejects.toThrow('Choose a store')
  })

  it('offers every store as a place, their job\'s first by default', async () => {
    const explained = await explainPerson(context(await seeded(), { payload: { person: 'sm' } }) as never)
    expect([explained.places, explained.hr_titles, explained.header.sites.map(s => s.name)]).toEqual([{ stores: [{ id: 'LKS', name: 'Lakeside' }], default: 'LKS' }, ['Operations Executive'], ['Lakeside']])
  })
})

describe('Codex adversarial round 2 and standard review on 296fa29fc', () => {
  it('finds a Store Manager holding Report Access Manager but no reader role gaining their job\'s reports', async () => {
    expect((await accessChanges(context(await seeded(), { peopleRoles: { sm: ['Report Access Manager'] } }) as never)).groups.find(g => g.kind === 'reports')!.people.map(p => [p.person, p.gained.map(r => r.name)]))
      .toContainEqual(['sm', ['Vendor Sales']])
  })

  it('leaves out floor staff with no Dash on either side', async () => {
    expect((await accessChanges(context(await seeded(), { peopleRoles: { st: [] } }) as never)).groups.flatMap(g => g.people).map(p => p.person)).not.toContain('st')
  })

  it('covers a leaver who still holds Dash Reader, and someone outside the staff list given a report', async () => {
    const tables = await seeded()
    tables.Employee.push({ row_id: 'E-GONE', name: 'Gopal', employee_code: 'E-GONE', status: 'Left', person: 'gone' })
    tables['dash.report_access'].push({ row_id: 'a9', report: 'vs', person: 'outsider' })
    const answer = await accessChanges(context(tables, { peopleRoles: { gone: ['Dash Reader'], outsider: ['Dash Reader'] } }) as never)
    expect([answer.people, answer.groups.find(g => g.kind === 'loses_dash')!.people.map(p => p.person)]).toEqual([6, ['gone', 'st', 'outsider']])
  })

  it('gives a buyer named only on a Buyer Section the Buyer role there, with its stores', async () => {
    const tables = await seeded()
    tables.Employee.push({ row_id: 'E-BS', name: 'Usha', employee_code: 'E-BS', status: 'Current', person: 'bs' })
    tables['Buyer Section'] = [{ row_id: 'BS-1', name: 'Silk section', operating_region: 'East', buyer: 'E-BS', starts_on: '2026-01-01' }]
    tables['Buyer Section Subcategory'] = [{ row_id: 'BL-1', buyer_section: 'BS-1', subcategory: '010101001', starts_on: '2026-01-01' }]
    const explained = await explainPerson(context(tables, { payload: { person: 'bs' } }) as never)
    expect([explained.roles.map(r => [r.name, r.source, r.area.parts.map(p => p.name), r.area.stores]), explained.change.kinds])
      .toEqual([[['Buyer', 'Buyer on a Buyer Section', ['Silk section'], 1]], ['decision']])
  })
})

describe('the places a hand change may name', () => {
  it('lists every store by name, with someone outside the staff list given no default', async () => {
    const tables = await seeded()
    tables.Site.push({ row_id: 'HIL', name: 'Hillview', is_store: true })
    const explained = await explainPerson(context(tables, { payload: { person: 'nobody' } }) as never)
    expect(explained.places).toEqual({ stores: [{ id: 'HIL', name: 'Hillview' }, { id: 'LKS', name: 'Lakeside' }], default: null })
  })
})

describe('Codex round 3 on 70c47d3c4', () => {
  it('names who they report to in the header, read from their job', async () => {
    const tables = await seeded()
    tables['Job Assignment'].find(j => j.row_id === 'J-ST')!.reports_to = 'E-SM'
    const explained = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
    expect(explained.header.reports_to).toEqual([{ name: 'Selvi', table: 'Employee', id: 'E-SM', code: 'E-SM' }])
  })

  it('says Dash opens today for someone offered a filtered report without a reader role, as can_open does', async () => {
    const tables = await seeded()
    tables['dash.report_access'] = [{ row_id: 'g', report: 'vs', person: 'sm' }]
    const answer = await accessChanges(context(tables, { peopleRoles: { sm: [] } }) as never)
    expect(answer.groups.find(g => g.kind === 'gains_dash')!.people.map(p => p.person)).not.toContain('sm')
  })

  it('applies a store given by Also give to someone with no job there, as its own area', async () => {
    const tables = await seeded()
    await giveRole(context(tables, { payload: { person: 'outsider', change: 'Also give', role: roleId(tables, 'Store Manager'), site: 'LKS' } }) as never)
    const role = (await explainPerson(context(tables, { payload: { person: 'outsider' } }) as never)).roles[0]
    expect([role.area.parts.map(p => p.name), role.area.stores, role.area.subcategories]).toEqual([['Lakeside'], 1, null])
  })

  it('applies a store given by Correct to someone with no job there, as its own area', async () => {
    const tables = await seeded()
    await giveRole(context(tables, { payload: { person: 'buy', change: 'Correct', role: roleId(tables, 'Store Manager'), site: 'LKS' } }) as never)
    const roles = (await explainPerson(context(tables, { payload: { person: 'buy' } }) as never)).roles
    expect(roles.filter(r => r.source === 'Corrected by hand').map(r => [r.area.parts.map(p => p.name), r.area.stores])).toEqual([[['Lakeside'], 1]])
  })
})

describe('Dash\'s own records open on Dash\'s own pages (verifier on 70c47d3c4)', () => {
  const refs = [{ table: 'dash.business_role', id: 'r' }, { table: 'dash.report_bundle', id: 'b' }, { table: 'dash.report', id: 'vs' }, { table: 'dash.report', id: 'sales' }, { table: 'Section', id: 'S9' }]
  const ask = async (user: string, roles: string[]) => {
    const tables = await seeded()
    tables['dash.report_access'] = [{ row_id: 'g', report: 'vs', person: user }]
    return reads.dash_pages_open({ ...context(tables, { user, roles, payload: { refs } }), settings: {} } as never)
  }

  it('lets a Report Access Manager open business roles and bundles, and a report they are offered', async () => {
    expect(await ask('sm', ['Report Access Manager'])).toEqual([true, true, true, false, false])
  })

  it('leaves business roles and bundles plain words for anyone else, and a report they are not offered', async () => {
    expect(await ask('st', ['Dash Reader'])).toEqual([false, false, true, false, false])
  })
})

describe('Codex adversarial round 4 on 1233e3d8c', () => {
  async function leader() {
    const tables = await seeded()
    tables['dash.report_access'] = [{ row_id: 'g', report: 'vs', person: 'ext' }]
    await giveRole(context(tables, { payload: { person: 'ext', change: 'Also give', role: roleId(tables, 'Leadership') } }) as never)
    return tables
  }

  it('gives someone outside the staff list holding Leadership every store and a filtered report given to them, in Explain', async () => {
    const explained = await explainPerson(context(await leader(), { payload: { person: 'ext' }, peopleRoles: { ext: [] } }) as never)
    expect([explained.next, explained.reports.map(r => r.name), explained.change.stores_gained.map(s => s.name)])
      .toEqual([{ opens: true, reports: 1, stores: 1 }, ['Vendor Sales'], ['Lakeside']])
  })

  it('lists the same person gaining Dash, every store and the report, on the comparison', async () => {
    const row = (await accessChanges(context(await leader(), { peopleRoles: { ext: [] } }) as never)).groups.flatMap(g => g.people).find(p => p.person === 'ext')!
    expect([row.kinds, row.stores_gained.map(s => s.name), row.gained.map(r => r.name)]).toEqual([['gains_dash', 'stores', 'reports'], ['Lakeside'], ['Vendor Sales']])
  })
})

describe('reach as data on the role (Codex standard review round 4 on 1233e3d8c)', () => {
  it('keeps a store manager\'s area when their role is renamed, on Explain', async () => {
    const tables = await seeded()
    tables['dash.business_role'].find(r => r.role_name === 'Store Manager')!.role_name = 'Store Head'
    const role = (await explainPerson(context(tables, { payload: { person: 'sm' } }) as never)).roles[0]
    expect([role.name, role.area.parts.map(p => p.name), role.area.stores]).toEqual(['Store Head', ['Lakeside'], 1])
  })

  it('keeps a renamed store manager out of the comparison, as before the rename', async () => {
    const tables = await seeded()
    tables['dash.report_access'] = [{ row_id: 'a1', report: 'vs', job: 'Store Manager' }]
    tables['dash.business_role'].find(r => r.role_name === 'Store Manager')!.role_name = 'Store Head'
    expect((await accessChanges(context(tables) as never)).groups.flatMap(g => g.people).map(p => p.person)).not.toContain('sm')
  })

  it('gives a category head mapped to Leadership every store', async () => {
    const tables = await seeded()
    tables['dash.title_map'].find(r => r.title === 'Category head')!.business_role = roleId(tables, 'Leadership')
    const role = (await explainPerson(context(tables, { payload: { person: 'buy' } }) as never)).roles[0]
    expect([role.name, role.area.parts.map(p => p.name), role.area.stores, role.area.subcategories]).toEqual(['Leadership', ['Whole company'], 1, null])
  })

  it('says in plain words how far each role reaches, and that a role added without it has none set', async () => {
    const tables = await seeded()
    tables['dash.business_role'].push({ row_id: 'r-x', role_name: 'Auditor' })
    const page = await businessRoles(context(tables) as never)
    expect(['Store Manager', 'Category Head', 'Leadership', 'Vendor', 'Auditor'].map(n => page.roles.find(r => r.name === n)!.reaches))
      .toEqual(['their store', 'their merchandise', 'the whole company', 'the place it is given at', 'Not set'])
  })
})

describe('every source asks the role\'s Reaches, with stores outside the first area (Codex adversarial round 5)', () => {
  async function twoStores() {
    const tables = await seeded()
    tables.Site.push({ row_id: 'HIL', name: 'Hillview', is_store: true, cluster: 'SOUTH', operating_region: 'West' })
    tables.Plant.push({ row_id: '9902', site: 'HIL', plant_type: 'Store' })
    tables.Cluster.push({ row_id: 'SOUTH', name: 'South', cluster_manager: null })
    tables.Employee.push({ row_id: 'E-X', name: 'Xavier', employee_code: 'E-X', status: 'Current', person: 'x' })
    return tables
  }
  const remap = (tables: Record<string, Row[]>, title: string) => { tables['dash.title_map'].find(r => r.title === title)!.business_role = roleId(tables, 'Leadership') }

  it('gives a named head of North every store, Hillview in the South too, when Cluster Manager maps to Leadership', async () => {
    const tables = await twoStores()
    tables.Cluster[0].cluster_manager = 'E-X'
    remap(tables, 'Cluster Manager')
    const role = (await explainPerson(context(tables, { payload: { person: 'x' } }) as never)).roles[0]
    expect([role.name, role.area.parts.map(p => p.name), role.area.stores]).toEqual(['Leadership', ['Whole company'], 2])
  })

  it('gives a Buyer Section\'s buyer in the East every store, Hillview in the West too, when Buyer maps to Leadership', async () => {
    const tables = await twoStores()
    tables['Buyer Section'] = [{ row_id: 'BS-1', name: 'Silk section', operating_region: 'East', buyer: 'E-X', starts_on: '2026-01-01' }]
    tables['Buyer Section Subcategory'] = [{ row_id: 'BL-1', buyer_section: 'BS-1', subcategory: '010101001', starts_on: '2026-01-01' }]
    remap(tables, 'Buyer')
    const role = (await explainPerson(context(tables, { payload: { person: 'x' } }) as never)).roles[0]
    expect([role.name, role.area.parts.map(p => p.name), role.area.stores]).toEqual(['Leadership', ['Whole company'], 2])
  })
})

describe('a role given by hand only, on the Title Map (Codex standard round 5)', () => {
  it('refuses to map a title to it, saying why', async () => {
    const tables = await seeded()
    await expect(mapTitle(context(tables, { payload: { title: 'Staff', role: roleId(tables, 'Master Data Steward') } }) as never)).rejects.toThrow('Master Data Steward is given by hand only')
  })

  it('lists a title already mapped to it as not mapped yet', async () => {
    const tables = await seeded()
    tables['dash.title_map'].find(r => r.title === 'Staff')!.business_role = roleId(tables, 'Master Data Steward')
    const page = await businessRoles(context(tables) as never)
    expect(page.titles.find(t => t.title === 'Staff')).toMatchObject({ role: null, people: 1 })
  })
})

describe('every source gives only the area its role\'s Reaches allows (Codex round 6)', () => {
  it('leaves a named cluster head unresolved, on both pages, once Cluster Manager reaches one store', async () => {
    const tables = await seeded()
    tables.Employee.push({ row_id: 'E-X', name: 'Xavier', employee_code: 'E-X', status: 'Current', person: 'x' })
    tables.Cluster[0].cluster_manager = 'E-X'
    tables['dash.business_role'].find(r => r.role_name === 'Cluster Manager')!.reaches = 'Store'
    const role = (await explainPerson(context(tables, { payload: { person: 'x' } }) as never)).roles[0]
    const row = (await accessChanges(context(tables) as never)).groups.flatMap(g => g.people).find(p => p.person === 'x')!
    expect([role.area.parts.map(p => p.name), role.area.stores, row.kinds.includes('stores'), row.stores_lost.map(s => s.name)])
      .toEqual([['No area: Cluster Manager reaches one store, and this person is named only as head of the North cluster'], 0, true, ['Lakeside']])
  })

  it('takes Also give Category Head from their merchandise assignments, not their job', async () => {
    const tables = await seeded()
    tables['Merchandise Assignment'].push({ row_id: 'M-SM', employee: 'E-SM', responsibility: 'Unmapped section', category: 'Sarees', operating_region: 'East', starts_on: '2026-01-01' })
    await giveRole(context(tables, { payload: { person: 'sm', change: 'Also give', role: roleId(tables, 'Category Head') } }) as never)
    const roles = (await explainPerson(context(tables, { payload: { person: 'sm' } }) as never)).roles
    expect(roles.find(r => r.name === 'Category Head')!.area.parts.map(p => p.name)).toEqual(['Sarees', 'East'])
  })

  it('leaves Team Leader given at a store to someone with no job unresolved: a store is not a section', async () => {
    const tables = await seeded()
    await giveRole(context(tables, { payload: { person: 'outsider', change: 'Also give', role: roleId(tables, 'Team Leader'), site: 'LKS' } }) as never)
    const role = (await explainPerson(context(tables, { payload: { person: 'outsider' } }) as never)).roles[0]
    expect([role.area.parts.map(p => p.name), role.area.stores]).toEqual([['No area: Team Leader reaches one section, and this person is named only at Lakeside'], 0])
  })

  it('names a merchandise source and a Buyer Section source when their role reaches a store', async () => {
    const tables = await seeded()
    tables['dash.title_map'].find(r => r.title === 'Category head')!.business_role = roleId(tables, 'Store Manager')
    tables['dash.title_map'].find(r => r.title === 'Buyer')!.business_role = roleId(tables, 'Store Manager')
    tables.Employee.push({ row_id: 'E-BS', name: 'Usha', employee_code: 'E-BS', status: 'Current', person: 'bs' })
    tables['Buyer Section'] = [{ row_id: 'BS-1', name: 'Silk section', operating_region: 'East', buyer: 'E-BS', starts_on: '2026-01-01' }]
    tables['Buyer Section Subcategory'] = [{ row_id: 'BL-1', buyer_section: 'BS-1', subcategory: '010101001', starts_on: '2026-01-01' }]
    const words = async (person: string) => (await explainPerson(context(tables, { payload: { person } }) as never)).roles[0].area.parts[0].name
    expect([await words('buy'), await words('bs')]).toEqual([
      'No area: Store Manager reaches one store, and this person is named only in a merchandise assignment',
      'No area: Store Manager reaches one store, and this person is named only as a buyer on a Buyer Section'])
  })

  it('says a role added without Reaches reaches nothing yet', async () => {
    const tables = await seeded()
    tables['dash.business_role'].push({ row_id: 'r-x', role_name: 'Auditor' })
    await giveRole(context(tables, { payload: { person: 'st', change: 'Also give', role: 'r-x' } }) as never)
    const role = (await explainPerson(context(tables, { payload: { person: 'st' } }) as never)).roles.find(r => r.name === 'Auditor')!
    expect(role.area.parts[0].name).toBe('No area: Auditor reaches nothing yet: its Reaches is not set, and this person is named only in their job at Lakeside')
  })
})

describe('a hand change with nowhere to apply', () => {
  it('reads No area yet for a store role given to someone with no job, no merchandise and no store named', async () => {
    const tables = await seeded()
    await giveRole(context(tables, { payload: { person: 'outsider', change: 'Also give', role: roleId(tables, 'Store Manager') } }) as never)
    expect((await explainPerson(context(tables, { payload: { person: 'outsider' } }) as never)).roles[0].area.parts.map(p => p.name)).toEqual(['No area yet'])
  })

  it('records no giver\'s name when the platform gives none', async () => {
    const tables = await seeded()
    const ctx = { ...context(tables, { payload: { person: 'st', change: 'Also give', role: roleId(tables, 'Team Leader') } }), userName: undefined }
    await giveRole(ctx as never)
    expect(tables['dash.role_assignment'].at(-1)!.given_by_name).toBeNull()
  })
})
