// #1218: the business roles in shadow, over in-memory Tables. Made-up stores and people.
import { describe, expect, it } from 'vitest'
import { accessChanges, addStartingRoles, businessRoles, explainPerson, giveRole, mapTitle } from './business-roles-server'
import { actions, reads, reportsFor } from './server'
import { STARTING_ROLES } from './starting-roles'
import { convertGrants } from './switch-over'
import { whoIs } from './report-access-server'
import { liveReach } from './access-source'
import { SITE_KINDS, openStore, siteStoreFields } from './site-kind'
import { scopeProviders } from './server'
import { personShadow, placesByStore, shadowWorld } from './business-roles-server'
import { businessModel } from './business-access'
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
    // A column is there when a row carries it, as the instance's Table has it or not (#1280).
    baseTables: { list, available: async (table: string, columns: readonly string[] = []) => table in tables && columns.every(c => tables[table].some(row => c in row)) },
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
/** #1277: the old grants also given to business roles, as the switch-over gives them (without setting the switch). */
async function converted(tables: Record<string, Row[]>) {
  const ctx = context(tables)
  const { model } = await businessModel(ctx.baseTables as never, today)
  await convertGrants(ctx.baseTables as never, ctx.documents as never, model, async () => true)
  return tables
}
const roleId = (tables: Record<string, Row[]>, name: string) => String(tables['dash.business_role'].find(r => r.role_name === name)!.row_id)

describe('the starting roles', () => {
  it('writes the starting business roles once', async () => {
    const tables = await seeded()
    expect(tables['dash.business_role'].map(r => r.role_name)).toEqual(STARTING_ROLES.map(r => r.name))
  })

  // #1277: the button is harmless once the roles are there: a second click adds nothing and changes nothing.
  it('adds nothing the second time', async () => {
    const tables = await seeded()
    const before = JSON.stringify(tables)
    expect(await addStartingRoles(context(tables) as never)).toEqual({ roles: 0, titles: 0 })
    expect(JSON.stringify(tables)).toBe(before)
  })
})

describe('the Business Roles page', () => {
  it('reads each permission as a sentence with its reach', async () => {
    const page = await businessRoles(context(await seeded()) as never)
    expect(page.roles.find(r => r.name === 'Store Manager')!.permissions).toContainEqual({ app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Section names and subcategories', reach: 'Area', sentence: 'Store Managers can Edit Section names and subcategories in their Area' })
    // Owner, 18-Nov-2026: managers see their team's tickets; Head Office opens no Dash by default.
    expect(page.roles.find(r => r.name === 'Store Manager')!.permissions.find(p => p.app === 'Tickets')!.sentence).toBe('Store Managers can View Tickets for their Team')
    expect(page.roles.find(r => r.name === 'Head Office')!.permissions.map(p => p.app)).toEqual(['Tasker', 'Tickets'])
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
    expect(answer.apps.map(a => `${a.app} · ${a.level}`)).toEqual(['Dash · Manager', 'Dash · Reader', 'Tasker · Manager', 'Tickets · Manager'])
  })

  it('gives a report given to their job, once the switch-over has given it to the role, saying why', async () => {
    const answer = await explainPerson(context(await converted(await seeded()), { payload: { person: 'sm' } }) as never)
    // Sales was given to Dash Reader: the switch-over gives it to every role that opens Dash, Store Manager among them.
    expect(answer.reports).toEqual([{ key: 'sales', name: 'Sales', why: ['Given to Store Manager, for Lakeside'] }, { key: 'vs', name: 'Vendor Sales', why: ['Given to Store Manager, for Lakeside'] }])
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
  it('lists staff and head office who hold Dash Reader today as losing Dash', async () => {
    const answer = await accessChanges(context(await seeded()) as never)
    expect(answer.groups.find(g => g.kind === 'loses_dash')!.people.map(p => p.person)).toEqual(['ho', 'st'])
  })

  it('leaves out a store manager whose access stays the same', async () => {
    const tables = await seeded()
    tables['dash.report_access'] = [{ row_id: 'a1', report: 'vs', job: 'Store Manager' }]
    await converted(tables)
    const answer = await accessChanges(context(tables) as never)
    expect(answer.groups.flatMap(g => g.people).map(p => p.person)).not.toContain('sm')
  })

  // #1277: before the switch-over, a grant to a job gives nothing under business roles, and the comparison says so.
  it('shows a report given to a job as lost until the switch-over gives it to the role', async () => {
    const tables = await seeded()
    tables['dash.report_access'] = [{ row_id: 'a1', report: 'vs', job: 'Store Manager' }]
    const sm = (await accessChanges(context(tables) as never)).groups.flatMap(g => g.people).find(p => p.person === 'sm')!
    expect(sm.lost.map(r => r.name)).toEqual(['Vendor Sales'])
  })

  it('shows a report given only through Dash Reader as needing a decision', async () => {
    const tables = await seeded()
    tables['Section Subcategory'].push({ row_id: 'P2', store: 'LKS', section: 'S1', subcategory: '010101002', starts_on: '2026-01-01' })
    const answer = await accessChanges(context(tables) as never)
    const sm = answer.groups.flatMap(g => g.people).find(p => p.person === 'sm')!
    expect([sm.kinds.includes('decision'), sm.decisions.map(d => d.name), sm.lost.map(r => r.name)]).toEqual([true, ['Sales'], ['Vendor Sales']])
    // Once the switch-over has given Dash Reader's report to the roles that open Dash, nothing waits on a decision.
    await converted(tables)
    const after = (await accessChanges(context(tables) as never)).groups.flatMap(g => g.people).find(p => p.person === 'sm')
    expect(after?.decisions ?? []).toEqual([])
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
    await giveRole(context(tables, { payload: { person: 'fm', change: 'Also give', role: roleId(tables, 'Supplier') } }) as never)
    expect((await areaOf(tables, 'fm'))[1]).toEqual(['Supplier', 'No area: Supplier reaches the place it is given at, and this person is named only in their job at Lakeside'])
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
    await giveRole(context(tables, { payload: { person: 'ext', change: 'Also give', role: roleId(tables, 'Master Data Manager') } }) as never)
    return explain(tables, 'ext')
  }

  it('holds a whole-company role that reaches every store, though not on the staff list', async () => {
    expect((await outsider()).roles.map(r => [r.name, r.area.parts[0].name, r.area.stores])).toEqual([['Master Data Manager', 'Whole company', 1]])
  })

  it('gets a report given to them through a bundle, saying so', async () => {
    expect((await outsider()).reports).toEqual([{ key: 'open', name: 'Company notices', why: ['Given to them directly, through Store pack'] }])
  })

  // #1277: a report alone opens no door: the platform lets into Dash only someone holding one of its roles, on either side.
  it('opens Dash on neither side by that report alone, and has no name or employee code', async () => {
    const answer = await outsider()
    expect([answer.today.opens, answer.next.opens, answer.name, answer.employee]).toEqual([false, false, 'This person', null])
  })
})

describe('Who would gain or lose access, on every route', () => {
  // Owner, 18-Nov-2026: Head Office opens no Dash by default.
  it('finds head office, holding Dash Reader today, losing Dash', async () => {
    const answer = await accessChanges(richContext(await richWorld()) as never)
    const ho = answer.groups.flatMap(g => g.people).find(p => p.person === 'ho')!
    expect(ho.kinds).toEqual(['loses_dash'])
  })

  it('names someone without a name as Someone', async () => {
    const answer = await accessChanges(richContext(await richWorld()) as never)
    expect(answer.groups.flatMap(g => g.people).find(p => p.person === 'noname')!.name).toBe('Someone')
  })

  it('finds a store manager who also leads a section waiting only on a decision', async () => {
    const answer = await accessChanges(richContext(await richWorld(), { peopleRoles: { mix: ['Dash Reader'] } }) as never)
    expect(answer.groups.flatMap(g => g.people).find(p => p.person === 'mix')?.kinds).toContain('decision')
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

  it('finds a section-only Team Leader with no Dash role, whose business role would open Dash, needing a Dash role', async () => {
    const { ctx } = await withWholeReport({ row_id: 'g', report: 'whole', person: 'tl' })
    expect(await kindOf(ctx, 'tl')).toBe('needs_dash_role')
  })

  it('leaves out a store manager given a whole-stores report through their job, the same in both', async () => {
    const { ctx, tables } = await withWholeReport({ row_id: 'g', report: 'whole', job: 'Store Manager' })
    await converted(tables)
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

  it('shows head office, who opens Dash today and reaches nothing, losing Dash in both pages', async () => {
    const tables = await seeded()
    const explained = await explainPerson(context(tables, { payload: { person: 'ho' } }) as never)
    expect([explained.today, explained.change.kinds, await kinds(tables, 'ho')])
      .toEqual([{ opens: true, reports: 0, stores: 0 }, ['loses_dash'], ['loses_dash']])
  })

  it('lists under Needs A Decision only reports that reach the person today', async () => {
    const explained = await explainPerson(context(await seeded(), { payload: { person: 'ho' } }) as never)
    expect(explained.change.decisions).toEqual([])
  })

  it('never lists a report both as Would Get and as Needs A Decision, before or after a Correct', async () => {
    const tables = await seeded()
    const overlap = (answer: Awaited<ReturnType<typeof explainPerson>>) => answer.reports.filter(r => answer.change.decisions.some(d => d.name === r.name))
    const before = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
    await giveRole(context(tables, { payload: { person: 'st', change: 'Correct', role: roleId(tables, 'Store Manager'), site: 'LKS' } }) as never)
    const after = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
    await converted(tables)
    const switched = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
    expect([before.change.decisions.map(d => d.name), after.change.decisions.map(d => d.name), after.roles[0].area.parts.map(p => p.name), overlap(before), overlap(after)])
      .toEqual([['Sales'], ['Sales'], ['Lakeside'], [], []])
    // After the switch-over gives the old grants to roles, the corrected Store Manager gets both, and nothing waits on a decision.
    expect([switched.reports.map(r => r.name), switched.change.decisions]).toEqual([['Sales', 'Vendor Sales'], []])
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
  // #1277: on both sides a filtered report also needs a reader role, which the platform asks on the report reads.
  it('gives a Store Manager holding Report Access Manager but no reader role no filtered report on either side', async () => {
    expect((await accessChanges(context(await converted(await seeded()), { peopleRoles: { sm: ['Report Access Manager'] } }) as never)).groups.find(g => g.kind === 'reports')!.people.map(p => p.person))
      .not.toContain('sm')
  })

  it('leaves out floor staff with no Dash on either side', async () => {
    expect((await accessChanges(context(await seeded(), { peopleRoles: { st: [] } }) as never)).groups.flatMap(g => g.people).map(p => p.person)).not.toContain('st')
  })

  it('covers a leaver who still holds Dash Reader, and someone outside the staff list given a report', async () => {
    const tables = await seeded()
    tables.Employee.push({ row_id: 'E-GONE', name: 'Gopal', employee_code: 'E-GONE', status: 'Left', person: 'gone' })
    tables['dash.report_access'].push({ row_id: 'a9', report: 'vs', person: 'outsider' })
    const answer = await accessChanges(context(tables, { peopleRoles: { gone: ['Dash Reader'], outsider: ['Dash Reader'] } }) as never)
    expect([answer.people, answer.groups.find(g => g.kind === 'loses_dash')!.people.map(p => p.person)]).toEqual([6, ['gone', 'ho', 'st', 'outsider']])
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
    await giveRole(context(tables, { payload: { person: 'ext', change: 'Also give', role: roleId(tables, 'Owner Director') } }) as never)
    return tables
  }

  it('gives someone outside the staff list holding Owner Director and Dash Reader every store and a filtered report given to them, in Explain', async () => {
    const explained = await explainPerson(context(await leader(), { payload: { person: 'ext' }, peopleRoles: { ext: ['Dash Reader'] } }) as never)
    expect([explained.next, explained.reports.map(r => r.name), explained.change.stores_gained.map(s => s.name)])
      .toEqual([{ opens: true, reports: 1, stores: 1 }, ['Vendor Sales'], ['Lakeside']])
  })

  it('lists the same person, holding no Dash role, as needing one on the comparison', async () => {
    const row = (await accessChanges(context(await leader(), { peopleRoles: { ext: [] } }) as never)).groups.flatMap(g => g.people).find(p => p.person === 'ext')!
    expect(row.kinds).toEqual(['needs_dash_role'])
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
    await converted(tables)
    tables['dash.business_role'].find(r => r.role_name === 'Store Manager')!.role_name = 'Store Head'
    expect((await accessChanges(context(tables) as never)).groups.flatMap(g => g.people).map(p => p.person)).not.toContain('sm')
  })

  it('gives a category head mapped to Head Office every store', async () => {
    const tables = await seeded()
    tables['dash.title_map'].find(r => r.title === 'Category head')!.business_role = roleId(tables, 'Head Office')
    const role = (await explainPerson(context(tables, { payload: { person: 'buy' } }) as never)).roles[0]
    expect([role.name, role.area.parts.map(p => p.name), role.area.stores, role.area.subcategories]).toEqual(['Head Office', ['Whole company'], 1, null])
  })

  it('says in plain words how far each role reaches, and that a role added without it has none set', async () => {
    const tables = await seeded()
    tables['dash.business_role'].push({ row_id: 'r-x', role_name: 'Auditor' })
    const page = await businessRoles(context(tables) as never)
    expect(['Store Manager', 'Category Head', 'Owner Director', 'Supplier', 'Auditor'].map(n => page.roles.find(r => r.name === n)!.reaches))
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
  const remap = (tables: Record<string, Row[]>, title: string) => { tables['dash.title_map'].find(r => r.title === title)!.business_role = roleId(tables, 'Head Office') }

  it('gives a named head of North every store, Hillview in the South too, when Cluster Manager maps to Head Office', async () => {
    const tables = await twoStores()
    tables.Cluster[0].cluster_manager = 'E-X'
    remap(tables, 'Cluster Manager')
    const role = (await explainPerson(context(tables, { payload: { person: 'x' } }) as never)).roles[0]
    expect([role.name, role.area.parts.map(p => p.name), role.area.stores]).toEqual(['Head Office', ['Whole company'], 2])
  })

  it('gives a Buyer Section\'s buyer in the East every store, Hillview in the West too, when Buyer maps to Head Office', async () => {
    const tables = await twoStores()
    tables['Buyer Section'] = [{ row_id: 'BS-1', name: 'Silk section', operating_region: 'East', buyer: 'E-X', starts_on: '2026-01-01' }]
    tables['Buyer Section Subcategory'] = [{ row_id: 'BL-1', buyer_section: 'BS-1', subcategory: '010101001', starts_on: '2026-01-01' }]
    remap(tables, 'Buyer')
    const role = (await explainPerson(context(tables, { payload: { person: 'x' } }) as never)).roles[0]
    expect([role.name, role.area.parts.map(p => p.name), role.area.stores]).toEqual(['Head Office', ['Whole company'], 2])
  })
})

describe('a role given by hand only, on the Title Map (Codex standard round 5)', () => {
  it('refuses to map a title to it, saying why', async () => {
    const tables = await seeded()
    await expect(mapTitle(context(tables, { payload: { title: 'Staff', role: roleId(tables, 'Master Data Manager') } }) as never)).rejects.toThrow('Master Data Manager is given by hand only')
  })

  it('lists a title already mapped to it as not mapped yet', async () => {
    const tables = await seeded()
    tables['dash.title_map'].find(r => r.title === 'Staff')!.business_role = roleId(tables, 'Master Data Manager')
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

// ---------- #1277: the switch-over, and business roles deciding ----------

const REPORT_ROWS = [{ row_id: 'vs', report_key: 'vs', report_name: 'Vendor Sales', filter_shape: 'Stores and subcategories' },
  { row_id: 'sales', report_key: 'sales', report_name: 'Sales', filter_shape: 'One store and subcategories' }, { ...OPEN, row_id: 'open' }]

/** The rich world switched to business roles as the owner would: starting roles added (seeded), old grants given to roles, then the switch set by hand. */
async function switched(tables?: Record<string, Row[]>) {
  const world = tables ?? await richWorld()
  world['dash.report'] = REPORT_ROWS
  const ctx = context(world, { roles: ['System Manager'] })
  const result = await actions.give_old_grants_to_roles(ctx as never)
  world['dash.access_source'] = [{ row_id: 's1', source: 'business_roles' }]
  return { tables: world, result }
}
/** A reader's context as the platform hands a read: their roles, and no places (worked out from the core Tables). */
const readerOf = (tables: Record<string, Row[]>, user: string, roles: string[] = []) => ({ ...context(tables, { user, roles }), authorization: { places: [] }, datasets: { active: async () => null } })
const scopeOf = async (tables: Record<string, Row[]>, person: string, roles: string[] = []) =>
  placesByStore(await scopeProviders.org_chart({ person: { id: person, email: null, roles }, documents: context(tables).baseTables } as never))

describe('the steps towards business roles run only when asked (#1277 J1, J3, J5)', () => {
  it('adds no role, gives no grant and sets no switch by itself: a new instance stays on the old rules', async () => {
    const tables = world()
    expect([tables['dash.business_role'].length, tables['dash.access_source'] ?? [], await scopeOf(tables, 'st', ['Dash Reader'])]).toEqual([0, [], { 9901: ['010101001'] }])
  })

  it('adds the starting roles only on the button, logging each, and nothing on a second click', async () => {
    const tables = await seeded()
    expect(tables['dash.switch_over_log'].filter(l => l.step === 'Starting role').length).toBe(STARTING_ROLES.length)
    expect(await addStartingRoles(context(tables) as never)).toEqual({ roles: 0, titles: 0 })
    expect(tables['dash.switch_over_log'].filter(l => l.step === 'Starting role').length).toBe(STARTING_ROLES.length)
  })

  it('gives a grant to a job to its business role, and one to Dash Reader to every role that opens Dash, logging each, and sets no switch', async () => {
    const tables = await seeded()
    tables['dash.report'] = REPORT_ROWS
    const result = await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never)
    const given = tables['dash.report_access'].filter(r => r.business_role).map(r => [r.report, tables['dash.business_role'].find(b => b.row_id === r.business_role)!.role_name])
    const dashRoles = STARTING_ROLES.filter(r => !r.by_hand_only && r.grants.some(g => g[0] === 'Dash')).map(r => r.name)
    const sorted = (pairs: unknown[][]) => pairs.map(p => p.join(' → ')).sort()
    expect(sorted(given)).toEqual(sorted([['vs', 'Store Manager'], ...dashRoles.map(name => ['sales', name])]))
    expect([result, tables['dash.switch_over_log'].filter(l => l.step === 'Report grant').length, tables['dash.access_source'] ?? []])
      .toEqual([{ grants_added: 1 + dashRoles.length, grants_not_converted: 0 }, 1 + dashRoles.length, []])
    // The old grants stay, so the old rules keep working.
    expect(tables['dash.report_access'].filter(r => r.job || r.role).map(r => r.row_id)).toEqual(['a1', 'a2'])
  })

  it('leaves a grant to a person as it is, and logs a grant to a role with no business role once', async () => {
    const tables = await seeded()
    tables['dash.report_access'].push({ row_id: 'a5', report: 'vs', person: 'st' }, { row_id: 'a6', report: 'vs', role: 'Report Access Manager' })
    await switched(tables)
    await switched(tables)
    expect(tables['dash.report_access'].filter(r => r.person).length).toBe(1)
    expect(tables['dash.switch_over_log'].filter(l => l.outcome === 'Not converted').map(l => l.source_grant)).toEqual(['a6'])
  })

  it('adds nothing when run again, and never changes a role someone edited', async () => {
    const { tables } = await switched(await seeded())
    const role = tables['dash.business_role'].find(r => r.role_name === 'Store Manager')!
    role.description = 'Edited by the owner'
    tables['dash.business_role_permission'] = tables['dash.business_role_permission'].filter(p => p.business_role !== role.row_id || p.app !== 'Tickets')
    const before = JSON.stringify(tables)
    expect(await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never)).toEqual({ grants_added: 0, grants_not_converted: 0 })
    expect(await addStartingRoles(context(tables) as never)).toEqual({ roles: 0, titles: 0 })
    expect(JSON.stringify(tables)).toBe(before)
  })

  // Codex adversarial round 1: a removed role grant stays removed.
  it('never gives an old grant to a role again once its role grant was removed', async () => {
    const { tables } = await switched(await seeded())
    const converted = tables['dash.report_access'].find(r => r.report === 'vs' && r.business_role)!
    converted.removed = 1
    expect(await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never)).toEqual({ grants_added: 0, grants_not_converted: 0 })
  })

  it('logs a role that already had the report once, and does not give it again', async () => {
    const tables = await seeded()
    const sm = String(tables['dash.business_role'].find(r => r.role_name === 'Store Manager')!.row_id)
    tables['dash.report_access'].push({ row_id: 'a7', report: 'vs', business_role: sm, access_key: `report:vs/business_role:${sm}` })
    await switched(tables)
    expect(tables['dash.report_access'].filter(r => r.report === 'vs' && r.business_role === sm).length).toBe(1)
    expect(tables['dash.switch_over_log'].filter(l => l.outcome === 'Already given').map(l => l.source_grant)).toEqual(['a1'])
  })

  it('is refused to anyone but a System Manager', async () => {
    const tables = await seeded()
    await expect(actions.give_old_grants_to_roles(context(tables) as never)).rejects.toThrow('Only a System Manager')
  })
})

describe('business roles decide Dash access (#1277 J2)', () => {
  it('gives a store manager their store, a buyer their subcategories, an Owner Director named by hand every store, and a Director by title, head office and floor staff nothing', async () => {
    const { tables } = await switched()
    tables.Employee.push({ row_id: 'E-DIR', name: 'Dina', employee_code: 'E-DIR', status: 'Current', person: 'dir' }, { row_id: 'E-OD', name: 'Omana', employee_code: 'E-OD', status: 'Current', person: 'od' })
    tables['Job Assignment'].push({ row_id: 'J-DIR', employee: 'E-DIR', job: 'Director', site: 'HOF', starts_on: '2026-01-01' }, { row_id: 'J-OD', employee: 'E-OD', job: 'Director', site: 'HOF', starts_on: '2026-01-01' })
    await giveRole(context(tables, { payload: { person: 'od', change: 'Also give', role: roleId(tables, 'Owner Director') } }) as never)
    expect([await scopeOf(tables, 'sm'), await scopeOf(tables, 'b'), await scopeOf(tables, 'od'), await scopeOf(tables, 'dir'), await scopeOf(tables, 'ho'), await scopeOf(tables, 'st')])
      .toEqual([{ 9901: null }, { 9901: ['010101001'] }, { 9901: null }, {}, {}, {}])
  })

  // Owner, 18-Nov-2026: head office staff see reports only through a role given by hand or a grant.
  it('gives head office staff Dash only once a role is given to them by hand', async () => {
    const { tables } = await switched()
    expect(await reads.can_open(readerOf(tables, 'ho', ['Dash Reader']) as never)).toBe(false)
    await giveRole(context(tables, { payload: { person: 'ho', change: 'Also give', role: roleId(tables, 'Owner Director') } }) as never)
    expect([await reads.can_open(readerOf(tables, 'ho', ['Dash Reader']) as never), await scopeOf(tables, 'ho')]).toEqual([true, { 9901: null }])
  })

  // Consultants (External people) get no role by title; a role given by hand works for them, on Explain and live.
  it('gives an External person, on no staff list, any role by hand, explained and live', async () => {
    const { tables } = await switched()
    await giveRole(context(tables, { payload: { person: 'consultant', change: 'Also give', role: roleId(tables, 'Store Manager'), site: 'LKS' } }) as never)
    const explained = await explainPerson(context(tables, { payload: { person: 'consultant' }, peopleRoles: { consultant: ['Dash Reader'] } }) as never)
    expect([explained.roles.map(r => [r.name, r.source, r.area.parts.map(p => p.name)]), explained.next.opens, await scopeOf(tables, 'consultant')])
      .toEqual([[['Store Manager', 'Also given by hand', ['Lakeside']]], true, { 9901: null }])
  })

  it('opens Dash for a store manager holding Dash Reader, and shuts it for staff holding only Dash Reader', async () => {
    const { tables } = await switched()
    expect([await reads.can_open(readerOf(tables, 'sm', ['Dash Reader']) as never), await reads.can_open(readerOf(tables, 'st', ['Dash Reader']) as never)]).toEqual([true, false])
  })

  it('lists someone business roles would let in but who holds no Dash role as needing one', async () => {
    const { tables } = await switched()
    const sm = (await accessChanges(context(tables, { peopleRoles: { sm: [] } }) as never)).groups.find(g => g.kind === 'needs_dash_role')!.people.map(p => p.person)
    expect(sm).toContain('sm')
  })

  it('gives a store manager the reports given to their role and to them, and no Dash All-Stores Reader reach', async () => {
    const { tables } = await switched()
    expect((await reportsFor(readerOf(tables, 'sm', ['Dash Reader']) as never)).map(r => r.report_key).sort()).toEqual(['sales', 'vs'])
    expect(await scopeOf(tables, 'st', ['Dash All-Stores Reader'])).toEqual({})
  })

  it('predicts in the comparison exactly what each person now reaches and is offered', async () => {
    const { tables } = await switched()
    const ctx = context(tables)
    const world = await shadowWorld(ctx.baseTables as never, today)
    const shapes = new Map(REPORT_ROWS.map(r => [r.report_key, r.filter_shape]))
    for (const person of ['sm', 'st', 'ho', 'buy', 'b', 'fm', 'dm', 'cm', 'ch', 'tl', 'mix', 'all']) {
      const shadow = await personShadow(world, person, ['Dash Reader'], shapes)
      const live = readerOf(tables, person, ['Dash Reader'])
      const offered = (await reads.reports(live as never) as { key: string }[]).map(r => r.key).sort()
      expect([person, shadow.next.places, shadow.next.reports, shadow.next.opens])
        .toEqual([person, await scopeOf(tables, person), offered, await reads.can_open(live as never)])
    }
  })
})

describe('one switch puts the old rules back (#1277 J5)', () => {
  it('restores the old reach, front door and reports when set to the old rules, and business roles when set back', async () => {
    const { tables } = await switched()
    tables['dash.access_source'][0].source = 'legacy'
    const old = [await scopeOf(tables, 'st', ['Dash Reader']), await reads.can_open(readerOf(tables, 'st', ['Dash Reader']) as never), await scopeOf(tables, 'ho', ['Dash All-Stores Reader'])]
    expect(old).toEqual([{ 9901: ['010101001'] }, true, { 9901: null }])
    tables['dash.access_source'][0].source = 'business_roles'
    expect([await scopeOf(tables, 'st', ['Dash Reader']), await reads.can_open(readerOf(tables, 'st', ['Dash Reader']) as never)]).toEqual([{}, false])
  })

  it('reads no switch row, or one saying anything else, as the old rules', async () => {
    const tables = await seeded()
    expect(await scopeOf(tables, 'st', ['Dash Reader'])).toEqual({ 9901: ['010101001'] })
    tables['dash.access_source'] = [{ row_id: 's1', source: 'business_roles' }, { row_id: 's2', source: 'something else' }]
    expect(await scopeOf(tables, 'st', ['Dash Reader'])).toEqual({ 9901: ['010101001'] })
  })
})

// #1277 (owner, 18-Nov-2026): a Region reach, read from the sites' own regions; Tester at the stores it is given for.
describe('Region and Tester', () => {
  async function regional() {
    const { tables } = await switched()
    tables.Site.push({ row_id: 'HIL', name: 'Hillview', is_store: true, operating_region: 'East' }, { row_id: 'RIV', name: 'Riverside', is_store: true, operating_region: 'West' })
    tables.Plant.push({ row_id: '9902', site: 'HIL', plant_type: 'Store' }, { row_id: '9903', site: 'RIV', plant_type: 'Store' })
    return tables
  }

  it('gives a Regional Head, also given at their job, every store of their site\'s region and no other', async () => {
    const tables = await regional()
    await giveRole(context(tables, { payload: { person: 'sm', change: 'Correct', role: roleId(tables, 'Regional Head') } }) as never)
    expect(await scopeOf(tables, 'sm')).toEqual({ 9901: null, 9902: null })
    const explained = await explainPerson(context(tables, { payload: { person: 'sm' }, peopleRoles: { sm: ['Dash Reader'] } }) as never)
    expect(explained.roles.map(r => [r.name, r.area.parts.map(p => p.name), r.area.stores])).toEqual([['Regional Head', ['East'], 2]])
  })

  it('maps no HR title to Regional Head', async () => {
    const tables = await regional()
    expect(tables['dash.title_map'].map(r => r.business_role)).not.toContain(roleId(tables, 'Regional Head'))
  })

  it('gives a Tester, by hand at two stores, those two stores only', async () => {
    const tables = await regional()
    for (const site of ['LKS', 'RIV']) await giveRole(context(tables, { payload: { person: 'consultant', change: 'Also give', role: roleId(tables, 'Tester'), site } }) as never)
    expect(await scopeOf(tables, 'consultant')).toEqual({ 9901: null, 9903: null })
  })

  // Codex adversarial round 4: a Buyer Section naming someone reaches them only through a Buyer role.
  it('gives a category head no Buyer Section of theirs when no Buyer role comes from it', async () => {
    const { tables } = await switched(await seeded())
    tables.Site.push({ row_id: 'RIV', name: 'Riverside', is_store: true, operating_region: 'West' })
    tables.Plant.push({ row_id: '9903', site: 'RIV', plant_type: 'Store' })
    tables['Buyer Section'] = [{ row_id: 'BS-K', name: 'Kids section', operating_region: 'West', buyer: 'E-BUY', starts_on: '2026-01-01' }]
    tables['Buyer Section Subcategory'] = [{ row_id: 'BL-K', buyer_section: 'BS-K', subcategory: '010102001', starts_on: '2026-01-01' }]
    tables['dash.title_map'] = tables['dash.title_map'].filter(r => r.title !== 'Buyer')
    expect(Object.keys(await scopeOf(tables, 'buy'))).toEqual(['9901'])
  })

  // Codex round 5: a Region role placed by hand at another store reaches that store's region.
  it('gives a Regional Head placed by hand at a West store the West, not the region of their own job', async () => {
    const tables = await regional()
    await giveRole(context(tables, { payload: { person: 'sm', change: 'Correct', role: roleId(tables, 'Regional Head'), site: 'RIV' } }) as never)
    expect(await scopeOf(tables, 'sm')).toEqual({ 9903: null })
    const explained = await explainPerson(context(tables, { payload: { person: 'sm' }, peopleRoles: { sm: ['Dash Reader'] } }) as never)
    expect(explained.roles.map(r => [r.name, r.area.parts.map(p => p.name)])).toEqual([['Regional Head', ['West']]])
  })

  it('gives a Supplier no Dash until the supplier area exists', async () => {
    const tables = await regional()
    await giveRole(context(tables, { payload: { person: 'supplier', change: 'Also give', role: roleId(tables, 'Supplier'), site: 'LKS' } }) as never)
    expect([await scopeOf(tables, 'supplier'), await reads.can_open(readerOf(tables, 'supplier', ['Dash Reader']) as never)]).toEqual([{}, false])
  })
})

// Codex adversarial round 6: a read never mixes places from one rules with report grants from the other.
describe('one reading of the switch per read', () => {
  it('marks every place from business roles, and gives no report when the switch has moved since the places were worked out', async () => {
    const { tables } = await switched()
    const places = await scopeProviders.org_chart({ person: { id: 'sm', email: null, roles: ['Dash Reader'] }, documents: context(tables).baseTables } as never)
    expect(places.every(p => (p.basis ?? '').split(', ').includes('business_roles'))).toBe(true)
    const reader = { ...readerOf(tables, 'sm', ['Dash Reader']), authorization: { places } }
    expect((await reportsFor(reader as never)).length).toBeGreaterThan(0)
    tables['dash.access_source'][0].source = 'legacy'
    expect(await reportsFor(reader as never)).toEqual([])
  })

  it('gives no report under business roles to places the old rules worked out', async () => {
    const { tables } = await switched()
    tables['dash.access_source'][0].source = 'legacy'
    const places = await scopeProviders.org_chart({ person: { id: 'sm', email: null, roles: ['Dash Reader'] }, documents: context(tables).baseTables } as never)
    tables['dash.access_source'][0].source = 'business_roles'
    expect(await reportsFor({ ...readerOf(tables, 'sm', ['Dash Reader']), authorization: { places } } as never)).toEqual([])
  })
})

// #1280 (owner, 18-Nov-2026): with Site's kind and status, a Planned or Closed store, a Group or any other kind is no store,
// for business roles too: the role's own reader asks the instance about Site, as the provider and the comparison do.
describe('site kind and status under business roles', () => {
  async function kinds() {
    const { tables } = await switched()
    for (const site of tables.Site) Object.assign(site, { site_kind: site.is_store ? 'Store' : 'Head Office', status: 'Open' })
    tables.Site.push(
      { row_id: 'PLN', name: 'Planned', is_store: true, operating_region: 'East', site_kind: 'Store', status: 'Planned' },
      { row_id: 'CLS', name: 'Closed', is_store: true, operating_region: 'East', site_kind: 'Store', status: 'Closed' },
      { row_id: 'GHO', name: 'Group HO', is_store: true, operating_region: 'East', site_kind: 'Group', status: 'Open' },
      { row_id: 'HIL', name: 'Hillview', is_store: false, operating_region: 'East', site_kind: 'Store', status: 'Open' })
    for (const [plant, site] of [['9904', 'PLN'], ['9905', 'CLS'], ['9906', 'GHO'], ['9902', 'HIL']]) tables.Plant.push({ row_id: plant, site, plant_type: 'Store' })
    return tables
  }

  it('gives a company-wide role and a region role only the open stores, and the comparison counts the same', async () => {
    const tables = await kinds()
    await giveRole(context(tables, { payload: { person: 'od', change: 'Also give', role: roleId(tables, 'Owner Director') } }) as never)
    await giveRole(context(tables, { payload: { person: 'sm', change: 'Correct', role: roleId(tables, 'Regional Head') } }) as never)
    expect(await scopeOf(tables, 'od')).toEqual({ 9901: null, 9902: null })
    expect(await scopeOf(tables, 'sm')).toEqual({ 9901: null, 9902: null })
    const explained = await explainPerson(context(tables, { payload: { person: 'sm' }, peopleRoles: { sm: ['Dash Reader'] } }) as never)
    expect(explained.roles.map(r => [r.name, r.area.stores])).toEqual([['Regional Head', 2]])
  })

  it('refuses to place a role at a site that is no open store', async () => {
    const tables = await kinds()
    for (const site of ['PLN', 'GHO'])
      await expect(giveRole(context(tables, { payload: { person: 'sm', change: 'Also give', role: roleId(tables, 'Tester'), site } }) as never)).rejects.toThrow('Choose a store')
  })

  it('without the columns on the instance, is_store alone decides', async () => {
    const tables = await kinds()
    for (const site of tables.Site) { delete site.site_kind; delete site.status }
    await giveRole(context(tables, { payload: { person: 'od', change: 'Also give', role: roleId(tables, 'Owner Director') } }) as never)
    expect(Object.keys(await scopeOf(tables, 'od')).sort()).toEqual(['9901', '9904', '9905', '9906'])
  })
})

// Owner, 18-Nov-2026: a head office site gives no store reach; someone off payroll but given a role by hand has not left.
describe('head office sites and people off payroll', () => {
  it('gives a role placed at a head office site no store there', async () => {
    const { tables } = await switched()
    tables.Plant.push({ row_id: '9990', site: 'HOF', plant_type: 'Store' })
    await giveRole(context(tables, { payload: { person: 'ho', change: 'Correct', role: roleId(tables, 'Store Manager') } }) as never)
    expect(await scopeOf(tables, 'ho')).toEqual({})
  })

  it('never shows someone given a role by hand as having left, whatever payroll says', async () => {
    const { tables } = await switched()
    tables.Employee.push({ row_id: 'E-OD', name: 'Omana', employee_code: 'E-OD', status: 'Left', person: 'od' })
    const before = (await whoIs(context(tables).baseTables as never, ['od'], today)).get('od')!.staff
    await giveRole(context(tables, { payload: { person: 'od', change: 'Also give', role: roleId(tables, 'Owner Director') } }) as never)
    expect([before, (await whoIs(context(tables).baseTables as never, ['od'], today)).get('od')!.staff]).toEqual(['left', 'none'])
  })

  // #1280's site_kind and the Site's status: the rule, read where the instance's Site has the columns; is_store where not.
  it('reads a site as an open store by its status, then its site_kind, then is_store', async () => {
    expect([
      openStore({ is_store: true, site_kind: 'Head Office' }), openStore({ is_store: false, site_kind: 'Store' }),
      openStore({ is_store: true, site_kind: '' }), openStore({ is_store: false, site_kind: null }), openStore({ is_store: true }),
      openStore({ is_store: true, site_kind: 'Collection Centre' }), openStore({ is_store: true, site_kind: 'A kind added later' }),
      openStore({ is_store: true, site_kind: 'Store', status: 'Planned' }), openStore({ is_store: true, site_kind: 'Store', status: 'Closed' }),
      openStore({ is_store: false, site_kind: 'Store', status: 'Open' }), openStore({ is_store: true, status: '' }),
    ]).toEqual([false, true, true, false, true, false, false, false, false, true, true])
    expect(await siteStoreFields(true)).toEqual(['is_store', 'site_kind', 'status'])
    expect(await siteStoreFields(Promise.resolve(false))).toEqual(['is_store'])
    // Of the seven kinds only Store is a store, and a Group (virtual) never is.
    expect(SITE_KINDS.filter(kind => openStore({ is_store: true, site_kind: kind }))).toEqual(['Store'])
  })

  // Codex round 8: a role placed by hand, with no job at all, reaches no store at a head office site either.
  it('gives a consultant given Tester at a head office site no store there', async () => {
    const { tables } = await switched()
    tables.Plant.push({ row_id: '9990', site: 'HOF', plant_type: 'Store' })
    tables['dash.role_assignment'].push({ row_id: 'h-c', person: 'consultant', change: 'Also give', business_role: roleId(tables, 'Tester'), site: 'HOF', updated_at: 'x' })
    expect(await scopeOf(tables, 'consultant')).toEqual({})
  })
})

// Codex round 12: the app's reads see retired rows as the scope provider does, so both give the same places.
describe('retired rows on the business path', () => {
  it('gives a store manager their store through a retired plant, as the provider does', async () => {
    const { tables } = await switched()
    tables.Plant[0].retired_at = '2026-11-01'
    const base = context(tables).baseTables
    const hiding = { ...base, list: async (table: string, args: { with_retired?: boolean } & Record<string, unknown>) =>
      (await base.list(table, args as never)).filter(row => args.with_retired || !(tables[table] ?? []).find(r => r.row_id === row.row_id)?.retired_at) }
    const without = { ...hiding, list: async (table: string, args: Record<string, unknown>) => hiding.list(table, { ...args, with_retired: false }) }
    // Without the retired rows the store would be lost: the guard is what keeps the two paths alike.
    expect((await liveReach(without as never, 'sm', ['Dash Reader'], today)).places).toEqual([])
    const app = (await liveReach(hiding as never, 'sm', ['Dash Reader'], today)).places.map(p => p.label)
    expect([app, Object.keys(await scopeOf(tables, 'sm'))]).toEqual([['9901'], ['9901']])
  })
})

