// #1218 (option A): the business roles in shadow, on the server. The rules are business-roles.ts;
// where a role applies is reachOf's (provider.ts), run over only the assignment that gives the role.
// Read as the app, for Report Access Managers and System Managers only. Nothing here is read by
// reportsFor, can_open, the scope provider or reachOf: today's access is decided as before.
import { appsOf, decisionReports, differences, newModelReports, opensDash, permissionSentence, rolesOf, titleList, SOURCE_WORDS, areaPrefixes,
  type BusinessRole, type HandChange, type HeldRole, type Model, type Permission, type Reach, type Side, type Spot, type TitleInUse, type TitleRule } from './business-roles.ts'
import { reportsReaching, type AccessRow, type BundleMember } from './report-access.ts'
import { ACCESS, MEMBER, all, managesAccess, personNames, whoIs, type AccessContext } from './report-access-server.ts'
import { PROVIDER_FIELDS, reachOf, type Documents, type Place } from './provider.ts'
import { EMPLOYEE_STATUS, checked, day, exact, holdsOn, text } from './values.ts'
import { istToday } from './report.ts'
import { STARTING_ROLES, STARTING_TITLES } from './starting-roles.ts'
import { offered, opensDashFor } from './report-eligibility.ts'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]
export const ROLE = 'dash.business_role'
export const PERMISSION = 'dash.business_role_permission'
export const TITLE_MAP = 'dash.title_map'
export const ROLE_ASSIGNMENT = 'dash.role_assignment'
export const SHADOW_TABLES = [ROLE, PERMISSION, TITLE_MAP, ROLE_ASSIGNMENT]
/** HR's titles (production's Designation Table), linked from Job Assignment.designation. Optional: without it, the job decides. */
export const DESIGNATION = 'Designation'

/** The columns read of each core Table: the provider's, and the names these pages show. */
const FIELDS: Record<string, string[]> = {
  ...PROVIDER_FIELDS,
  Employee: [...PROVIDER_FIELDS.Employee, 'name', 'employee_code'],
  Cluster: [...PROVIDER_FIELDS.Cluster, 'name'],
  Department: [...PROVIDER_FIELDS.Department, 'name'],
  'Store Floor': ['name', 'site'],
  Subcategory: [...PROVIDER_FIELDS.Subcategory, 'subcategory'],
}

/** The platform's base Table reads, which always say whether a Table can be read. */
export type Base = Documents & { available(table: string): Promise<boolean> }

// reachOf filters with = and in only.
const matches = (row: Row, [column, op, value]: Filter) =>
  op === 'in' ? (value as unknown[]).map(exact).includes(exact(row[column])) : exact(row[column]) === exact(value)
const page = (rows: Row[], args: { filters?: Filter[]; limit_start?: number; limit_page_length?: number }) => {
  const found = rows.filter(row => args.filters!.every(filter => matches(row, filter)))
  const start = args.limit_start ?? 0
  return found.slice(start, start + (args.limit_page_length ?? 500))
}

/**
 * The core Tables read whole, once, and answered from memory: reachOf for every person on the
 * comparison page would otherwise read the same Tables thousands of times.
 */
export function memoryDocuments(base: Base, designations: boolean): Base & { rows(table: string): Promise<Row[]> } {
  const loaded = new Map<string, Promise<Row[]>>()
  const fields: Record<string, string[]> = { ...FIELDS, 'Job Assignment': [...FIELDS['Job Assignment'], ...(designations ? ['designation'] : [])] }
  const rows = (table: string) => {
    if (!loaded.has(table)) loaded.set(table, all(base, table, fields[table]))
    return loaded.get(table)!
  }
  return { rows, available: table => base.available(table), list: async (table, args) => page(await rows(table), args) }
}

/** reachOf over only the rows that give one role: its job (as the role's job), merchandise rows, or cluster. */
function onlyThese(docs: Base, rows: { jobs: Row[]; merchandise: Row[]; clusters: Row[]; buyerSections: boolean }): Base {
  const given: Record<string, Row[]> = { 'Job Assignment': rows.jobs, 'Merchandise Assignment': rows.merchandise, Cluster: rows.clusters }
  return {
    // reachOf asks only about the Buyer Section Tables, which only a Buyer's own run reads.
    available: async table => rows.buyerSections && docs.available(table),
    list: async (table, args) => (table in given ? page(given[table], args) : docs.list(table, args)),
  }
}

/** The business roles whose area is the same as a job's of that name. */
const LOCATION_ROLES = new Set(['staff', 'team leader', 'floor manager', 'department manager', 'store manager', 'cluster manager'])
const BUYER = 'buyer'
const LEVELS = ['subcategory', 'category', 'subdivision', 'division'] as const
const LEVEL_TABLE: Record<string, string> = { subcategory: 'Subcategory', category: 'Category', subdivision: 'Subdivision', division: 'Division' }

export interface ShadowWorld {
  docs: ReturnType<typeof memoryDocuments>
  model: Model
  hand: (HandChange & { person: string; updated_at: string })[]
  designationNames: Map<string, string>
  every: string[]
  grants: { rows: AccessRow[]; members: BundleMember[] }
  today: string
  /** A record's name by Table and id, for the area words. */
  names(table: string, column?: string): Promise<Map<string, string>>
}

const nullable = (v: unknown) => (exact(v) === '' ? null : exact(v))

/** Everything the shadow model reads, once per request. */
export async function shadowWorld(base: Base, today: string = istToday()): Promise<ShadowWorld> {
  const designations = await base.available('Job Assignment') && await base.available(DESIGNATION)
  const docs = memoryDocuments(base, designations)
  const roles: BusinessRole[] = (await all(base, ROLE, ['role_name', 'description', 'by_hand_only']))
    .map(r => ({ id: exact(r.row_id), name: text(r.role_name), description: text(r.description), by_hand_only: checked(r.by_hand_only) }))
  const permissions: Permission[] = (await all(base, PERMISSION, ['business_role', 'app', 'level', 'verb', 'thing', 'reach']))
    .map(p => ({ role: exact(p.business_role), app: text(p.app), level: text(p.level), verb: text(p.verb), thing: text(p.thing), reach: text(p.reach) as Reach }))
  const rules: TitleRule[] = (await all(base, TITLE_MAP, ['title', 'business_role'])).map(r => ({ title: text(r.title), role: nullable(r.business_role) }))
  const hand = (await all(base, ROLE_ASSIGNMENT, ['person', 'change', 'business_role', 'ends_on', 'reason', 'removed', 'updated_at']))
    .filter(r => !checked(r.removed))
    .map(r => ({ id: exact(r.row_id), person: exact(r.person), change: text(r.change) as HandChange['change'], role: exact(r.business_role), ends_on: day(r.ends_on) || null,
      reason: text(r.reason) || null, updated_at: exact(r.updated_at) }))
  const designationNames = new Map((designations ? await all(base, DESIGNATION, ['designation']) : []).map(row => [exact(row.row_id), text(row.designation)]))
  const every = (await docs.rows('Subcategory')).map(r => exact(r.row_id))
  const grantRows = (await all(base, ACCESS, ['report', 'report_bundle', 'person', 'role', 'job', 'removed'])).filter(r => !checked(r.removed))
    .map(r => ({ report: nullable(r.report), report_bundle: nullable(r.report_bundle), person: nullable(r.person), role: nullable(r.role), job: nullable(r.job) }))
  const members = (await all(base, MEMBER, ['report_bundle', 'report', 'removed'])).filter(r => !checked(r.removed)).map(r => ({ report_bundle: exact(r.report_bundle), report: exact(r.report) }))
  const names = async (table: string, column = 'name') => new Map((await docs.rows(table)).map(r => [exact(r.row_id), text(r[column])]))
  return { docs, model: { rules, roles, permissions, today }, hand, designationNames, every, grants: { rows: grantRows, members }, today, names }
}

/** A name to show, with the record it names when there is one. */
export interface Part { name: string; table?: string; id?: string }
export interface Area { parts: Part[]; stores: number; subcategories: number | null; prefixes: string[] }
export interface PersonShadow {
  employees: Row[]
  held: (HeldRole & { places: Place[]; area: Area })[]
  unmapped: { title: string; job: string }[]
  today: Side
  next: Side
  decisions: string[]
  nextWhy: Map<string, { role?: string; person?: true; bundle: string | null }[]>
}

/** Places by store: null for a whole store, else its subcategory codes. */
export function placesByStore(places: Place[]): Record<string, string[] | null> {
  const out: Record<string, string[] | null> = {}
  for (const place of places) {
    const [store] = place.filters.store
    const codes = place.filters.subcategory
    out[store] = !codes || out[store] === null ? null : [...new Set([...(out[store] ?? []), ...codes])].sort()
  }
  return out
}


/** One person, today and in the new model. `roles`: the roles the platform enforces for them today. */
export async function personShadow(world: ShadowWorld, person: string, roles: readonly string[], reportShapes: Map<string, string>): Promise<PersonShadow> {
  const { docs, model, today } = world
  const employees = (await docs.list('Employee', { fields: [], filters: [['person', '=', person]] })).filter(e => text(e[EMPLOYEE_STATUS]) === 'Current')
  const mine: Filter[] = [['employee', 'in', employees.map(e => exact(e.row_id))]]
  const jobs = (await docs.list('Job Assignment', { fields: [], filters: mine, limit_page_length: 10_000 })).filter(j => holdsOn(j, today))
  const merchandise = (await docs.list('Merchandise Assignment', { fields: [], filters: mine, limit_page_length: 10_000 })).filter(m => holdsOn(m, today))
  const clusters = await docs.list('Cluster', { fields: [], filters: [['cluster_manager', 'in', employees.map(e => exact(e.row_id))]] })
  const facts = {
    jobs: jobs.map(j => ({ id: exact(j.row_id), job: text(j.job), designation: world.designationNames.get(exact(j.designation)) ?? null })),
    merchandise: merchandise.map(m => ({ id: exact(m.row_id), responsibility: text(m.responsibility) })),
    clustersHeaded: clusters.map(c => exact(c.row_id)),
    hand: world.hand.filter(h => h.person === person),
  }
  const { held, unmapped } = rolesOf(facts, model)
  const withPlaces = []
  for (const role of held) withPlaces.push({ ...role, ...await areaOf(world, person, role, { employees, jobs, merchandise, clusters }) })
  const todayPlaces = (await reachOf(docs, person, today, roles)).places
  const nextPlaces = withPlaces.filter(r => model.permissions.some(p => p.role === r.role && p.app === 'Dash')).flatMap(r => r.places)
  const jobNames = [...new Set(jobs.map(j => text(j.job)))]
  const { rows, members } = world.grants
  // Both sides by the live rules (report-eligibility.ts): a filtered report needs a place, a whole-stores one a whole store.
  const opensIn = (keys: string[], places: Place[]) => keys.filter(k => reportShapes.has(k) && offered(reportShapes.get(k)!, places)).sort()
  const todayReports = opensIn([...reportsReaching({ person, roles, jobs: jobNames }, rows, members).keys()], todayPlaces)
  const nextWhy = newModelReports(person, [...new Set(held.map(h => h.role))], rows, members, model)
  const nextReports = opensIn([...nextWhy.keys()], nextPlaces)
  return {
    employees, held: withPlaces, unmapped,
    today: { opens: opensDashFor(roles, todayReports.length), places: placesByStore(todayPlaces), reports: todayReports },
    next: { opens: opensDash(held, model) || nextReports.length > 0, places: placesByStore(nextPlaces), reports: nextReports },
    decisions: decisionReports({ person, roles, jobs: jobNames }, rows, members),
    nextWhy,
  }
}

type Mine = { employees: Row[]; jobs: Row[]; merchandise: Row[]; clusters: Row[] }

/** Where one held role applies: its places, by reachOf over only what gives it, and its area in words. */
async function areaOf(world: ShadowWorld, person: string, held: HeldRole, mine: Mine): Promise<{ places: Place[]; area: Area }> {
  const role = world.model.roles.find(r => r.id === held.role)!.name.toLowerCase()
  const reach = async (rows: Partial<Parameters<typeof onlyThese>[1]>) =>
    (await reachOf(onlyThese(world.docs, { jobs: [], merchandise: [], clusters: [], buyerSections: false, ...rows }), person, world.today, [])).places
  const part = async (table: string, id: unknown): Promise<Part> => ({ name: text((await world.names(table)).get(exact(id))), table, id: exact(id) })
  const spot = held.spot
  let places: Place[] = []
  let parts: Part[]
  if (spot.kind === 'company') {
    // An every-store job reaches every store, whatever its site.
    if (mine.employees.length) places = await reach({ jobs: [{ row_id: 'company', employee: mine.employees[0].row_id, job: 'Director', site: '', starts_on: world.today }] })
    parts = [{ name: 'Whole company' }]
  } else if (spot.kind === 'cluster') {
    places = await reach({ clusters: mine.clusters.filter(c => exact(c.row_id) === spot.cluster) })
    parts = [await part('Cluster', spot.cluster)]
  } else if (spot.kind === 'merchandise') {
    const assignments = mine.merchandise.filter(m => spot.assignments.includes(exact(m.row_id)))
    places = await reach({ merchandise: assignments, buyerSections: role === BUYER })
    // A subcategory is named from its row; a category, subdivision or division is its own name.
    const subcategoryNames = await world.names('Subcategory', 'subcategory')
    parts = assignments.flatMap(m => {
      const level = LEVELS.find(l => exact(m[l])) ?? 'division'
      return [{ name: subcategoryNames.get(exact(m[level])) || text(m[level]) || 'Every subcategory', table: LEVEL_TABLE[level], id: exact(m[level]) },
        { name: text(m.operating_region) || 'Every region', table: 'Operating Region', id: exact(m.operating_region) }]
    })
  } else if (spot.kind === 'job' && LOCATION_ROLES.has(role)) {
    const job = mine.jobs.find(j => exact(j.row_id) === spot.job)!
    places = await reach({ jobs: [{ ...job, job: role.replace(/\b\w/g, c => c.toUpperCase()), acting: false }] })
    const site = await part('Site', job.site)
    const cluster = (await world.names('Site', 'cluster')).get(exact(job.site))
    parts = role === 'store manager' ? [site] : role === 'cluster manager' ? [await part('Cluster', cluster)]
      : role === 'floor manager' ? [await part('Store Floor', job.floor), site] : role === 'department manager' ? [{ name: 'Their department' }, site]
        : [await part('Section', job.section), site]
  } else {
    parts = [{ name: role === BUYER || role === 'category head' ? 'No merchandise assigned yet' : 'No area yet' }]
  }
  const byStore = placesByStore(places)
  const codes = Object.values(byStore).flatMap(c => c ?? [])
  const whole = Object.values(byStore).includes(null)
  const plants = await world.docs.list('Plant', { fields: [], filters: [['row_id', 'in', Object.keys(byStore)]], limit_page_length: 10_000 })
  // A job with no site or section names nothing there: its part is left out rather than shown blank.
  return { places, area: { parts: parts.filter(p => p.name), stores: new Set(plants.map(p => exact(p.site))).size, subcategories: whole ? null : new Set(codes).size, prefixes: whole ? [] : areaPrefixes(codes, world.every) } }
}

// ---------- reads and actions ----------

const ONLY_MANAGERS = 'Only a Report Access Manager or a System Manager can see business roles'
/** The context, for a company-wide manager only. The platform always hands base Tables, documents, people and a payload. */
type Ctx = AccessContext & { baseTables: Base; payload: Record<string, unknown>; people: { rolesOf(person: string): Promise<readonly string[]> } }
function managersOnly(context: AccessContext): Ctx {
  if (!managesAccess(context)) context.reject!(ONLY_MANAGERS)
  return context as Ctx
}

async function reportNames(ctx: Ctx): Promise<Map<string, { name: string; shape: string }>> {
  const rows = await ctx.documents!.list('dash.report', { fields: ['report_key', 'report_name', 'filter_shape'], order_by: 'report_name asc', limit_page_length: 500 })
  return new Map(rows.map(r => [exact(r.report_key), { name: text(r.report_name), shape: text(r.filter_shape) }]))
}

/** Every title in use today: designations, jobs and merchandise responsibilities, each with who holds it. */
async function titlesInUse(world: ShadowWorld): Promise<TitleInUse[]> {
  const people = new Map((await world.docs.rows('Employee')).filter(e => text(e[EMPLOYEE_STATUS]) === 'Current').map(e => [exact(e.row_id), exact(e.person) || exact(e.row_id)]))
  const out: TitleInUse[] = []
  for (const job of (await world.docs.rows('Job Assignment')).filter(j => holdsOn(j, world.today) && people.has(exact(j.employee)))) {
    const designation = world.designationNames.get(exact(job.designation))
    const who = [people.get(exact(job.employee))!]
    out.push(designation ? { title: designation, people: who, job: text(job.job) } : { title: text(job.job), people: who })
  }
  for (const m of (await world.docs.rows('Merchandise Assignment')).filter(m => holdsOn(m, world.today) && people.has(exact(m.employee))))
    out.push({ title: text(m.responsibility), people: [people.get(exact(m.employee))!] })
  return out
}

/** Starting roles first, in their order; any other after them, by name. */
const STARTING_ORDER = STARTING_ROLES.map(r => r.name)
const order = (name: string) => (STARTING_ORDER.includes(name) ? STARTING_ORDER.indexOf(name) : STARTING_ORDER.length)

/** The Business Roles page: each role's permissions as sentences, and the Title Map with what is not mapped first. */
export async function businessRoles(context: AccessContext) {
  const ctx = managersOnly(context)
  const world = await shadowWorld(ctx.baseTables)
  const { roles, permissions } = world.model
  const nameOf = new Map(roles.map(r => [r.id, r.name]))
  return {
    roles: roles.sort((a, b) => a.name.localeCompare(b.name)).sort((a, b) => order(a.name) - order(b.name)).map(role => ({
      id: role.id, name: role.name, description: role.description, by_hand_only: role.by_hand_only,
      permissions: permissions.filter(p => p.role === role.id).map(p => ({ app: p.app, level: p.level, reach: p.reach, sentence: permissionSentence(role.name, p) })),
    })),
    titles: titleList(await titlesInUse(world), world.model).map(t => ({ ...t, role_name: nameOf.get(t.role!) ?? null })),
  }
}

/** Explain a person: their roles with area and source, the apps they would open, and the reports they would get. */
export async function explainPerson(context: AccessContext) {
  const ctx = managersOnly(context)
  const person = exact(ctx.payload.person)
  if (!person) ctx.reject!('Choose a person')
  const world = await shadowWorld(ctx.baseTables)
  const reports = await reportNames(ctx)
  const shadow = await personShadow(world, person, await ctx.people.rolesOf(person), new Map([...reports].map(([k, r]) => [k, r.shape])))
  const roleName = (id: string) => world.model.roles.find(r => r.id === id)!.name
  const bundleNames = new Map((await all(ctx.baseTables, 'dash.report_bundle', ['bundle_name'])).map(r => [exact(r.row_id), text(r.bundle_name)]))
  const updatedAt = new Map(world.hand.map(h => [h.id, h.updated_at]))
  const areaWords = (role: string) => shadow.held.filter(h => h.role === role).map(h => h.area.parts.map(p => p.name).join(' · ')).join('; ')
  const why = (w: { role?: string; person?: true; bundle: string | null }) =>
    `${w.person ? 'Given to them directly' : `Given to ${roleName(w.role!)}, for ${areaWords(w.role!)}`}${w.bundle ? `, through ${text(bundleNames.get(w.bundle))}` : ''}`
  const plants = new Map((await world.docs.rows('Plant')).map(p => [exact(p.row_id), exact(p.site)]))
  return {
    person, name: (await personNames(ctx, [person])).get(person) ?? 'This person', who: (await whoIs(ctx.baseTables, [person], world.today)).get(person)!,
    employee: shadow.employees.map(e => exact(e.employee_code))[0] ?? null,
    roles: shadow.held.map(h => ({ role: h.role, name: roleName(h.role), source: SOURCE_WORDS[h.source], from: h.title, area: h.area, until: h.until ?? null, reason: h.reason ?? null,
      hand: h.hand ?? null, hand_updated_at: h.hand ? updatedAt.get(h.hand)! : null })),
    unmapped: shadow.unmapped,
    apps: appsOf(shadow.held, world.model),
    reports: shadow.next.reports.map(key => ({ key, name: reports.get(key)!.name, why: shadow.nextWhy.get(key)!.map(why) })),
    today: { opens: shadow.today.opens, reports: shadow.today.reports.length, stores: new Set(Object.keys(shadow.today.places).map(s => plants.get(s))).size },
    next: { opens: shadow.next.opens },
    decisions: shadow.decisions.filter(k => reports.has(k)).map(key => ({ key, name: reports.get(key)!.name })),
    choices: world.model.roles.map(r => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

const GROUPS = ['loses_dash', 'gains_dash', 'stores', 'reports', 'decision'] as const

/** Who would gain or lose access: every current person whose Dash would differ, by kind of change. */
export async function accessChanges(context: AccessContext) {
  const ctx = managersOnly(context)
  const world = await shadowWorld(ctx.baseTables)
  const reports = await reportNames(ctx)
  const shapes = new Map([...reports].map(([k, r]) => [k, r.shape]))
  const people = [...new Set((await world.docs.rows('Employee')).filter(e => text(e[EMPLOYEE_STATUS]) === 'Current' && exact(e.person)).map(e => exact(e.person)))]
  const plants = new Map((await world.docs.rows('Plant')).map(p => [exact(p.row_id), exact(p.site)]))
  const siteNames = await world.names('Site')
  const siteParts = (stores: string[]) => [...new Set(stores.map(s => plants.get(s)!))].map(site => ({ name: text(siteNames.get(site)), table: 'Site', id: site }))
  const reportParts = (keys: string[]) => keys.filter(k => reports.has(k)).map(k => ({ name: reports.get(k)!.name, table: 'dash.report', id: k }))
  const roleName = new Map(world.model.roles.map(r => [r.id, r.name]))
  const changed = []
  for (const person of people) {
    const shadow = await personShadow(world, person, await ctx.people.rolesOf(person), shapes)
    const found = differences(shadow.today, shadow.next, shadow.decisions)
    if (!found.kind) continue
    changed.push({ person, kind: found.kind, roles: [...new Set(shadow.held.map(h => roleName.get(h.role)!))].sort(),
      stores_gained: siteParts(found.storesGained), stores_lost: siteParts(found.storesLost), stores_changed: siteParts(found.storesChanged),
      gained: reportParts(found.gained), lost: reportParts(found.lost), decisions: reportParts(found.decisions) })
  }
  const names = await personNames(ctx, changed.map(c => c.person))
  const who = await whoIs(ctx.baseTables, changed.map(c => c.person), world.today)
  const rows = changed.map(c => ({ ...c, name: names.get(c.person) ?? 'Someone', who: who.get(c.person)! })).sort((a, b) => a.name.localeCompare(b.name))
  return { people: people.length, groups: GROUPS.map(kind => ({ kind, people: rows.filter(r => r.kind === kind) })) }
}

const CHANGES = ['Correct', 'Also give']
/** Whether a business role of this id exists. */
const roleExists = async (ctx: Ctx, role: string) => (await all(ctx.baseTables, ROLE, ['role_name'], [['row_id', '=', role]])).length > 0

/** Correct or Also give a business role to one person, with an optional end date and a reason. */
export async function giveRole(context: AccessContext) {
  const ctx = managersOnly(context)
  const { person, change, role, ends_on: ends, reason } = Object.fromEntries(['person', 'change', 'role', 'ends_on', 'reason'].map(k => [k, text(ctx.payload[k])]))
  if (!person) ctx.reject!('Choose a person')
  if (!CHANGES.includes(change)) ctx.reject!('Choose Correct or Also give')
  if (!(await roleExists(ctx, role))) ctx.reject!('Choose a business role')
  if (ends && !/^\d{4}-\d{2}-\d{2}$/.test(ends)) ctx.reject!('The end date is a day, such as 31-Mar-2027')
  if (ends && ends < istToday()) ctx.reject!('The end date has passed')
  const saved = await ctx.documents!.create!(ROLE_ASSIGNMENT, { person, change, business_role: role, ends_on: ends || null, reason: reason || null, given_by_name: text(ctx.userName) || null })
  return { id: exact(saved.row_id) }
}

/** Take a hand change away: the row is marked removed, so its history says who and when. */
export async function removeRole(context: AccessContext) {
  const ctx = managersOnly(context)
  const [id, updatedAt] = [exact(ctx.payload.id), exact(ctx.payload.updated_at)]
  if (!id || !updatedAt) ctx.reject!('Choose a hand change to remove')
  await ctx.documents!.update!(ROLE_ASSIGNMENT, { row_id: id, removed: true, updated_at: updatedAt })
  return { removed: id }
}

/** Map a title to a business role, or change its mapping. */
export async function mapTitle(context: AccessContext) {
  const ctx = managersOnly(context)
  const [title, role] = [text(ctx.payload.title), exact(ctx.payload.role)]
  if (!title) ctx.reject!('Name the title')
  if (!(await roleExists(ctx, role))) ctx.reject!('Choose a business role')
  const existing = (await all(ctx.baseTables, TITLE_MAP, ['title', 'updated_at'])).find(r => text(r.title).toLowerCase() === title.toLowerCase())
  if (existing) await ctx.documents!.update!(TITLE_MAP, { row_id: exact(existing.row_id), business_role: role, updated_at: exact(existing.updated_at) })
  else await ctx.documents!.create!(TITLE_MAP, { title, business_role: role })
  return { title }
}

/** Write Jeyarama's starting roles, their permissions and the Title Map for today's jobs: once, while there are no roles. */
export async function addStartingRoles(context: AccessContext) {
  const ctx = managersOnly(context)
  if ((await all(ctx.baseTables, ROLE, ['role_name'])).length) ctx.reject!('There are business roles already: edit them instead')
  const ids = new Map<string, string>()
  for (const role of STARTING_ROLES) {
    const saved = await ctx.documents!.create!(ROLE, { role_name: role.name, description: role.description, by_hand_only: !!role.by_hand_only })
    ids.set(role.name, exact(saved.row_id))
    for (const [app, level, verb, thing, reach] of role.grants)
      await ctx.documents!.create!(PERMISSION, { business_role: exact(saved.row_id), app, level, verb, thing, reach })
  }
  const mapped = new Set((await all(ctx.baseTables, TITLE_MAP, ['title'])).map(r => text(r.title).toLowerCase()))
  for (const [title, role] of STARTING_TITLES.filter(([title]) => !mapped.has(title.toLowerCase())))
    await ctx.documents!.create!(TITLE_MAP, { title, business_role: ids.get(role)! })
  return { roles: STARTING_ROLES.length }
}
