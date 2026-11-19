// #1218: the business roles in shadow, over in-memory Tables. Made-up stores and people.
import { describe, expect, it } from 'vitest'
import { accessChanges, addStartingRoles, areaParts, businessRoles, explainPerson, giveRole, mapTitle, mayExplainAccess, whyAccess, workedOut } from './business-roles-server'
import { actions, reads, reportsFor } from './server'
import { STARTING_ROLES } from './starting-roles'
import { convertGrants, oldGrantsSummary, startingRolesSummary } from './switch-over'
import { accessPage, grantOptions, personLookup, whoIs } from './report-access-server'
import { liveReach } from './access-source'
import { SITE_KINDS, openStore, siteStoreFields } from './site-kind'
import { every, mergePlaces } from './business-access'
import { businessAccessSummary, linked, switchOverLog } from './switch-over-server'
import { rolesForOldRole } from './switch-over'
import { scopeProviders } from './server'
import { directDocuments, memoryDocuments, personShadow, placesByStore, shadowWorld } from './business-roles-server'
import { businessModel } from './business-access'
import { istToday } from './report'
import { OLD_GRANTS_PAGE, decideAccess, decidedToLose, describeBusinessRoles, giveOldGrantsPreview } from './roles-records-server'

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
/** Decision 7: a grant to a job is not carried over; the owner gives the report to the business role on request. */
function onRequest(tables: Record<string, Row[]>, report: string, role: string) {
  tables['dash.report_access'].push({ row_id: `asked-${report}-${role}`, report, business_role: roleId(tables, role), access_key: `report:${report}/business_role:${roleId(tables, role)}` })
  return tables
}

describe('the starting roles', () => {
  it('writes the starting business roles once', async () => {
    const tables = await seeded()
    // A count of one is said in the singular.
    expect(tables['dash.switch_over_log'].map(l => l.detail)).toEqual(expect.arrayContaining([expect.stringMatching(/, with its 1 permission$/), expect.stringMatching(/, with its \d+ permissions$/)]))
    expect(tables['dash.business_role'].map(r => r.role_name)).toEqual(STARTING_ROLES.map(r => r.name))
  })

  // #1277: the button is harmless once the roles are there: a second click adds nothing and changes nothing.
  it('adds nothing the second time, keeping the run itself as a record that says so', async () => {
    const tables = await seeded()
    const others = () => JSON.stringify({ ...tables, 'dash.setup_run': undefined })
    const before = others()
    const result = await addStartingRoles(context(tables) as never) as { roles: number; titles: number; run: string }
    expect(result).toMatchObject({ roles: 0, titles: 0 })
    expect(others()).toBe(before)
    expect(tables['dash.setup_run'].find(r => r.row_id === result.run)).toMatchObject({ step: 'Add The Starting Roles', added: 0,
      summary: 'Add The Starting Roles: nothing to add: every starting role and title is there' })
  })
})

describe('a log line as a sentence', () => {
  it('links each named record in its own words, and leaves a name no longer in them as words', () => {
    const role = { table: 'dash.business_role', row: 'r1', name: 'Store Manager' }
    expect(linked('Gave the report Vendor Sales to Store Manager, as before', [role, { table: 'dash.report', row: 'vs', name: 'Vendor Sales' }, { table: 'dash.report', row: 'x', name: 'Renamed' }, { table: 'dash.report', row: 'y', name: '' }]))
      .toEqual(['Gave the report ', { record: { table: 'dash.report', row: 'vs', name: 'Vendor Sales' } }, ' to ', { record: role }, ', as before'])
    // The role is what the title is mapped to, not the title of the same name; a line's subject is the role.
    expect(linked('Mapped the title Buyer to Buyer', [{ ...role, name: 'Buyer' }])).toEqual(['Mapped the title Buyer to ', { record: { ...role, name: 'Buyer' } }])
    expect(linked('Store Manager already had the report Store Manager pack', [role])).toEqual([{ record: role }, ' already had the report Store Manager pack'])
    expect(linked('Added the starting role Store Manager, with its 5 permissions', [role])).toEqual(['Added the starting role ', { record: role }, ', with its 5 permissions'])
  })
})

describe('the Business Roles page', () => {
  it('reads each permission as a sentence with its reach', async () => {
    const page = await businessRoles(context(await seeded()) as never)
    // #1282 (Siraj): a Report Access Manager sees the grid read-only; a System Manager changes it (#437).
    expect(page.may_change).toBe(false)
    expect((await businessRoles(context(await seeded(), { roles: ['System Manager'] }) as never)).may_change).toBe(true)
    await expect(businessRoles(context(await seeded(), { roles: ['Dash Reader'] }) as never)).rejects.toThrow()
    expect(page.roles.find(r => r.name === 'Store Manager')!.permissions).toContainEqual(expect.objectContaining({ app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Section names and subcategories', reach: 'Area', sentence: 'Store Managers can Edit Section names and subcategories in their area' }))
    // Owner, 18-Nov-2026: managers see their team's tickets; Head Office opens no Dash by default.
    expect(page.roles.find(r => r.name === 'Store Manager')!.permissions.find(p => p.app === 'Tickets')!.sentence).toBe('Store Managers can View Tickets for their team')
    expect(page.roles.find(r => r.name === 'Head Office')!.permissions.map(p => p.app)).toEqual(['Tasker', 'Tickets'])
  })

  it('says each role as sentences: its name a link, its people counted with where they come from, each report given to it', async () => {
    const tables = onRequest(await converted(await seeded()), 'vs', 'Head Office')
    await giveRole(context(tables, { payload: { person: 'st', change: 'Also give', role: roleId(tables, 'Team Leader'), ends_on: '2999-03-31', reason: 'Covering' } }) as never)
    tables['dash.report_bundle'] = [...tables['dash.report_bundle'] ?? [], { row_id: 'bx', bundle_name: 'Store pack' }]
    tables['dash.report_access'].push({ row_id: 'given-bx', report_bundle: 'bx', business_role: roleId(tables, 'Head Office'), access_key: `bundle:bx/business_role:${roleId(tables, 'Head Office')}` })
    const page = await businessRoles(context(tables) as never)
    // Codex adversarial round 1: a bundle the caller may not read is not named to them (their own documents decide).
    const blind = context(tables)
    const list = blind.documents.list
    blind.documents.list = (async (table: string, args: never) => (table === 'dash.report_bundle' ? [] : list(table, args))) as typeof list
    expect((await businessRoles(blind as never)).roles.flatMap(r => r.reports).flat().some(p => typeof p !== 'string' && 'record' in p && p.record.name === 'Store pack')).toBe(false)
    const role = (name: string) => page.roles.find(r => r.name === name)!
    expect(role('Store Manager').permissions[0]!.parts[0]).toEqual({ record: { table: 'dash.business_role', row: roleId(tables, 'Store Manager'), name: 'Store Managers' } })
    expect(role('Team Leader')).toMatchObject({ people: 1, people_from: 'by hand' })
    expect(role('Staff').people_from).toBe('from HR title')
    expect(role('Master Data Manager')).toMatchObject({ people: 0, people_from: 'nobody yet', reports: [] })
    expect(role('Head Office').reports.map(parts => (parts[0] as { record: { name: string } }).record.name)).toContain('Store pack')
    // #1282: the reports grid's ticks and rows, and that a Report Access Manager may give them.
    expect([role('Head Office').given, page.report_catalog.map(t => `${t.table}|${t.key}`), page.may_give_reports])
      .toEqual([expect.arrayContaining(['dash.report|vs', 'dash.report_bundle|bx']), expect.arrayContaining(['dash.report|vs', 'dash.report_bundle|bx']), true])
    expect(role('Head Office').reports).toContainEqual([{ record: { table: 'dash.report', row: 'vs', name: expect.any(String) } }, ' is given to ', { record: { table: 'dash.business_role', row: roleId(tables, 'Head Office'), name: 'Head Office' } }, ' ', { chip: 'each in their own area' }])
  })

  // Codex standard round 1: the count agrees with access: a person Corrected counts only under the role they now hold,
  // and once the correction ends they count under their HR title's role again.
  it("counts a role's people as access decides: a correction moves them, and an ended one moves them back", async () => {
    const tables = await seeded()
    const before = await businessRoles(context(tables) as never)
    const count = (page: typeof before, name: string) => page.roles.find(r => r.name === name)!.people
    await giveRole(context(tables, { payload: { person: 'st', change: 'Correct', role: roleId(tables, 'Team Leader'), ends_on: '2999-03-31', reason: 'Acting' } }) as never)
    const corrected = await businessRoles(context(tables) as never)
    expect([count(corrected, 'Staff'), count(corrected, 'Team Leader')]).toEqual([count(before, 'Staff') - 1, count(before, 'Team Leader') + 1])
    expect(corrected.roles.find(r => r.name === 'Team Leader')!.people_from).toContain('by hand')
    for (const row of tables['dash.role_assignment']) row.ends_on = '2000-01-01'
    const ended = await businessRoles(context(tables) as never)
    expect([count(ended, 'Staff'), count(ended, 'Team Leader')]).toEqual([count(before, 'Staff'), count(before, 'Team Leader')])
  })

  it('lists a designation nobody has mapped first, with how many hold it', async () => {
    const page = await businessRoles(context(await seeded()) as never)
    expect(page.titles[0]).toMatchObject({ title: 'Operations Executive', role: null, people: 1, falls_back_to: 'Store Manager' })
  })

  it('is refused to someone who does not manage report access', async () => {
    await expect(businessRoles(context(await seeded(), { roles: ['Team Report Manager'] }) as never)).rejects.toThrow('Only a Report Access Manager')
  })
})

// #1282: the platform Map's Why for a Person, from Explain a Person's own reasoning.
describe("Why on the platform's Map", () => {
  it('is offered for a Person to a company-wide manager only', async () => {
    const tables = await seeded()
    expect(mayExplainAccess(context(tables, { payload: { table: 'Person', row: 'sm' } }) as never)).toBe(true)
    expect(mayExplainAccess(context(tables, { payload: { table: 'Site', row: 'sm' } }) as never)).toBe(false)
    expect(mayExplainAccess(context(tables, { payload: { table: 'Person', row: '' } }) as never)).toBe(false)
    expect(mayExplainAccess(context(tables, { payload: undefined }) as never)).toBe(false)
    expect(mayExplainAccess(context(tables, { roles: ['Dash Reader'], payload: { table: 'Person', row: 'sm' } }) as never)).toBe(false)
  })

  it('refuses anyone else, even asked directly', async () => {
    await expect(whyAccess(context(await seeded(), { roles: ['Dash Reader'], payload: { table: 'Person', row: 'sm' } }) as never))
      .rejects.toThrow('Only a Report Access Manager or a System Manager')
  })

  it('draws a store manager: Person → their role at their store, from HR → its App · Level → what each allows and the reports it gives', async () => {
    const tables = onRequest(await converted(await seeded()), 'vs', 'Store Manager')
    const why = await whyAccess(context(tables, { payload: { table: 'Person', row: 'sm' } }) as never)
    const sm = roleId(tables, 'Store Manager')
    expect(why.version).toBe(1)
    expect(why.columns.map(c => c.heading)).toEqual(['Person', 'Business Role · Area', 'App · Level', 'What They Can Do'])
    expect(why.columns[0]!.boxes).toEqual([{ id: 'person', name: expect.any(String), record: { table: 'Person', row: 'sm' } }])
    // The area names Lakeside, a Site, as a link the platform shows only to someone who may read it.
    expect(why.columns[1]!.boxes).toEqual([{ id: 'role:0', name: 'Store Manager', record: { table: 'dash.business_role', row: sm },
      detailParts: [{ name: 'Lakeside', record: { table: 'Site', row: expect.any(String) } }], source: 'hr' }])
    expect(why.columns[2]!.boxes.map(b => b.name).sort()).toEqual(['Dash · Manager', 'Dash · Reader', 'Tasker · Manager', 'Tickets · Manager'])
    const can = why.columns[3]!.boxes
    expect(can.filter(b => b.reach).length).toBeGreaterThan(0)
    // Codex round 3: each report is its record, so the Map draws it as a link to it.
    expect(can.filter(b => b.detail === 'Report').map(b => [b.name, b.record])).toEqual([['Sales', { table: 'dash.report', row: 'sales' }], ['Vendor Sales', { table: 'dash.report', row: 'vs' }]])
    expect(why.edges).toEqual(expect.arrayContaining([['person', 'role:0'], ['role:0', 'app:Dash:Reader']]))
    // Each App · Level names the roles that give it.
    expect(why.columns[2]!.boxes.find(b => b.name === 'Dash · Reader')).toMatchObject({ detail: 'Store Manager' })
    // Verifier: every edge leads to the very next column, so no line runs behind another column's boxes.
    const columnOf = new Map(why.columns.flatMap((c, i) => c.boxes.map(b => [b.id, i] as const)))
    for (const [from, to] of why.edges) expect(columnOf.get(to)! - columnOf.get(from)!).toBe(1)
    // A report comes through its role's Dash box.
    expect(why.edges.filter(([, to]) => to === 'report:vs').every(([from]) => from.startsWith('app:Dash:'))).toBe(true)
  })

  it("keeps within the platform's limits: long words are cut, a long column ends in '+ N more', an empty area says nothing", async () => {
    const tables = await seeded()
    const sm = roleId(tables, 'Store Manager')
    tables['dash.business_role'].find(r => r.row_id === sm)!.role_name = 'Store Manager '.repeat(10).trim()
    tables['Site'].find(r => r.name === 'Lakeside')!.name = ''
    for (let i = 0; i < 40; i++)
      tables['dash.business_role_permission'].push({ row_id: `p-many-${i}`, business_role: sm, app: 'Dash', level: 'Reader', verb: 'View', thing: `Report ${i}`, reach: 'Area' })
    const why = await whyAccess(context(tables, { payload: { table: 'Person', row: 'sm' } }) as never)
    const role = why.columns[1]!.boxes[0]!
    expect([String(role.name).length, String(role.name).endsWith('…'), 'detail' in role]).toEqual([120, true, false])
    const can = why.columns.find(c => c.heading === 'What They Can Do')!.boxes
    expect(can).toHaveLength(9)
    expect(can.at(-1)).toEqual({ id: 'can:more', name: expect.stringMatching(/^\+ \d+ more$/) })
    // Codex round 2: the whole map stays within the platform's 40 boxes and 200 edges.
    expect(why.columns.flatMap(c => c.boxes).length).toBeLessThanOrEqual(40)
    expect(why.edges.length).toBeLessThanOrEqual(200)
  })

  // Codex round 1: the same role held twice is two boxes, and a permission is lit only from the role that grants it.
  it('keeps each role held its own box, and draws each App · Level once, from every role that reaches it (UI owner)', async () => {
    const tables = await seeded()
    // Staff from the HR title, and Staff again by hand: the same role held twice.
    await giveRole(context(tables, { payload: { person: 'st', change: 'Also give', role: roleId(tables, 'Staff'), ends_on: '2999-03-31', reason: 'Covering' } }) as never)
    await giveRole(context(tables, { payload: { person: 'st', change: 'Also give', role: roleId(tables, 'Team Leader'), ends_on: '2999-03-31', reason: 'Covering' } }) as never)
    const why = await whyAccess(context(tables, { payload: { table: 'Person', row: 'st' } }) as never)
    expect(why.columns[1]!.boxes.filter(b => b.name === 'Staff')).toHaveLength(2)
    const ids = why.columns.flatMap(c => c.boxes.map(b => b.id))
    expect(new Set(ids).size).toBe(ids.length)
    const appNames = why.columns[2]!.boxes.map(b => b.name)
    expect(new Set(appNames).size).toBe(appNames.length)
    const explained = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
    const roleOfHolder = (holder: string) => explained.roles[Number(holder.split(':')[1])]!.role
    for (const box of why.columns[2]!.boxes) {
      const [, app, level] = String(box.id).split(':')
      const from = why.edges.filter(([, to]) => to === box.id).map(([f]) => f)
      // Every role that reaches this App · Level is joined to it, and only those.
      const reaching = explained.roles.flatMap((r, i) => explained.permissions.some(p => p.role === r.role && p.app === app && p.level === level) ? [`role:${i}`] : [])
      expect(from.sort()).toEqual(reaching.sort())
      expect(String(box.detail)).toBe([...new Set(from.map(f => explained.roles[Number(f.split(':')[1])]!.name))].join(' · '))
      expect(from.every(f => explained.permissions.some(p => p.role === roleOfHolder(f) && p.app === app))).toBe(true)
    }
    // Each permission comes from its own App · Level.
    for (const [from, to] of why.edges.filter(([, to]) => to.startsWith('can:'))) expect(to.startsWith(`can:${from.slice(4)}:`)).toBe(true)
  })

  // Codex adversarial round 3: an area's words that name a record without saying which never reach the Map.
  it("shows only area parts that name their record, and the company's plain words", async () => {
    const tables = await seeded()
    const ho = await whyAccess(context(tables, { payload: { table: 'Person', row: 'ho' } }) as never)
    expect(ho.columns[1]!.boxes[0]).toMatchObject({ detailParts: [{ name: 'Whole company' }] })
    const sm = await whyAccess(context(tables, { payload: { table: 'Person', row: 'sm' } }) as never)
    const parts = (sm.columns[1]!.boxes[0] as { detailParts: { record?: unknown }[] }).detailParts
    expect(parts.length).toBeGreaterThan(0)
    expect(parts.every(p => p.record)).toBe(true)
  })

  it('says "both roles" under an App · Level that both of a two-role person\'s roles reach', async () => {
    const tables = await seeded()
    await giveRole(context(tables, { payload: { person: 'sm', change: 'Also give', role: roleId(tables, 'Team Leader'), ends_on: '2999-03-31', reason: 'Covering' } }) as never)
    const why = await whyAccess(context(tables, { payload: { table: 'Person', row: 'sm' } }) as never)
    const reached = why.columns[2]!.boxes.filter(b => why.edges.filter(([, to]) => to === b.id).length === 2)
    expect(reached.length).toBeGreaterThan(0)
    expect(reached.every(b => b.detail === 'both roles')).toBe(true)
  })

  it("leaves out area words that name a record without saying which, and keeps the company's plain words", () => {
    expect(areaParts([{ name: 'No area: Store Manager reaches one store, and this person is named only at Lakeside' }])).toEqual({})
    expect(areaParts([{ name: 'Whole company' }, { name: 'Lakeside', table: 'Site', id: 'LKS' }]))
      .toEqual({ detailParts: [{ name: 'Whole company' }, { name: 'Lakeside', record: { table: 'Site', row: 'LKS' } }] })
  })

  it("joins a report straight to its role when that role opens no Dash level of its own", async () => {
    // Store Manager opens Dash; Head Office, also given by hand, does not, yet a report is given to it.
    const tables = onRequest(await converted(await seeded()), 'vs', 'Head Office')
    await giveRole(context(tables, { payload: { person: 'sm', change: 'Also give', role: roleId(tables, 'Head Office'), ends_on: '2999-03-31', reason: 'Covering' } }) as never)
    const why = await whyAccess(context(tables, { payload: { table: 'Person', row: 'sm' } }) as never)
    const ho = why.columns[1]!.boxes.find(b => b.name === 'Head Office')!.id
    expect(why.edges).toContainEqual([ho, 'report:vs'])
  })

  // #1282 C10–C11: the Lens's worked-out sections, from Explain's own answer, for those who may have access explained.
  it('works out the apps and reports a person gets, each with the roles that give it and the chain Why? opens', async () => {
    const tables = onRequest(await converted(await seeded()), 'vs', 'Store Manager')
    const answer = (await workedOut(context(tables, { payload: { table: 'Person', row: 'sm' } }) as never))!
    expect(answer.sections.map(s => [s.heading, s.note, s.empty])).toEqual([
      ['Apps They Can Open', 'worked out from their roles', 'No apps from roles yet'], ['Reports They See', 'given to their roles', 'No reports from roles yet']])
    const dash = answer.sections[0]!.rows.find(r => r.name === 'Dash')!
    expect([dash.detail, dash.via.map(v => [v.name, v.record?.table]), dash.why[0]]).toEqual(['at level Manager', [['Store Manager', 'dash.business_role']], expect.objectContaining({ record: { table: 'Person', row: 'sm' } })])
    expect(dash.why.at(-1)).toEqual({ name: 'Dash · Manager' })
    const report = answer.sections[1]!.rows.find(r => r.record?.row === 'vs')!
    expect([report.name, report.via.map(v => v.name), report.why.at(-1)]).toEqual(['Vendor Sales', ['Store Manager'], { name: 'Vendor Sales', record: { table: 'dash.report', row: 'vs' } }])
  })

  // UI owner: one row per app at its highest level (a higher level includes the lower); "also Reader" only where a
  // different role gives the lower level. The app's name lets the Lens link it to the app.
  it('shows each app once, at its highest level, naming a lower one only when another role gives it', async () => {
    const tables = onRequest(await converted(await seeded()), 'vs', 'Store Manager')
    const dashRows = async () => (await workedOut(context(tables, { payload: { table: 'Person', row: 'sm' } }) as never))!.sections[0]!.rows.filter(r => r.name === 'Dash')
    const [alone] = await dashRows()
    expect([await dashRows().then(r => r.length), alone!.detail, alone!.app]).toEqual([1, 'at level Manager', 'dash'])
    await giveRole(context(tables, { payload: { person: 'sm', change: 'Also give', role: roleId(tables, 'Team Leader'), ends_on: '2999-03-31', reason: 'Covering' } }) as never)
    const [both] = await dashRows()
    expect([both!.detail, both!.via.map(v => v.name), both!.why.at(-1)]).toEqual(['at level Manager, also Reader', ['Store Manager', 'Team Leader'], { name: 'Dash · Manager' }])
  })

  it('keeps every name within the platform\'s limits, so one long name refuses nothing', async () => {
    const tables = onRequest(await converted(await seeded()), 'vs', 'Store Manager')
    const long = `Vendor Sales ${'x'.repeat(200)}`
    const ctx = context(tables, { payload: { table: 'Person', row: 'sm' } })
    const list = ctx.documents.list
    ctx.documents.list = (async (table: string, args: never) => (table === 'dash.report'
      ? (await list(table, args)).map((r: Record<string, unknown>) => (r.report_key === 'vs' ? { ...r, report_name: long } : r)) : list(table, args))) as typeof list
    const answer = (await workedOut(ctx as never))!
    const names = answer.sections.flatMap(s => s.rows.flatMap(r => [r.name, ...r.via.map(v => v.name), ...r.why.flatMap(w => [w.name, ...(w.detailParts ?? []).map(p => p.name)])]))
    expect(names.every(n => n.length <= 120)).toBe(true)
    expect(answer.sections[1]!.rows.find(r => r.record?.row === 'vs')!.name).toMatch(/^Vendor Sales x+…$/)
  })

  it('shows nothing to someone who may not have access explained, or about anything but a Person', async () => {
    const tables = await seeded()
    expect(await workedOut(context(tables, { roles: ['Dash Reader'], payload: { table: 'Person', row: 'sm' } }) as never)).toBeNull()
    expect(await workedOut(context(tables, { payload: { table: 'Site', row: 'LKS' } }) as never)).toBeNull()
  })

  it('says a role given by hand is by hand', async () => {
    const tables = await seeded()
    await giveRole(context(tables, { payload: { person: 'st', change: 'Also give', role: roleId(tables, 'Team Leader'), ends_on: '2999-03-31', reason: 'Covering' } }) as never)
    const why = await whyAccess(context(tables, { payload: { table: 'Person', row: 'st' } }) as never)
    expect(why.columns[1]!.boxes.map(b => [b.name, b.source])).toEqual([['Staff', 'hr'], ['Team Leader', 'hand']])
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

  it('gives a report given to their job, once it is given to the role on request, saying why', async () => {
    const tables = onRequest(await converted(await seeded()), 'vs', 'Store Manager')
    const answer = await explainPerson(context(tables, { payload: { person: 'sm' } }) as never)
    // Sales was given to Dash Reader: the switch-over gives it to every role that opens Dash, Store Manager among them.
    const sm = roleId(tables, 'Store Manager')
    expect(answer.reports).toEqual([{ key: 'sales', name: 'Sales', why: ['Given to Store Manager, for Lakeside'], roles: [sm], direct: false }, { key: 'vs', name: 'Vendor Sales', why: ['Given to Store Manager, for Lakeside'], roles: [sm], direct: false }])
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
    onRequest(await converted(tables), 'vs', 'Store Manager')
    const answer = await accessChanges(context(tables) as never)
    expect(answer.groups.flatMap(g => g.people).map(p => p.person)).not.toContain('sm')
  })

  // #1277: before the switch-over, a grant to a job gives nothing under business roles, and the comparison says so.
  it('shows a report given to a job as lost until it is given to the role', async () => {
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
    expect((await outsider()).reports).toEqual([{ key: 'open', name: 'Company notices', why: ['Given to them directly, through Store pack'], roles: [], direct: true }])
  })

  // #1282, Codex round 2: on the Map's Why, a report given to them directly leads straight from them.
  it("joins a report given to them directly through Given To Them Directly on the Map's Why", async () => {
    const tables = await richWorld()
    await giveRole(context(tables, { payload: { person: 'ext', change: 'Also give', role: roleId(tables, 'Master Data Manager') } }) as never)
    const why = await whyAccess(richContext(tables, { payload: { table: 'Person', row: 'ext' } }) as never)
    expect(why.edges).toEqual(expect.arrayContaining([['person', 'direct'], ['direct', 'direct:app:Dash'], ['direct:app:Dash', 'report:open']]))
    expect(why.columns[1]!.boxes.at(-1)).toEqual({ id: 'direct', name: 'Given To Them Directly' })
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
    onRequest(await converted(tables), 'whole', 'Store Manager')
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
    onRequest(await converted(tables), 'vs', 'Store Manager')
    const switched = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
    expect([before.change.decisions.map(d => d.name), after.change.decisions.map(d => d.name), after.roles[0].area.parts.map(p => p.name), overlap(before), overlap(after)])
      .toEqual([['Sales'], ['Sales'], ['Lakeside'], [], []])
    // Once Sales is carried over and Vendor Sales given to the role on request, the corrected Store Manager gets both, and nothing waits on a decision.
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

  // #1277: Owner Director views every report (View Reports at reach All), not only the one given to them.
  it('gives someone outside the staff list holding Owner Director and Dash Reader every store and every report, in Explain', async () => {
    const explained = await explainPerson(context(await leader(), { payload: { person: 'ext' }, peopleRoles: { ext: ['Dash Reader'] } }) as never)
    expect([explained.next, explained.reports.map(r => r.name), explained.change.stores_gained.map(s => s.name)])
      .toEqual([{ opens: true, reports: 2, stores: 1 }, ['Sales', 'Vendor Sales'], ['Lakeside']])
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
    onRequest(await converted(tables), 'vs', 'Store Manager')
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
    expect(await addStartingRoles(context(tables) as never)).toMatchObject({ roles: 0, titles: 0 })
    expect(tables['dash.switch_over_log'].filter(l => l.step === 'Starting role').length).toBe(STARTING_ROLES.length)
  })

  it('gives a grant to Dash Reader to the manager roles, leaves one to a job, logging each, and sets no switch', async () => {
    const tables = await seeded()
    tables['dash.report'] = REPORT_ROWS
    const result = await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never)
    const given = tables['dash.report_access'].filter(r => r.business_role).map(r => [r.report, tables['dash.business_role'].find(b => b.row_id === r.business_role)!.role_name])
    const managers = STARTING_ROLES.filter(r => r.dash_reader_grants).map(r => r.name)
    const sorted = (pairs: unknown[][]) => pairs.map(p => p.join(' → ')).sort()
    expect(sorted(given)).toEqual(sorted(managers.map(name => ['sales', name])))
    expect([result, tables['dash.switch_over_log'].filter(l => l.step === 'Report grant').length, tables['dash.access_source'] ?? []])
      .toEqual([expect.objectContaining({ grants_added: managers.length, grants_not_converted: 1 }), 1 + managers.length, []])
    // The old grants stay, so the old rules keep working.
    expect(tables['dash.report_access'].filter(r => r.job || r.role).map(r => r.row_id)).toEqual(['a1', 'a2'])
  })

  it('leaves a grant to a person as it is, and logs a grant to a role with no business role once', async () => {
    const tables = await seeded()
    tables['dash.report_access'].push({ row_id: 'a5', report: 'vs', person: 'st' }, { row_id: 'a6', report: 'vs', role: 'Report Access Manager' })
    await switched(tables)
    await switched(tables)
    expect(tables['dash.report_access'].filter(r => r.person).length).toBe(1)
    expect(tables['dash.switch_over_log'].filter(l => l.outcome === 'Not converted').map(l => l.source_grant)).toEqual(['a1', 'a6'])
  })

  it('adds nothing when run again, and never changes a role someone edited', async () => {
    const { tables } = await switched(await seeded())
    const role = tables['dash.business_role'].find(r => r.role_name === 'Store Manager')!
    role.description = 'Edited by the owner'
    tables['dash.business_role_permission'] = tables['dash.business_role_permission'].filter(p => p.business_role !== role.row_id || p.app !== 'Tickets')
    // #1340: each run is kept as a record of its own; nothing else changes.
    const others = () => JSON.stringify({ ...tables, 'dash.setup_run': undefined })
    const before = others()
    const runs = (tables['dash.setup_run'] ?? []).length
    expect(await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never)).toMatchObject({ grants_added: 0, grants_not_converted: 1 })
    expect(await addStartingRoles(context(tables) as never)).toMatchObject({ roles: 0, titles: 0 })
    expect(others()).toBe(before)
    expect(tables['dash.setup_run'].length).toBe(runs + 2)
  })

  // #1340: each run is one record, its counts in its title, the lines it wrote linked to it; a rerun is kept too, adding nothing.
  it('keeps each run as one record with its counts, its log lines linked to it', async () => {
    const tables = await seeded()
    tables['dash.report'] = REPORT_ROWS
    const first = await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never) as { run: string; grants_added: number }
    const run = tables['dash.setup_run'].find(r => r.row_id === first.run)!
    expect(run).toMatchObject({ step: 'Give Old Grants To Business Roles', added: first.grants_added, already_there: 0, not_carried_over: 1, run_by_name: 'Manju Manager',
      summary: `Give Old Grants To Business Roles: ${first.grants_added} added · 0 already there · 1 not carried over` })
    expect(tables['dash.switch_over_log'].filter(l => l.setup_run === first.run).length).toBe(first.grants_added + 1)
    const again = await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never) as { run: string }
    expect(tables['dash.setup_run'].find(r => r.row_id === again.run)!.summary)
      .toBe(`Give Old Grants To Business Roles: 0 added · ${first.grants_added} already there · 1 not carried over`)
    expect(tables['dash.switch_over_log'].filter(l => l.setup_run === again.run)).toEqual([])
  })

  // Codex adversarial round 1: a removed role grant stays removed.
  it('never gives an old grant to a role again once its role grant was removed', async () => {
    const { tables } = await switched(await seeded())
    const converted = tables['dash.report_access'].find(r => r.report === 'sales' && r.business_role === roleId(tables, 'Store Manager'))!
    converted.removed = 1
    expect(await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never)).toMatchObject({ grants_added: 0, grants_not_converted: 1 })
  })

  it('logs a role that already had the report once, and does not give it again', async () => {
    const tables = await seeded()
    const sm = String(tables['dash.business_role'].find(r => r.role_name === 'Store Manager')!.row_id)
    tables['dash.report_access'].push({ row_id: 'a7', report: 'sales', business_role: sm, access_key: `report:sales/business_role:${sm}` })
    await switched(tables)
    expect(tables['dash.report_access'].filter(r => r.report === 'sales' && r.business_role === sm).length).toBe(1)
    expect(tables['dash.switch_over_log'].filter(l => l.outcome === 'Already given').map(l => l.source_grant)).toEqual(['a2'])
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
    // A head office in the East is in the region and is no store.
    tables.Site.push({ row_id: 'EHO', name: 'East office', is_store: false, operating_region: 'East' })
    tables.Plant.push({ row_id: '9980', site: 'EHO', plant_type: 'Store' })
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

  // Codex round 2: the bulk comparison read Site without its kind, so it disagreed with Explain and live reach.
  it('reads Site the same way in the bulk comparison and in Explain, with its kind and status where the instance has them', async () => {
    const tables = await kinds()
    const base = context(tables).baseTables as never
    const bulk = await memoryDocuments(base, false).rows('Site')
    const explain = await directDocuments(base, false).rows('Site')
    expect(bulk).toEqual(explain)
    expect(bulk.find(r => r.row_id === 'CLS')).toMatchObject({ site_kind: 'Store', status: 'Closed' })
    expect(bulk.filter(openStore).map(r => r.row_id).sort()).toEqual(['HIL', 'LKS'])
    for (const site of tables.Site) { delete site.site_kind; delete site.status }
    const [bulkOld, explainOld] = [await memoryDocuments(base, false).rows('Site'), await directDocuments(base, false).rows('Site')]
    expect(bulkOld).toEqual(explainOld)
    expect(bulkOld.some(r => 'site_kind' in r)).toBe(false)
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

// #1277: the edges of the business-role paths, each a rule a reader can name.
describe('business roles at their edges', () => {
  it('merges two roles\' places on one store: their subcategories together, a whole store whole, reasons and bases once', () => {
    const part = (codes: string[], basis?: string) => ({ label: 'L', filters: { store: ['9901'], subcategory: codes }, ...(basis ? { basis } : {}), reasons: [{ text: basis ?? 'none' }] })
    expect(mergePlaces([part(['b', 'a'], 'x'), part(['c', 'a'], 'y')])).toEqual([{ label: 'L', filters: { store: ['9901'], subcategory: ['a', 'b', 'c'] }, basis: 'x, y', reasons: [{ text: 'x' }, { text: 'y' }] }])
    expect(mergePlaces([{ label: 'L', filters: { store: ['9901'] } }, part(['a'])])).toEqual([{ label: 'L', filters: { store: ['9901'] }, basis: '', reasons: [{ text: 'none' }] }])
    expect(mergePlaces([part(['a'], 'x'), { label: 'L', filters: { store: ['9901'], subcategory: ['b'] }, basis: 'y' }])[0].reasons).toEqual([{ text: 'x' }])
  })

  it('gives a Regional Head placed at a site with no region nothing, and says so on Explain', async () => {
    const { tables } = await switched()
    await giveRole(context(tables, { payload: { person: 'consultant', change: 'Also give', role: roleId(tables, 'Regional Head'), site: 'LKS' } }) as never)
    tables.Site.find(s => s.row_id === 'LKS')!.operating_region = null
    const explained = await explainPerson(context(tables, { payload: { person: 'consultant' }, peopleRoles: { consultant: ['Dash Reader'] } }) as never)
    expect([await scopeOf(tables, 'consultant'), explained.roles.map(r => r.area.parts.map(p => p.name))]).toEqual([{}, [['No region on this site']]])
  })

  it('explains a Regional Head given at a store to someone with no job by that store\'s region', async () => {
    const { tables } = await switched()
    await giveRole(context(tables, { payload: { person: 'consultant', change: 'Also give', role: roleId(tables, 'Regional Head'), site: 'LKS' } }) as never)
    const explained = await explainPerson(context(tables, { payload: { person: 'consultant' }, peopleRoles: { consultant: ['Dash Reader'] } }) as never)
    expect([explained.roles.map(r => r.area.parts.map(p => p.name)), await scopeOf(tables, 'consultant')]).toEqual([[['East']], { 9901: null }])
  })

  it('says a role with no Reaches set reaches nothing yet', async () => {
    const { tables } = await switched()
    tables['dash.business_role'].push({ row_id: 'r-x', role_name: 'Auditor' })
    tables['dash.role_assignment'].push({ row_id: 'h-x', person: 'st', change: 'Also give', business_role: 'r-x', updated_at: 'x' })
    const explained = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
    expect(explained.roles.find(r => r.name === 'Auditor')!.area.parts[0].name).toContain('nothing yet')
  })

  it('leaves a buyer\'s Buyer Sections to them and another person\'s to that person, under a category head\'s role', async () => {
    const { tables } = await switched(await seeded())
    tables['Buyer Section'] = [{ row_id: 'BS-O', name: 'Other section', operating_region: 'East', buyer: 'E-ST', starts_on: '2026-01-01' }]
    tables['Buyer Section Subcategory'] = [{ row_id: 'BL-O', buyer_section: 'BS-O', subcategory: '010101002', starts_on: '2026-01-01' }]
    // Another person's Buyer Section takes 010101002 from the category head's Buyer-row-free area: Category head rows are not Buyer rows.
    expect(await scopeOf(tables, 'buy')).toEqual({ 9901: ['010101001', '010101002'] })
  })

  // Decision 7: Dash All-Stores Reader's grants are not carried over, even to a whole-company role that opens Dash.
  it('carries a grant to Dash All-Stores Reader to no role, even one reaching the whole company that opens Dash', async () => {
    const tables = await seeded()
    tables['dash.business_role'].find(r => r.role_name === 'Owner Director')!.by_hand_only = false
    const { model } = await businessModel(context(tables).baseTables as never, today)
    expect([rolesForOldRole('Dash All-Stores Reader', model), rolesForOldRole('Report Access Manager', model)]).toEqual([[], []])
  })

  it('carries a grant to Dash Reader to no manager role given by hand only, renamed, or added by an admin', async () => {
    const tables = await seeded()
    const named = (ids: string[]) => ids.map(id => tables['dash.business_role'].find(r => r.row_id === id)!.role_name).sort()
    tables['dash.business_role'].find(r => r.role_name === 'Buyer')!.by_hand_only = true
    tables['dash.business_role'].find(r => r.role_name === 'Store Manager')!.role_name = 'Store Head'
    tables['dash.business_role'].push({ row_id: 'r-new', role_name: 'Auditor', reaches: 'Store', by_hand_only: false })
    tables['dash.business_role_permission'].push({ row_id: 'p-new', business_role: 'r-new', app: 'Dash', level: 'Reader', verb: 'View', thing: 'Reports', reach: 'Area' })
    const { model } = await businessModel(context(tables).baseTables as never, today)
    expect(named(rolesForOldRole('Dash Reader', model))).toEqual(['Category Head', 'Cluster Manager', 'Department Manager', 'Division Head', 'Floor Manager', 'Regional Head', 'Team Leader'])
  })

  it('carries no grant to a job, names gone reports and bundles plainly, and skips a bad row', async () => {
    const tables = await seeded()
    tables['dash.report_bundle'].push({ row_id: 'b1', bundle_name: 'Store pack' })
    tables['dash.report_access'] = [
      { row_id: 'g1', report_bundle: 'b1', job: 'Store Manager' }, { row_id: 'g2', report_bundle: 'b9', job: 'Store Manager' },
      { row_id: 'g3', report: 'gone', job: 'Store Manager' }, { row_id: 'g4', report: 'vs', report_bundle: 'b1', job: 'Store Manager' },
      { row_id: 'g5', report: 'vs', job: 'Floor In-charge' },
    ]
    tables['dash.report'] = REPORT_ROWS
    expect(await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never)).toMatchObject({ grants_added: 0, grants_not_converted: 4 })
    const left = 'is not carried over to business roles: add it to a role on request. It stays as it was, and gives nothing while business roles decide'
    expect(tables['dash.switch_over_log'].filter(l => l.step === 'Report grant').map(l => l.detail)).toEqual([
      `The grant of the bundle Store pack to the job Store Manager ${left}`,
      `The grant of the bundle no longer listed to the job Store Manager ${left}`,
      `The grant of the report no longer listed to the job Store Manager ${left}`,
      `The grant of the report Vendor Sales to the job Floor In-charge ${left}`,
    ])
  })

  it('says to a manager what decides Dash access and what was done, and refuses anyone else', async () => {
    const tables0 = await richWorld()
    tables0['dash.report_access'].push({ row_id: 'g-n', report: 'vs', role: 'Report Access Manager' })
    tables0['dash.report_bundle'] = [...tables0['dash.report_bundle'] ?? [], { row_id: 'b-x', bundle_name: 'Store pack' }]
    tables0['dash.report_access'].push({ row_id: 'g-b', report_bundle: 'b-x', role: 'Dash Reader' })
    const { tables } = await switched(tables0)
    expect(await businessAccessSummary(context(tables, { roles: ['System Manager'] }) as never)).toMatchObject({ source: 'business_roles', switch_rows: [{ id: 's1', source: 'business_roles' }], can_switch: true })
    expect(await businessAccessSummary(context(tables) as never)).toMatchObject({ can_switch: false })
    const log = await reads.switch_over_log(context(tables) as never)
    expect([log.length > 0, log.every((l, i) => i === 0 || `${log[i - 1].at}${log[i - 1].id}` >= `${l.at}${l.id}`)]).toEqual([true, true])
    expect(log.find(l => l.outcome === 'Not converted')).toMatchObject({ business_role: null, source_grant: 'g-n' })
    // #1282 H1–H4: a line given to a role names the role and the report as links, in its own words.
    const added = log.find(l => l.outcome === 'Added' && l.parts.some(p => typeof p !== 'string' && p.record.table === 'dash.report'))!
    expect([added.parts.map(p => (typeof p === 'string' ? p : p.record.name)).join(''), added.parts.flatMap(p => (typeof p === 'string' ? [] : [p.record.table])).sort()])
      .toEqual([added.detail, ['dash.business_role', 'dash.report']])
    expect(log.some(l => l.parts.some(p => typeof p !== 'string' && p.record.table === 'dash.report_bundle'))).toBe(true)
    // Codex adversarial round 2: a bundle the caller may not read is not linked, nor its id given.
    const blind = context(tables)
    const list = blind.documents.list
    blind.documents.list = (async (table: string, args: never) => (table === 'dash.report_bundle' ? [] : list(table, args))) as typeof list
    expect(JSON.stringify((await switchOverLog(blind as never)).map(l => l.parts))).not.toContain('b-x')
    expect((await reads.access_source(context(tables) as never)).source).toBe('business_roles')
    await expect(switchOverLog(context(tables, { roles: ['Dash Reader'] }) as never)).rejects.toThrow('Only a Report Access Manager')
    await expect(businessAccessSummary(context(tables, { roles: ['Dash Reader'] }) as never)).rejects.toThrow('Only a Report Access Manager')
    await expect(actions.give_old_grants_to_roles({ ...context(tables), roles: undefined } as never)).rejects.toThrow('Only a System Manager')
  })

  it('opens Dash under business roles for a Report Access Manager straight away', async () => {
    const { tables } = await switched()
    expect(await reads.can_open(readerOf(tables, 'nobody', ['Report Access Manager']) as never)).toBe(true)
  })

  it('lists grants to business roles on Report access, naming a role no longer there plainly, and offers the roles to give to', async () => {
    const { tables } = await switched(await seeded())
    tables['dash.report_access'].push({ row_id: 'g-x', report: 'vs', business_role: 'r-gone' })
    const page = await accessPage(context(tables) as never, today)
    expect(page.rows.filter(r => r.to?.kind === 'Business role').map(r => r.to!.name)).toContain('A business role no longer listed')
    expect(page.business_roles.map(r => r.name)).toEqual([...page.business_roles.map(r => r.name)].sort())
  })

  it('marks in Waiting for access a bundle that reaches someone through their business role', async () => {
    const { tables } = await switched(await seeded())
    tables['dash.report_bundle'].push({ row_id: 'b1', bundle_name: 'Store pack' })
    tables['dash.report_bundle_member'].push({ row_id: 'm1', report_bundle: 'b1', report: 'vs' })
    tables['dash.report_bundle'].push({ row_id: 'b2', bundle_name: 'Other pack' })
    tables['dash.report_access'].push({ row_id: 'g-b', report_bundle: 'b1', business_role: roleId(tables, 'Store Manager') })
    const options = await grantOptions(context(tables, { payload: { person: 'sm' } }) as never, today)
    expect(options.choices.filter(c => c.group === 'Bundle').map(c => [c.label, c.given])).toEqual([['Other pack', false], ['Store pack', true]])
  })
})

describe('reading every row', () => {
  it('reads a Table in pages of 500 until a short page', async () => {
    const rows = Array.from({ length: 503 }, (_, n) => ({ row_id: String(n) }))
    const docs = { list: async (_t: string, args: { limit_start: number; limit_page_length: number }) => rows.slice(args.limit_start, args.limit_start + args.limit_page_length) }
    expect((await every(docs as never, 'X', [])).length).toBe(503)
  })
})


// #1277 (owner, 18-Nov-2026): Owner Director holds View Reports at reach All: "the whole company and every report".
describe('a role viewing every report', () => {
  /** A second store, Riverside, so every store is more than one; Owner Director given by hand to someone with no grant. */
  async function withOwnerDirector(tables?: Record<string, Row[]>) {
    const world = tables ?? await seeded()
    world.Site.push({ row_id: 'RVS', name: 'Riverside', is_store: true, cluster: null, operating_region: 'West' })
    world.Plant.push({ row_id: '9902', site: 'RVS', plant_type: 'Store' })
    world.Employee.push({ row_id: 'E-OD', name: 'Omana', employee_code: 'E-OD', status: 'Current', person: 'od' })
    await giveRole(context(world, { payload: { person: 'od', change: 'Also give', role: roleId(world, 'Owner Director') } }) as never)
    return world
  }
  /** A role an admin adds later: reaches one store, and views every report. */
  function auditor(tables: Record<string, Row[]>, reach: 'All' | 'Area', over: Partial<Row> = {}) {
    tables['dash.business_role'].push({ row_id: 'r-aud', role_name: 'Auditor', reaches: 'Store', by_hand_only: true })
    tables['dash.business_role_permission'].push({ row_id: 'p-aud', business_role: 'r-aud', app: 'Dash', level: 'Reader', verb: 'View', thing: 'Reports', reach, ...over })
  }

  it('offers every report on Explain, at every store, saying why in plain words', async () => {
    const explained = await explainPerson(context(await withOwnerDirector(), { payload: { person: 'od' } }) as never)
    expect([explained.reports.map(r => [r.name, r.why]), explained.next.stores, explained.change.every_report])
      .toEqual([[['Sales', ['Every report, through Owner Director']], ['Vendor Sales', ['Every report, through Owner Director']]], 2, ['Owner Director']])
  })

  it('says so on the comparison', async () => {
    const row = (await accessChanges(context(await withOwnerDirector(), { peopleRoles: { od: ['Dash Reader'] } }) as never)).groups.flatMap(g => g.people).find(p => p.person === 'od')!
    expect([row.every_report, row.gained.map(r => r.name), row.stores_gained.map(s => s.name)]).toEqual([['Owner Director'], ['Sales', 'Vendor Sales'], ['Lakeside', 'Riverside']])
  })

  it('opens every report and every store live, once business roles decide', async () => {
    const { tables } = await switched(await withOwnerDirector())
    const reader = readerOf(tables, 'od', ['Dash Reader'])
    expect([(await reportsFor(reader as never)).map(r => r.report_key).sort(), await scopeOf(tables, 'od')]).toEqual([['sales', 'vs'], { 9901: null, 9902: null }])
    const looked = await personLookup(context(tables, { payload: { person: 'od' }, peopleRoles: { od: ['Dash Reader'] } }) as never, today, async () => ({ any: true, wholeStore: true }))
    expect(looked.reports.map(r => r.because)).toEqual([['Every report, through Owner Director'], ['Every report, through Owner Director']])
  })

  it('marks every bundle as given', async () => {
    const { tables } = await switched(await withOwnerDirector())
    tables['dash.report_bundle'].push({ row_id: 'b2', bundle_name: 'Other pack' })
    const options = await grantOptions(context(tables, { payload: { person: 'od' } }) as never, today)
    expect(options.choices.filter(c => c.group === 'Bundle').map(c => c.given)).toEqual([true])
  })

  it('holds for any role an admin gives View Reports at reach All, wherever the role reaches', async () => {
    const tables = await seeded()
    tables.Site.push({ row_id: 'RVS', name: 'Riverside', is_store: true, cluster: null, operating_region: 'West' })
    tables.Plant.push({ row_id: '9902', site: 'RVS', plant_type: 'Store' })
    auditor(tables, 'All', { verb: ' view ', thing: 'REPORTS' })
    await giveRole(context(tables, { payload: { person: 'st', change: 'Also give', role: 'r-aud', site: 'LKS' } }) as never)
    const explained = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
    expect([explained.reports.map(r => r.why), explained.next.stores]).toEqual([[['Every report, through Auditor'], ['Every report, through Auditor']], 2])
  })

  it('gives nothing more to a role viewing reports at any narrower reach, nor through another app, verb or thing', async () => {
    for (const over of [{ reach: 'Area' }, { app: 'Tasker' }, { verb: 'Give' }, { thing: 'Sections' }]) {
      const tables = await seeded()
      auditor(tables, 'All', over)
      await giveRole(context(tables, { payload: { person: 'st', change: 'Also give', role: 'r-aud', site: 'LKS' } }) as never)
      const explained = await explainPerson(context(tables, { payload: { person: 'st' } }) as never)
      expect([over, explained.reports, explained.change.every_report]).toEqual([over, [], []])
    }
  })

  it('leaves a store manager with only the reports given, live', async () => {
    const { tables } = await switched(await withOwnerDirector())
    // Vendor Sales, given to the job Store Manager, is not carried over (decision 7).
    expect((await reportsFor(readerOf(tables, 'sm', ['Dash Reader']) as never)).map(r => r.report_key).sort()).toEqual(['sales'])
  })
})

// #1277 (owner's decisions of 18-Nov-2026): Division Head, and visual merchandising's two roles.
describe('Division Head and visual merchandising', () => {
  const GRANTS = (tables: Record<string, Row[]>, name: string) => tables['dash.business_role_permission'].filter(p => p.business_role === roleId(tables, name))
    .map(p => [p.app, p.level, p.verb, p.thing, p.reach].join(' · ')).sort()
  /** East has Lakeside and Hillview, West has Riverside; Home is a second division, with a consumable that no buyer reaches. */
  async function divisions() {
    const { tables } = await switched()
    tables.Site.push({ row_id: 'HIL', name: 'Hillview', is_store: true, operating_region: 'East' }, { row_id: 'RIV', name: 'Riverside', is_store: true, operating_region: 'West' })
    tables.Plant.push({ row_id: '9902', site: 'HIL', plant_type: 'Store' }, { row_id: '9903', site: 'RIV', plant_type: 'Store' })
    for (const s of tables.Subcategory) s.division = 'Fashion'
    tables.Subcategory.push({ row_id: '020101001', subcategory: 'Pans', division: 'Home', subdivision: 'Kitchenware', category: 'Cookware', subcategory_type: 'Merchandise' },
      { row_id: '020201001', subcategory: 'Cushions', division: 'Home', subdivision: 'Furnishing', category: 'Decor', subcategory_type: 'Merchandise' },
      { row_id: '020901001', subcategory: 'Carry bags', division: 'Home', subdivision: 'Store use', category: 'Bags', subcategory_type: 'Consumable' })
    const person = (row_id: string, name: string, login: string) => tables.Employee.push({ row_id, name, employee_code: row_id, status: 'Current', person: login })
    person('E-DIV', 'Devika', 'div')
    tables['Merchandise Assignment'].push({ row_id: 'M-DIV', employee: 'E-DIV', responsibility: 'Division head', division: 'Home', operating_region: 'East', starts_on: '2026-01-01' })
    tables.Designation.push({ row_id: 'D-VMM', designation: 'Manager - visual merchandising' }, { row_id: 'D-VM', designation: 'Visual merchandiser' }, { row_id: 'D-MER', designation: 'Merchandiser' })
    person('E-VMM', 'Vimala', 'vmm'); tables['Job Assignment'].push({ row_id: 'J-VMM', employee: 'E-VMM', job: 'Staff', designation: 'D-VMM', site: 'LKS', section: 'S1', starts_on: '2026-01-01' })
    person('E-VM', 'Vasu', 'vm'); tables['Job Assignment'].push({ row_id: 'J-VM', employee: 'E-VM', job: 'Staff', designation: 'D-VM', site: 'HIL', starts_on: '2026-01-01' })
    person('E-MER', 'Meena', 'mer'); tables['Job Assignment'].push({ row_id: 'J-MER', employee: 'E-MER', job: 'Staff', designation: 'D-MER', site: 'LKS', section: 'S1', starts_on: '2026-01-01' })
    return tables
  }

  it('gives Division Head a Category Head\'s permissions, Edit Buyer Sections among them, reaching Merchandise', async () => {
    const tables = await seeded()
    expect(GRANTS(tables, 'Division Head')).toEqual(GRANTS(tables, 'Category Head'))
    expect(GRANTS(tables, 'Division Head')).toContain('Dash · Manager · Edit · Buyer Sections · Area')
    expect(tables['dash.business_role'].find(r => r.role_name === 'Division Head')!.reaches).toBe('Merchandise')
  })

  it('gives both visual merchandising roles reports in their area, their team\'s tasks and tickets, and nothing to give or edit', async () => {
    const tables = await seeded()
    const expected = ['Dash · Reader · View · Reports · Area', 'Tasker · Manager · Edit · Tasks · Team', 'Tickets · Manager · View · Tickets · Team']
    expect([GRANTS(tables, 'Visual Merchandising Manager'), GRANTS(tables, 'Visual Merchandiser')]).toEqual([expected, expected])
    expect(['Visual Merchandising Manager', 'Visual Merchandiser'].map(n => tables['dash.business_role'].find(r => r.role_name === n)!.reaches)).toEqual(['Region', 'Store'])
  })

  it('maps the three titles to their roles, and leaves Merchandiser unmapped', async () => {
    const tables = await seeded()
    const mapped = (title: string) => tables['dash.business_role'].find(r => r.row_id === tables['dash.title_map'].find(t => t.title === title)?.business_role)?.role_name
    expect(['Division head', 'Manager - visual merchandising', 'Visual merchandiser', 'Merchandiser'].map(mapped)).toEqual(['Division Head', 'Visual Merchandising Manager', 'Visual Merchandiser', undefined])
  })

  it('adds only the new roles and titles to an instance that already has the others, leaving edited roles as they are', async () => {
    const tables = await seeded()
    const NEW = ['Division Head', 'Visual Merchandising Manager', 'Visual Merchandiser', 'Report Analyst']
    const ids = NEW.map(n => roleId(tables, n))
    tables['dash.business_role'] = tables['dash.business_role'].filter(r => !ids.includes(String(r.row_id)))
    tables['dash.business_role_permission'] = tables['dash.business_role_permission'].filter(p => !ids.includes(String(p.business_role)))
    tables['dash.title_map'] = tables['dash.title_map'].filter(t => !ids.includes(String(t.business_role)))
    // The owner has edited Category Head and dropped its Tickets permission.
    const head = tables['dash.business_role'].find(r => r.role_name === 'Category Head')!
    head.description = 'Edited by the owner'
    tables['dash.business_role_permission'] = tables['dash.business_role_permission'].filter(p => p.business_role !== head.row_id || p.app !== 'Tickets')
    // Every row already there stays as it was; the click only appends.
    const SHADOW = ['dash.business_role', 'dash.business_role_permission', 'dash.title_map']
    const counts = SHADOW.map(name => tables[name].length)
    const before = JSON.stringify(SHADOW.map(name => tables[name]))
    // A context of its own numbering, so the new rows' keys never repeat the old ones'.
    const ctx = context(tables)
    const create = ctx.documents.create
    ctx.documents.create = async (table: string, values: Row) => { const row = await create(table, values); row.row_id = `new-${row.row_id}`; return row }
    expect(await addStartingRoles(ctx as never)).toMatchObject({ roles: 4, titles: 3 })
    expect(JSON.stringify(SHADOW.map((name, i) => tables[name].slice(0, counts[i])))).toBe(before)
    expect(tables['dash.business_role'].slice(counts[0]).map(r => r.role_name)).toEqual(NEW)
    expect(GRANTS(tables, 'Division Head')).toContain('Dash · Manager · Edit · Buyer Sections · Area')
    expect(tables['dash.title_map'].filter(t => t.business_role === roleId(tables, 'Division Head')).map(t => t.title)).toEqual(['Division head'])
    expect(await addStartingRoles(context(tables) as never)).toMatchObject({ roles: 0, titles: 0 })
  })

  it('gives a division head every merchandise subcategory of their division, at every store of their region and no other', async () => {
    const tables = await divisions()
    expect(await scopeOf(tables, 'div', ['Dash Reader'])).toEqual({ 9901: ['020101001', '020201001'], 9902: ['020101001', '020201001'] })
    const explained = await explainPerson(context(tables, { payload: { person: 'div' }, peopleRoles: { div: ['Dash Reader'] } }) as never)
    expect(explained.roles.map(r => [r.name, r.source, r.area.parts.map(p => p.name)])).toEqual([['Division Head', 'From merchandise assignment', ['Home', 'East']]])
  })

  it('gives a visual merchandising manager every store of their store\'s region, and a visual merchandiser their own store', async () => {
    const tables = await divisions()
    expect(await scopeOf(tables, 'vmm', ['Dash Reader'])).toEqual({ 9901: null, 9902: null })
    expect(await scopeOf(tables, 'vm', ['Dash Reader'])).toEqual({ 9902: null })
  })

  it('leaves a merchandiser where their job puts them', async () => {
    const tables = await divisions()
    expect(await scopeOf(tables, 'mer', ['Dash Reader'])).toEqual(await scopeOf(tables, 'st', ['Dash Reader']))
  })
})

// #1277 (owner's decision 7, 18-Nov-2026: start narrow; add on request).
describe('Give Old Grants To Business Roles carries only the grants to Dash Reader, to the manager roles', () => {
  const MANAGERS = ['Buyer', 'Category Head', 'Cluster Manager', 'Department Manager', 'Division Head', 'Floor Manager', 'Regional Head', 'Store Manager', 'Team Leader']
  const givenTo = (tables: Record<string, Row[]>, report: string) => tables['dash.report_access'].filter(r => r.report === report && r.business_role)
    .map(r => tables['dash.business_role'].find(b => b.row_id === r.business_role)!.role_name).sort()

  it('gives a grant to Dash Reader to the manager roles that open Dash, and to no visual merchandising, hand-only or Dash-less role', async () => {
    const { tables } = await switched(await seeded())
    expect(givenTo(tables, 'sales')).toEqual(MANAGERS)
  })

  it('leaves a grant to a job, to Dash All-Stores Reader and to a person where it is, logging each one it does not carry over', async () => {
    const tables = await seeded()
    tables['dash.report_access'].push({ row_id: 'a8', report: 'vs', role: 'Dash All-Stores Reader' }, { row_id: 'a9', report: 'vs', person: 'st' })
    const { result } = await switched(tables)
    expect([givenTo(tables, 'vs'), result]).toEqual([[], expect.objectContaining({ grants_added: MANAGERS.length, grants_not_converted: 2 })])
    expect(tables['dash.switch_over_log'].filter(l => l.outcome === 'Not converted').map(l => [l.source_grant, l.detail])).toEqual([
      ['a1', 'The grant of the report Vendor Sales to the job Store Manager is not carried over to business roles: add it to a role on request. It stays as it was, and gives nothing while business roles decide'],
      ['a8', 'The grant of the report Vendor Sales to the role Dash All-Stores Reader is not carried over to business roles: add it to a role on request. It stays as it was, and gives nothing while business roles decide']])
    expect(tables['dash.report_access'].filter(r => r.person).map(r => r.row_id)).toEqual(['a9'])
  })

  it('gives the visual merchandising roles no report', async () => {
    const tables = await seeded()
    tables.Designation.push({ row_id: 'D-VM', designation: 'Visual merchandiser' })
    tables.Employee.push({ row_id: 'E-VM', name: 'Vasu', employee_code: 'E-VM', status: 'Current', person: 'vm' })
    tables['Job Assignment'].push({ row_id: 'J-VM', employee: 'E-VM', job: 'Store Manager', designation: 'D-VM', site: 'LKS', starts_on: '2026-01-01' })
    await switched(tables)
    expect([givenTo(tables, 'sales'), givenTo(tables, 'vs')].flat()).not.toContain('Visual Merchandiser')
    expect(givenTo(tables, 'sales')).not.toContain('Visual Merchandising Manager')
    const explained = await explainPerson(context(tables, { payload: { person: 'vm' }, peopleRoles: { vm: ['Dash Reader'] } }) as never)
    expect([explained.roles.map(r => r.name), explained.reports]).toEqual([['Visual Merchandiser'], []])
  })

  it('lists each grant not carried over on Who Would Gain Or Lose Access, with the people who would lose its reports', async () => {
    const tables = await seeded()
    tables['dash.report'] = REPORT_ROWS
    await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never)
    const answer = await accessChanges(context(tables, { peopleRoles: { sm: ['Dash Reader'], st: ['Dash Reader'], buy: ['Dash Reader'], ho: ['Dash Reader'] } }) as never)
    expect(answer.not_carried_over).toEqual([{ grant: 'a1', gives: { name: 'Vendor Sales', table: 'dash.report', id: 'vs' }, receiver: { kind: 'job', name: 'Store Manager' },
      note: 'Not carried over: add on request', people: [{ person: 'sm', name: 'Selvi', reports: [{ name: 'Vendor Sales', table: 'dash.report', id: 'vs' }] }] }])
  })

  it('names a report or a bundle no longer listed plainly, and lists who would lose a bundle given to a role', async () => {
    const tables = await seeded()
    tables['dash.report_bundle_member'].push({ row_id: 'bm9', report_bundle: 'b-gone', report: 'vs' })
    tables['dash.report_access'] = [{ row_id: 'g1', report: 'gone', job: 'Store Manager' }, { row_id: 'g2', report_bundle: 'b-gone', role: 'Dash All-Stores Reader' }]
    const answer = await accessChanges(context(tables, { peopleRoles: { sm: ['Dash All-Stores Reader'], st: [], buy: [], ho: [] } }) as never)
    expect(answer.not_carried_over.map(g => [g.gives.name, g.receiver.name, g.people.map(p => [p.name, p.reports.map(r => r.id)])])).toEqual([
      ['No longer listed', 'Dash All-Stores Reader', [['Selvi', ['vs']]]],
      ['No longer listed', 'Store Manager', []]])
  })
})

// #1277 (owner, 18-Nov-2026): Report Analyst, given by hand: every store, and only the reports given to them as a person.
describe('Report Analyst', () => {
  async function analyst(grant: boolean) {
    const { tables } = await switched()
    tables.Site.push({ row_id: 'HIL', name: 'Hillview', is_store: true, operating_region: 'East' }, { row_id: 'RIV', name: 'Riverside', is_store: true, operating_region: 'West' })
    tables.Plant.push({ row_id: '9902', site: 'HIL', plant_type: 'Store' }, { row_id: '9903', site: 'RIV', plant_type: 'Store' })
    tables.Employee.push({ row_id: 'E-RA', name: 'Rekha', employee_code: 'E-RA', status: 'Current', person: 'ra' })
    tables['Job Assignment'].push({ row_id: 'J-RA', employee: 'E-RA', job: 'Head office staff', site: 'HOF', starts_on: '2026-01-01' })
    if (grant) tables['dash.report_access'].push({ row_id: 'a-ra', report: 'sales', person: 'ra' })
    await giveRole(context(tables, { roles: ['System Manager'], payload: { person: 'ra', change: 'Also give', role: roleId(tables, 'Report Analyst') } }) as never)
    return tables
  }

  it('is given by hand only, reaches the whole company, and views reports in its area, never at reach All', async () => {
    const tables = await seeded()
    const role = tables['dash.business_role'].find(r => r.role_name === 'Report Analyst')!
    expect([role.reaches, role.by_hand_only, role.description]).toEqual(['Whole company', true, 'Analyses reports across the company: sees every store, and the reports given to them as a person.'])
    expect(tables['dash.business_role_permission'].filter(p => p.business_role === role.row_id).map(p => [p.app, p.level, p.verb, p.thing, p.reach].join(' · ')).sort())
      .toEqual(['Dash · Reader · View · Reports · Area', 'Tasker · User · Edit · Tasks · Own', 'Tickets · User · Raise · Tickets · Own'])
    expect(tables['dash.title_map'].map(t => t.business_role)).not.toContain(role.row_id)
  })

  it('gets no store bundle or any grant to Dash Reader from Give Old Grants To Business Roles', async () => {
    const { tables } = await switched(await seeded())
    expect(tables['dash.report_access'].filter(r => r.business_role === roleId(tables, 'Report Analyst'))).toEqual([])
  })

  it('opens a report given to them as a person at every store', async () => {
    const tables = await analyst(true)
    expect(await scopeOf(tables, 'ra', ['Dash Reader'])).toEqual({ 9901: null, 9902: null, 9903: null })
    expect((await reportsFor(readerOf(tables, 'ra', ['Dash Reader']) as never)).map(r => r.report_key)).toEqual(['sales'])
  })

  it('gets no report with no grant to them as a person', async () => {
    const tables = await analyst(false)
    expect((await reportsFor(readerOf(tables, 'ra', ['Dash Reader']) as never)).map(r => r.report_key)).toEqual([])
  })
})

// #1340: business roles in Featherbase's own list and record page, Give Old Grants' preview, and Let Them Lose Dash.
describe('business roles described for Featherbase (#1340)', () => {

  it('is refused to anyone the Business Roles page refused, so Featherbase draws its plain page', async () => {
    const tables = await seeded()
    await expect(describeBusinessRoles(context(tables, { roles: ['Dash Reader'], payload: { rows: [] } }) as never)).rejects.toThrow()
  })

  it('gives the list its columns, each asked-for role its facts and header, and no groups', async () => {
    const tables = await seeded()
    const sm = roleId(tables, 'Store Manager')
    const answer = await describeBusinessRoles(context(tables, { payload: { table: 'dash.business_role', rows: [sm], page: false } }) as never)
    expect(answer.columns.map(c => c.label)).toEqual(['People', 'Given By', 'What They Can Do', 'Reports', 'Opens Dash'])
    expect(Object.keys(answer.rows)).toEqual([sm])
    const row = answer.rows[sm] as { facts: Record<string, { text: string }>; header: string; groups?: unknown }
    expect(row.facts.people.text).toBe('1')
    expect(row.facts.given_by.text).toBe('HR title')
    expect(row.facts.opens_dash.text).toBe('Yes')
    expect(row.facts.can_do.text).toMatch(/^\d+ permissions?$/)
    expect(row.facts.reports.text).toBe('—')
    expect(row.header).toBe('Business role · 1 person · from HR title')
    expect(row.groups).toBeUndefined()
  })

  it('says a role nobody holds, and one given by hand, plainly', async () => {
    const tables = await seeded()
    const owner = roleId(tables, 'Owner Director')
    const answer = await describeBusinessRoles(context(tables, { payload: { rows: [owner] } }) as never)
    const row = answer.rows[owner] as { facts: Record<string, { text: string }>; header: string }
    expect([row.facts.people.text, row.facts.given_by.text, row.header]).toEqual(['0', '—', 'Business role · nobody yet'])
    await giveRole(context(tables, { payload: { person: 'ho', change: 'Also give', role: owner, reason: 'Made-up test' } }) as never)
    const again = (await describeBusinessRoles(context(tables, { payload: { rows: [owner], page: true } }) as never)).rows[owner] as
      { facts: Record<string, { text: string }>; groups: { key: string; lines?: { chip?: { label: string } }[] }[] }
    expect(again.facts.given_by.text).toBe('By hand')
    expect(again.groups.find(g => g.key === 'people')!.lines!.map(l => l.chip?.label)).toEqual(['given by hand'])
  })

  it("draws a role's page: its permissions as sentences, its reports' other holders, the HR titles that give it, and its people", async () => {
    const { tables } = await switched(await seeded())
    const sm = roleId(tables, 'Store Manager')
    const answer = await describeBusinessRoles(context(tables, { payload: { rows: [sm], page: true } }) as never)
    const groups = (answer.rows[sm] as { groups: { key: string; heading: string; table?: string; rows?: Record<string, { parts: unknown[]; chip?: unknown }>; notes?: Record<string, string>; lines?: { parts: unknown[] }[]; count?: number }[] }).groups
    expect(groups.map(g => [g.key, g.heading, g.table ?? null])).toEqual([
      ['can', 'What They Can Do', 'dash.business_role_permission'], ['reports', 'Reports', 'dash.report_access'],
      ['titles', 'HR Titles That Give It', 'dash.title_map'], ['people', 'People', null]])
    const can = groups[0]!
    const live = tables['dash.business_role_permission'].filter(p => p.business_role === sm)
    expect(Object.keys(can.rows!).sort()).toEqual(live.map(p => String(p.row_id)).sort())
    expect(Object.values(can.rows!)[0]!.parts[0]).toEqual({ record: { table: 'dash.business_role', row: sm, name: 'Store Managers' } })
    expect(groups[1]!.notes!.sales).toMatch(/^Also given to \d+ other roles: .+ and .+$/)
    expect(Object.values(groups[2]!.rows!)[0]).toMatchObject({ parts: [{ record: { table: 'dash.title_map' } }, expect.stringMatching(/^ → this role, for \d+ (person|people)$/)], chip: { label: 'from HR' } })
    // A Report Access Manager reads the names as words; a System Manager as links to the people.
    expect(groups[3]).toMatchObject({ count: 1, lines: [{ parts: ['Selvi'], chip: { label: 'from HR' } }] })
    const admin = (await describeBusinessRoles(context(tables, { roles: ['System Manager'], payload: { rows: [sm], page: true } }) as never)).rows[sm] as { groups: { lines?: { parts: unknown[] }[] }[] }
    expect(admin.groups[3]!.lines![0]!.parts).toEqual([{ record: { table: 'Person', row: 'sm', name: 'Selvi' } }])
  })

  it('says a report given to one role only, and leaves out a permission taken away', async () => {
    const { tables } = await switched(await seeded())
    const sm = roleId(tables, 'Store Manager')
    tables['dash.report_access'].push({ row_id: 'only', report: 'vs', business_role: sm, access_key: `report:vs/business_role:${sm}` })
    const gone = tables['dash.business_role_permission'].find(p => p.business_role === sm)!
    gone.removed = 1
    const groups = ((await describeBusinessRoles(context(tables, { payload: { rows: [sm], page: true } }) as never)).rows[sm] as { groups: { rows?: Record<string, unknown>; notes?: Record<string, string> }[] }).groups
    expect(groups[1]!.notes!.vs).toBe('Given to this role only')
    expect(Object.keys(groups[0]!.rows!)).not.toContain(String(gone.row_id))
  })

  it('offers the setup steps in Record actions, Give Old Grants to a System Manager only, and says which rules decide', async () => {
    const tables = await seeded()
    const manager = await describeBusinessRoles(context(tables, { payload: { rows: [] } }) as never)
    expect(manager.actions.map(a => a.key)).toEqual(['starting_roles', 'access_source', 'grid', 'runs'])
    expect(manager.actions[1]).toMatchObject({ label: 'Dash Access Source: Old Rules', href: '/featherbase/admin/table/dash.access_source' })
    tables['dash.access_source'] = [{ row_id: 's1', source: 'business_roles' }]
    const admin = await describeBusinessRoles(context(tables, { roles: ['System Manager'], payload: { rows: [] } }) as never)
    expect(admin.actions.map(a => a.key)).toEqual(['starting_roles', 'old_grants', 'access_source', 'grid', 'runs'])
    expect(admin.actions[1]).toMatchObject({ href: OLD_GRANTS_PAGE })
    expect(admin.actions[2]).toMatchObject({ label: 'Dash Access Source: Business Roles', href: '/featherbase/admin/table/dash.access_source/row/s1',
      explain: 'The one switch. Set it to Old rules to put the old rules back.' })
  })

  it('previews Give Old Grants as its run would do it, writing nothing; after the run, each is already there', async () => {
    const tables = await seeded()
    tables['dash.report'] = REPORT_ROWS
    tables['dash.report_access'].push({ row_id: 'a9', report: 'vs', person: 'st' }, { row_id: 'a10', report_bundle: 'gone', role: 'Dash Reader' })
    const before = JSON.stringify(tables)
    const preview = await giveOldGrantsPreview(context(tables) as never)
    expect(JSON.stringify(tables)).toBe(before)
    expect(preview.rows.map(r => [r.filter, (r.cells.what as { text: string }).text])).toEqual([
      ['not', 'Not carried over: gives nothing while business roles decide'], ['add', 'Will be added'], ['not', 'Stays with the person'], ['add', 'Will be added']])
    expect(preview.rows[2]!.cells.old_grant).toEqual({ parts: ['Person: ', { record: { table: 'Person', row: 'st', name: 'Siva' } }] })
    expect(preview.rows[3]!.cells.report).toEqual({ parts: ['A bundle no longer listed'] })
    expect(preview.rows[0]!.cells).toMatchObject({ old_grant: { text: 'Job: Store Manager' }, given_to: { text: '—' }, report: { parts: [{ record: { table: 'dash.report', row: 'vs' } }] } })
    // Counted in grants, as the run's summary counts them.
    expect(preview.sentence[0]).toMatch(/^Adds (\d+) grants: 2 reports to \d+ business roles\. 0 grants already there\. Grants to people stay with the person\.$/)
    const run = await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never) as { grants_added: number }
    const after = await giveOldGrantsPreview(context(tables) as never)
    expect(after.rows.filter(r => r.filter === 'there').length).toBe(2)
    expect(after.sentence[0]).toBe('Adds nothing: every old grant it carries is already there. Grants to people stay with the person.')
    expect(run.grants_added).toBeGreaterThan(0)
  })

  // Codex round 2: once business roles decide, Run gives the reports at once; the preview says so.
  it('says nobody changes until the switch while the old rules decide, and that Run gives the reports at once while business roles decide', async () => {
    const tables = await seeded()
    tables['dash.report'] = REPORT_ROWS
    const old = await giveOldGrantsPreview(context(tables) as never)
    expect([old.rows.some(r => r.filter === 'add'), old.status]).toEqual([true, "Preview · nothing is saved until Run · nobody's access changes until the switch is set"])
    tables['dash.access_source'] = [{ row_id: 's1', source: 'business_roles' }]
    const live = await giveOldGrantsPreview(context(tables) as never)
    expect(live.status).toBe('Preview · nothing is saved until Run · business roles decide Dash access now, so Run gives these reports at once')
  })

  it('says a preview with nothing to carry, names a bundle, and is refused to someone who may not see the switch', async () => {
    const tables = await seeded()
    tables['dash.report_bundle'] = [{ row_id: 'b1', bundle_name: 'Store pack' }]
    tables['dash.report_access'] = [{ row_id: 'g1', report_bundle: 'b1', job: 'Store Manager' }]
    const preview = await giveOldGrantsPreview(context(tables) as never)
    expect(preview.sentence[0]).toBe('Adds nothing: no old grant is carried to a business role. Grants to people stay with the person.')
    expect(preview.rows[0]!.cells.report).toEqual({ parts: [{ record: { table: 'dash.report_bundle', row: 'b1', name: 'Store pack' } }] })
    tables['dash.report_access'] = [{ row_id: 'g2', report: 'gone', role: 'Dash Reader' }]
    expect((await giveOldGrantsPreview(context(tables) as never)).rows[0]!.cells.report).toEqual({ parts: ['A report no longer listed'] })
    await expect(giveOldGrantsPreview(context(tables, { roles: ['Dash Reader'] }) as never)).rejects.toThrow(/Only a Report Access Manager/)
  })

  it("says, for each person who changes, today and with business roles as counts, their job's site as a record, and whether the owner decided", async () => {
    const tables = await seeded()
    await decideAccess(context(tables, { payload: { person: 'st' } }) as never)
    const answer = await accessChanges(context(tables) as never)
    const rows = answer.groups.flatMap(g => g.people)
    expect(rows.find(r => r.person === 'st')).toMatchObject({ decided: true,
      today: { opens: expect.any(Boolean), reports: expect.any(Number), stores: expect.any(Number) }, next: { opens: expect.any(Boolean) },
      who: { held: [{ job: 'Staff', site: { id: 'LKS', name: 'Lakeside' } }] } })
    expect(rows.filter(r => r.person !== 'st').some(r => r.decided)).toBe(false)
  })

  it('says a role that opens no Dash, and describes no row when none is asked for', async () => {
    const tables = await seeded()
    const staff = roleId(tables, 'Staff')
    expect(((await describeBusinessRoles(context(tables, { payload: { rows: [staff] } }) as never)).rows[staff] as { facts: Record<string, { text: string }> }).facts.opens_dash.text).toBe('No')
    expect((await describeBusinessRoles(context(tables, { payload: {} }) as never)).rows).toEqual({})
  })

  it('names the one other role that shares a report grant', async () => {
    const tables = await seeded()
    const [sm, cm] = [roleId(tables, 'Store Manager'), roleId(tables, 'Cluster Manager')]
    tables['dash.report_access'].push({ row_id: 'g-sm', report: 'vs', business_role: sm, access_key: `report:vs/business_role:${sm}` },
      { row_id: 'g-cm', report: 'vs', business_role: cm, access_key: `report:vs/business_role:${cm}` })
    const groups = ((await describeBusinessRoles(context(tables, { payload: { rows: [sm], page: true } }) as never)).rows[sm] as { groups: { notes?: Record<string, string> }[] }).groups
    expect(groups[1]!.notes!.vs).toBe('Also given to 1 other role: Cluster Manager')
  })

  it('says a run in the singular where one was added, and keeps a caller with no name as nobody named', async () => {
    expect([startingRolesSummary({ roles: 1, titles: 1 }), oldGrantsSummary({ added: 1, alreadyThere: 0, notConverted: 0 })])
      .toEqual(['1 role and 1 title map added', '1 added · 0 already there · 0 not carried over'])
    const tables = await seeded()
    tables['dash.report'] = REPORT_ROWS
    const nameless = (over: Record<string, unknown> = {}) => ({ ...context(tables, over), userName: undefined })
    const before = (tables['dash.setup_run'] ?? []).length
    await actions.give_old_grants_to_roles(nameless({ roles: ['System Manager'] }) as never)
    await addStartingRoles(nameless() as never)
    await decideAccess(nameless({ payload: { person: 'st' } }) as never)
    expect([...tables['dash.setup_run'].slice(before).map(r => r.run_by_name), tables['dash.access_decision'][0]!.decided_by_name]).toEqual([null, null, null])
  })

  it('names someone whose name is not known plainly in the preview', async () => {
    const tables = await seeded()
    tables['dash.report'] = REPORT_ROWS
    tables['dash.report_access'] = [{ row_id: 'p1', report: 'vs', person: 'ghost' }]
    const preview = await giveOldGrantsPreview(context(tables) as never)
    expect(preview.rows[0]!.cells.old_grant).toEqual({ parts: ['Person: ', { record: { table: 'Person', row: 'ghost', name: 'Someone' } }] })
  })

  // Verifier round 1 (blocker 1): each grant to the role is a line with its real name, who else holds it and where it came from.
  it('says each report or bundle given to the role by its name, who else holds it, and whether it was copied from an old grant', async () => {
    const tables = await seeded()
    tables['dash.report'] = REPORT_ROWS
    tables['dash.report_bundle'] = [{ row_id: 'b1', bundle_name: 'Store pack' }]
    const sm = roleId(tables, 'Store Manager')
    tables['dash.report_access'].push({ row_id: 'g-b1', report_bundle: 'b1', business_role: sm, given_by_name: 'Made-up Manager', access_key: `report_bundle:b1/business_role:${sm}` })
    await actions.give_old_grants_to_roles(context(tables, { roles: ['System Manager'] }) as never)
    const copied = tables['dash.report_access'].find(r => r.report === 'sales' && r.business_role === sm)!
    const groups = ((await describeBusinessRoles(context(tables, { payload: { rows: [sm], page: true } }) as never)).rows[sm] as { groups: { rows?: Record<string, unknown> }[] }).groups
    expect(groups[1]!.rows![String(copied.row_id)]).toEqual({ parts: [{ record: { table: 'dash.report', row: 'sales', name: 'Sales' } }],
      note: [expect.stringMatching(/^Also given to 8 other roles: /)], chip: { label: 'from old grant', tone: 'neutral' } })
    expect(groups[1]!.rows!['g-b1']).toEqual({ parts: [{ record: { table: 'dash.report_bundle', row: 'b1', name: 'Store pack' } }],
      note: ['Given to this role only'], chip: { label: 'given by hand', tone: 'caution' } })
    // A grant of a report no longer listed says so, plainly.
    tables['dash.report_access'].push({ row_id: 'g-gone', report: 'gone', business_role: sm, access_key: `report:gone/business_role:${sm}` })
    const again = ((await describeBusinessRoles(context(tables, { payload: { rows: [sm], page: true } }) as never)).rows[sm] as { groups: { rows?: Record<string, { parts: unknown[] }> }[] }).groups
    expect(again[1]!.rows!['g-gone']!.parts).toEqual(['A report no longer listed'])
  })

  // Codex standard round 1 (P2): a role's page lists all its people, past the twenty the old page showed.
  it("lists every one of a role's people on its page, and counts them on the list", async () => {
    const tables = await seeded()
    for (let i = 1; i <= 26; i++) {
      tables.Employee.push({ row_id: `E-X${i}`, name: `Made-up Manager ${i}`, employee_code: `E-X${i}`, status: 'Current', person: `px${i}` })
      tables['Job Assignment'].push({ row_id: `J-X${i}`, employee: `E-X${i}`, job: 'Store Manager', site: 'LKS', starts_on: '2026-01-01' })
    }
    const sm = roleId(tables, 'Store Manager')
    const page = (await describeBusinessRoles(context(tables, { payload: { rows: [sm], page: true } }) as never)).rows[sm] as { groups: { key: string; count?: number; lines?: unknown[] }[] }
    const people = page.groups.find(g => g.key === 'people')!
    expect([people.count, people.lines!.length]).toEqual([27, 27])
    const list = (await describeBusinessRoles(context(tables, { payload: { rows: [sm] } }) as never)).rows[sm] as { facts: Record<string, { text: string }> }
    expect(list.facts.people.text).toBe('27')
  })

  it('says Every report for a role that views every report by its rule', async () => {
    const tables = await seeded()
    const owner = roleId(tables, 'Owner Director')
    expect(((await describeBusinessRoles(context(tables, { payload: { rows: [owner] } }) as never)).rows[owner] as { facts: Record<string, { text: string }> }).facts.reports.text).toBe('Every report')
  })

  it('takes a Let Them Lose Dash back on Undo, so the person needs a decision again; a second Undo changes nothing', async () => {
    const tables = await seeded()
    await decideAccess(context(tables, { payload: { person: 'st' } }) as never)
    expect(await decideAccess(context(tables, { payload: { person: 'st', undo: true } }) as never)).toEqual({ person: 'st', decision: null })
    expect([...await decidedToLose(context(tables).baseTables as never)]).toEqual([])
    expect(tables['dash.access_decision'][0]).toMatchObject({ person: 'st', removed: true })
    expect(await decideAccess(context(tables, { payload: { person: 'st', undo: true } }) as never)).toEqual({ person: 'st', decision: null })
    // Deciding again records it again.
    await decideAccess(context(tables, { payload: { person: 'st' } }) as never)
    expect([...await decidedToLose(context(tables).baseTables as never)]).toEqual(['st'])
  })

  it('records Let Them Lose Dash once, changing no access, and only for someone who may see the page', async () => {
    const tables = await seeded()
    const scope = JSON.stringify(await scopeOf(tables, 'st', ['Dash Reader']))
    expect(await decideAccess(context(tables, { payload: { person: 'st' } }) as never)).toEqual({ person: 'st', decision: 'Lose Dash' })
    expect(await decideAccess(context(tables, { payload: { person: 'st' } }) as never)).toEqual({ person: 'st', decision: 'Lose Dash' })
    expect(tables['dash.access_decision']).toMatchObject([{ person: 'st', decision: 'Lose Dash', decided_by_name: 'Manju Manager' }])
    expect([...await decidedToLose(context(tables).baseTables as never)]).toEqual(['st'])
    expect(JSON.stringify(await scopeOf(tables, 'st', ['Dash Reader']))).toBe(scope)
    await expect(decideAccess(context(tables, { payload: {} }) as never)).rejects.toThrow('Choose a person')
    await expect(decideAccess(context(tables, { roles: ['Dash Reader'], payload: { person: 'st' } }) as never)).rejects.toThrow(/Only a Report Access Manager/)
  })
})
