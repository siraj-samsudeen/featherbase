// #1218: the business roles pages on the server: the Business Roles page, Explain a person and Who Would Gain
// Or Lose Access. #1277: the new side of the comparison is businessAccess (business-access.ts), the very code
// that decides Dash access when business roles are live, so the comparison predicts exactly what happens.
// Read as the app, for Report Access Managers and System Managers only.
import { appsOf, decisionReports, differences, permissionSentence, titleList, SOURCE_WORDS,
  type HeldRole, type Model, type Side, type Spot, type TitleInUse } from './business-roles.ts'
import { collapseCodes } from './reach-prefixes.ts'
import { reportsReaching, type AccessRow, type BundleMember } from './report-access.ts'
import { ACCESS, MEMBER, all, managesAccess, personNames, whoIs, type AccessContext } from './report-access-server.ts'
import { PROVIDER_FIELDS, reachOf, type Documents, type Place } from './provider.ts'
import { EMPLOYEE_STATUS, checked, exact, holdsOn, text } from './values.ts'
import { istToday } from './report.ts'
import { STARTING_ROLES } from './starting-roles.ts'
import { opensDashFor, readableByRoles, offered } from './report-eligibility.ts'
import { DESIGNATION, PERMISSION, ROLE, ROLE_ASSIGNMENT, TITLE_MAP, businessAccess, businessModel, every as everyRow, readsDesignations, type Base, type HandRow, type Mine } from './business-access.ts'
import { businessReports, businessRolesOpen, opensDashByBusinessRoles } from './business-reports.ts'
import { ensureStartingRoles, logger } from './switch-over.ts'

export { DESIGNATION, PERMISSION, ROLE, ROLE_ASSIGNMENT, TITLE_MAP, type Base }
type Row = Record<string, unknown>
type Filter = [string, string, unknown]
export const SHADOW_TABLES = [ROLE, PERMISSION, TITLE_MAP, ROLE_ASSIGNMENT]

/** The columns read of each core Table: the provider's, and the names these pages show. */
const FIELDS: Record<string, string[]> = {
  ...PROVIDER_FIELDS,
  Employee: [...PROVIDER_FIELDS.Employee, 'name', 'employee_code'],
  Cluster: [...PROVIDER_FIELDS.Cluster, 'name'],
  Department: [...PROVIDER_FIELDS.Department, 'name'],
  // Explain's header names who they report to.
  'Job Assignment': [...PROVIDER_FIELDS['Job Assignment'], 'reports_to'],
  'Store Floor': ['name', 'site'],
  Subcategory: [...PROVIDER_FIELDS.Subcategory, 'subcategory'],
}

// reachOf filters with = and in only.
const matches = (row: Row, [column, op, value]: Filter) =>
  op === 'in' ? (value as unknown[]).map(exact).includes(exact(row[column])) : exact(row[column]) === exact(value)
const page = (rows: Row[], args: { filters?: Filter[]; limit_start?: number; limit_page_length?: number }) => {
  const found = rows.filter(row => (args.filters ?? []).every(filter => matches(row, filter)))
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
    // As the scope provider reads them: retired rows included.
    if (!loaded.has(table)) loaded.set(table, everyRow(base, table, fields[table] ?? []))
    return loaded.get(table)!
  }
  return { rows, available: table => base.available(table), list: async (table, args) => page(await rows(table), args) }
}

/** How much one Reaches covers, for the sentence an unresolved area reads as. Unset reads as such. */
const REACHES_ONE: Record<string, string> = { Section: 'one section', Floor: 'one floor', Department: 'one department', Store: 'one store', Cluster: 'one cluster',
  Merchandise: 'merchandise', 'Given place': 'the place it is given at', '': 'nothing yet: its Reaches is not set' }
/** Where a person sits by a source that gives their role no area. */
const PLACED_ONLY: Record<string, (from: Spot, world: ShadowWorld, mine: Mine) => Promise<string>> = {
  cluster: async (from, world) => `as head of the ${text((await world.names('Cluster')).get((from as { cluster: string }).cluster))} cluster`,
  merchandise: async () => 'in a merchandise assignment',
  buyer_sections: async () => 'as a buyer on a Buyer Section',
  job: async (from, world, mine) => `in their job at ${text((await world.names('Site')).get(exact(mine.jobs.find(j => exact(j.row_id) === (from as { job: string }).job)!.site)))}`,
  site: async (from, world) => `at ${text((await world.names('Site')).get((from as { site: string }).site))}`,
}

const LEVELS = ['subcategory', 'category', 'subdivision', 'division'] as const
const LEVEL_TABLE: Record<string, string> = { subcategory: 'Subcategory', category: 'Category', subdivision: 'Subdivision', division: 'Division' }

export interface ShadowWorld {
  docs: ReturnType<typeof memoryDocuments>
  model: Model
  hand: HandRow[]
  designations: boolean
  designationNames: Map<string, string>
  every: string[]
  grants: { rows: AccessRow[]; members: BundleMember[] }
  today: string
  /** A record's name by Table and id, for the area words. */
  names(table: string, column?: string): Promise<Map<string, string>>
}

const nullable = (v: unknown) => (exact(v) === '' ? null : exact(v))

/** Every report grant and bundle member, as the app reads them: the receiver columns old and new. */
export async function grantRows(base: Documents): Promise<{ rows: AccessRow[]; members: BundleMember[] }> {
  const rows = (await all(base, ACCESS, ['report', 'report_bundle', 'person', 'role', 'job', 'business_role', 'removed'])).filter(r => !checked(r.removed))
    .map(r => ({ report: nullable(r.report), report_bundle: nullable(r.report_bundle), person: nullable(r.person), role: nullable(r.role), job: nullable(r.job), business_role: nullable(r.business_role) }))
  const members = (await all(base, MEMBER, ['report_bundle', 'report', 'removed'])).filter(r => !checked(r.removed)).map(r => ({ report_bundle: exact(r.report_bundle), report: exact(r.report) }))
  return { rows, members }
}

/** Everything the comparison reads, once per request. */
export async function shadowWorld(base: Base, today: string = istToday()): Promise<ShadowWorld> {
  const designations = await readsDesignations(base)
  const docs = memoryDocuments(base, designations)
  const { model, hand } = await businessModel(base, today)
  const designationNames = new Map((designations ? await everyRow(base, DESIGNATION, ['designation']) : []).map(row => [exact(row.row_id), text(row.designation)]))
  const every = (await docs.rows('Subcategory')).map(r => exact(r.row_id))
  const names = async (table: string, column = 'name') => new Map((await docs.rows(table)).map(r => [exact(r.row_id), text(r[column])]))
  return { docs, model, hand, designations, designationNames, every, grants: await grantRows(base), today, names }
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

/**
 * One person, by the old rules and by business roles. `roles`: the roles the platform enforces for them.
 * Each side is worked out by the code that decides it when that side is live: the old rules as
 * server.ts ran them before #1277, and businessAccess and businessReports for business roles.
 */
export async function personShadow(world: ShadowWorld, person: string, roles: readonly string[], reportShapes: Map<string, string>): Promise<PersonShadow> {
  const { docs, model, today } = world
  const access = await businessAccess(docs, person, today, world)
  const { employees, jobs } = access.mine
  const withPlaces = []
  for (const role of access.held) withPlaces.push({ ...role, area: await areaOf(world, role, access.mine) })
  const todayPlaces = (await reachOf(docs, person, today, roles)).places
  const jobNames = [...new Set(jobs.map(j => text(j.job)))]
  const { rows, members } = world.grants
  // The old rules (report-eligibility.ts): a filtered report needs a place, a whole-stores one a whole store.
  const opensIn = (keys: string[], places: Place[]) => keys.filter(k => reportShapes.has(k) && offered(reportShapes.get(k)!, places)).sort()
  // can_open counts every offered report; the reports themselves also need the read roles (Codex rounds 2 and 3 on #1218).
  const offeredToday = opensIn([...reportsReaching({ person, roles, jobs: jobNames }, rows, members).keys()], todayPlaces)
  const todayReports = offeredToday.filter(k => readableByRoles(reportShapes.get(k)!, roles))
  const next = businessReports(person, access, rows, members, reportShapes)
  return {
    employees, held: withPlaces, unmapped: access.unmapped,
    // #1277: the platform lets into Dash only someone holding one of its roles; behind that door, can_open decides.
    today: { opens: opensDashFor(roles, 0) && opensDashFor(roles, offeredToday.length), places: placesByStore(todayPlaces), reports: todayReports },
    // As live: a filtered report also needs the read roles the platform enforces on the report reads.
    next: { opens: opensDashByBusinessRoles(roles, access.opens, next.offered.length), places: placesByStore(access.places),
      reports: next.offered.filter(k => readableByRoles(reportShapes.get(k)!, roles)),
      needsDashRole: !opensDashFor(roles, 0) && businessRolesOpen(roles, access.opens, next.offered.length) },
    decisions: decisionReports({ person, roles, jobs: jobNames }, rows, members),
    nextWhy: next.why,
  }
}

/** Where one held role applies, in words: the records its area names, and how many stores and subcategories it reaches. */
async function areaOf(world: ShadowWorld, held: HeldRole & { places: Place[] }, mine: Mine): Promise<Area> {
  // How far the role reaches is data on the role (Reaches); its name decides nothing.
  const reaches = world.model.roles.find(r => r.id === held.role)!.reaches ?? ''
  const part = async (table: string, id: unknown): Promise<Part> => ({ name: text((await world.names(table)).get(exact(id))), table, id: exact(id) })
  const spot = held.spot
  let parts: Part[]
  if (spot.kind === 'company') {
    parts = [{ name: 'Whole company' }]
  } else if (spot.kind === 'cluster') {
    parts = [await part('Cluster', spot.cluster)]
  } else if (spot.kind === 'merchandise') {
    const assignments = mine.merchandise.filter(m => spot.assignments.includes(exact(m.row_id)))
    // A subcategory is named from its row; a category, subdivision or division is its own name.
    const subcategoryNames = await world.names('Subcategory', 'subcategory')
    parts = assignments.flatMap(m => {
      const level = LEVELS.find(l => exact(m[l])) ?? 'division'
      return [{ name: subcategoryNames.get(exact(m[level])) || text(m[level]) || 'Every subcategory', table: LEVEL_TABLE[level], id: exact(m[level]) },
        { name: text(m.operating_region) || 'Every region', table: 'Operating Region', id: exact(m.operating_region) }]
    })
  } else if (spot.kind === 'site') {
    parts = [await part('Site', spot.site)]
  } else if (spot.kind === 'buyer_sections') {
    parts = mine.buyerSections.filter(b => spot.sections.includes(exact(b.row_id))).map(b => ({ name: text(b.name), table: 'Buyer Section', id: exact(b.row_id) }))
  } else if (spot.kind === 'job') {
    const job: Row = { ...mine.jobs.find(j => exact(j.row_id) === spot.job)!, ...(spot.site ? { site: spot.site } : {}) }
    const site = await part('Site', job.site)
    const cluster = (await world.names('Site', 'cluster')).get(exact(job.site))
    parts = reaches === 'Store' ? [site] : reaches === 'Cluster' ? [await part('Cluster', cluster)]
      : reaches === 'Floor' ? [await part('Store Floor', job.floor), site] : reaches === 'Department' ? [{ name: 'Their department' }, site]
        : [await part('Section', job.section), site]
  } else if (spot.kind === 'unresolved') {
    // The role reaches a kind of place this source has none of: said plainly, reaching nothing.
    const role = world.model.roles.find(r => r.id === held.role)!.name
    parts = [{ name: `No area: ${role} reaches ${REACHES_ONE[reaches]}, and this person is named only ${await PLACED_ONLY[spot.from.kind](spot.from as never, world, mine)}` }]
  } else {
    parts = [{ name: 'No area yet' }]
  }
  const byStore = placesByStore(held.places)
  const codes = Object.values(byStore).flatMap(c => c ?? [])
  const whole = Object.values(byStore).includes(null)
  const plants = await world.docs.list('Plant', { fields: [], filters: [['row_id', 'in', Object.keys(byStore)]], limit_page_length: 10_000 })
  // A job with no site or section names nothing there: its part is left out rather than shown blank.
  return { parts: parts.filter(p => p.name), stores: new Set(plants.map(p => exact(p.site))).size, subcategories: whole ? null : new Set(codes).size, prefixes: whole ? [] : collapseCodes(codes, world.every) }
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
/** Reaches in plain words for the Business Roles page: "Reaches: their store". */
const REACHES_WORDS: Record<string, string> = { Section: 'their section', Floor: 'their floor', Department: 'their department', Store: 'their store', Cluster: 'their cluster',
  Merchandise: 'their merchandise', 'Whole company': 'the whole company', 'Given place': 'the place it is given at' }
const STARTING_ORDER = STARTING_ROLES.map(r => r.name)
const order = (name: string) => (STARTING_ORDER.includes(name) ? STARTING_ORDER.indexOf(name) : STARTING_ORDER.length)
/** How many holders of a title the Title Map names, each a link; the rest are counted. */
const HOLDERS_SHOWN = 20

/** The Business Roles page: each role's permissions (as sentences and as a grid), and the Title Map with what is not mapped first. */
export async function businessRoles(context: AccessContext) {
  const ctx = managersOnly(context)
  const world = await shadowWorld(ctx.baseTables)
  const { roles, permissions } = world.model
  const nameOf = new Map(roles.map(r => [r.id, r.name]))
  const inUse = await titlesInUse(world)
  const holdersOf = new Map<string, Set<string>>()
  for (const t of inUse) for (const p of t.people) holdersOf.set(t.title.toLowerCase(), (holdersOf.get(t.title.toLowerCase()) ?? new Set()).add(p))
  const shown = [...holdersOf.values()].flatMap(set => [...set].slice(0, HOLDERS_SHOWN))
  const names = await personNames(ctx, shown)
  return {
    roles: roles.sort((a, b) => a.name.localeCompare(b.name)).sort((a, b) => order(a.name) - order(b.name)).map(role => ({
      id: role.id, name: role.name, description: role.description, by_hand_only: role.by_hand_only, reaches: REACHES_WORDS[role.reaches!] ?? 'Not set',
      permissions: permissions.filter(p => p.role === role.id).map(p => ({ app: p.app, level: p.level, verb: p.verb, thing: p.thing, reach: p.reach, sentence: permissionSentence(role.name, p) })),
    })),
    titles: titleList(inUse, world.model).map(t => ({ ...t, role_name: nameOf.get(t.role!) ?? null,
      holders: [...holdersOf.get(t.title.toLowerCase()) ?? []].slice(0, HOLDERS_SHOWN).map(person => ({ person, name: names.get(person) ?? 'Someone' })) })),
  }
}

/** One person's comparison: the one computation both pages draw, so Explain and the list never disagree. */
async function comparePerson(world: ShadowWorld, ctx: Ctx, person: string, shapes: Map<string, string>) {
  const shadow = await personShadow(world, person, await ctx.people.rolesOf(person), shapes)
  return { shadow, found: differences(shadow.today, shadow.next, shadow.decisions) }
}

/** A comparison's changes as names, each naming its record. */
async function changeWords(world: ShadowWorld, reports: Map<string, { name: string }>, found: ReturnType<typeof differences>) {
  const plants = new Map((await world.docs.rows('Plant')).map(p => [exact(p.row_id), exact(p.site)]))
  const siteNames = await world.names('Site')
  const siteParts = (stores: string[]) => [...new Set(stores.map(s => plants.get(s)!))].map(site => ({ name: text(siteNames.get(site)), table: 'Site', id: site }))
  const reportParts = (keys: string[]) => keys.filter(k => reports.has(k)).map(k => ({ name: reports.get(k)!.name, table: 'dash.report', id: k }))
  return { kinds: found.kinds, stores_gained: siteParts(found.storesGained), stores_lost: siteParts(found.storesLost), stores_changed: siteParts(found.storesChanged),
    gained: reportParts(found.gained), lost: reportParts(found.lost), decisions: reportParts(found.decisions) }
}

/** Explain a person: their roles with area and source, the apps they would open, the reports they would get, and what changes for them. */
export async function explainPerson(context: AccessContext) {
  const ctx = managersOnly(context)
  const person = exact(ctx.payload.person)
  if (!person) ctx.reject!('Choose a person')
  const world = await shadowWorld(ctx.baseTables)
  const reports = await reportNames(ctx)
  const { shadow, found } = await comparePerson(world, ctx, person, new Map([...reports].map(([k, r]) => [k, r.shape])))
  const roleName = (id: string) => world.model.roles.find(r => r.id === id)!.name
  const bundleNames = new Map((await all(ctx.baseTables, 'dash.report_bundle', ['bundle_name'])).map(r => [exact(r.row_id), text(r.bundle_name)]))
  const updatedAt = new Map(world.hand.map(h => [h.id, h.updated_at]))
  const areaWords = (role: string) => shadow.held.filter(h => h.role === role).map(h => h.area.parts.map(p => p.name).join(' · ')).join('; ')
  const why = (w: { role?: string; person?: true; bundle: string | null }) =>
    `${w.person ? 'Given to them directly' : `Given to ${roleName(w.role!)}, for ${areaWords(w.role!)}`}${w.bundle ? `, through ${text(bundleNames.get(w.bundle))}` : ''}`
  const plants = new Map((await world.docs.rows('Plant')).map(p => [exact(p.row_id), exact(p.site)]))
  const sites = await world.names('Site')
  const stores = (await world.docs.rows('Site')).filter(s => checked(s.is_store)).map(s => ({ id: exact(s.row_id), name: text(s.name) })).sort((a, b) => a.name.localeCompare(b.name))
  const employees = new Map((await world.docs.rows('Employee')).map(e => [exact(e.row_id), e]))
  const jobs = (await world.docs.list('Job Assignment', { fields: [], filters: [['employee', 'in', shadow.employees.map(e => exact(e.row_id))]], limit_page_length: 10_000 })).filter(j => holdsOn(j, world.today))
  const employeePart = (id: string) => ({ name: text(employees.get(id)?.name), table: 'Employee', id, code: id })
  return {
    person, name: (await personNames(ctx, [person])).get(person) ?? 'This person', who: (await whoIs(ctx.baseTables, [person], world.today)).get(person)!,
    employee: shadow.employees.map(e => exact(e.employee_code))[0] ?? null,
    // The Lens header: their staff row, their sites and who they report to, each naming its record.
    header: {
      employee: shadow.employees.map(e => employeePart(exact(e.row_id))),
      sites: [...new Set(jobs.map(j => exact(j.site)))].map(id => ({ name: text(sites.get(id)), table: 'Site', id })).filter(p => p.name),
      reports_to: [...new Set(jobs.map(j => exact(j.reports_to)).filter(Boolean))].map(employeePart),
    },
    // HR's own title: the designation where HR gives one, else the job.
    hr_titles: [...new Set(jobs.map(j => world.designationNames.get(exact(j.designation)) ?? `${text(j.job)} (no designation)`))],
    roles: shadow.held.map(h => ({ role: h.role, name: roleName(h.role), source: SOURCE_WORDS[h.source], from: h.title, area: h.area, until: h.until ?? null, reason: h.reason ?? null,
      hand: h.hand ?? null, hand_updated_at: h.hand ? updatedAt.get(h.hand)! : null })),
    unmapped: shadow.unmapped,
    apps: appsOf(shadow.held, world.model),
    reports: shadow.next.reports.map(key => ({ key, name: reports.get(key)!.name, why: shadow.nextWhy.get(key)!.map(why) })),
    today: { opens: shadow.today.opens, reports: shadow.today.reports.length, stores: new Set(Object.keys(shadow.today.places).map(s => plants.get(s))).size },
    next: { opens: shadow.next.opens, reports: shadow.next.reports.length, stores: new Set(Object.keys(shadow.next.places).map(s => plants.get(s))).size },
    change: await changeWords(world, reports, found),
    choices: world.model.roles.map(r => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name)),
    // The Correct form's places: every store, their job's first.
    places: { stores, default: jobs.map(j => exact(j.site)).find(id => stores.some(s => s.id === id)) ?? null },
  }
}

const GROUPS = ['loses_dash', 'gains_dash', 'stores', 'reports', 'decision', 'needs_dash_role'] as const

/**
 * Everyone whose access the comparison covers: current staff, leavers still on the staff list, anyone given a role by
 * hand or a report directly. Someone outside the staff list whose only access is a platform role isn't found: Dash
 * can't list a role's holders.
 */
async function population(world: ShadowWorld): Promise<string[]> {
  const staff = (await world.docs.rows('Employee')).map(e => exact(e.person)).filter(Boolean)
  return [...new Set([...staff, ...world.hand.map(h => h.person), ...world.grants.rows.map(r => r.person ?? '').filter(Boolean)])].sort()
}

/** Who would gain or lose access: every person whose Dash would differ, in every group that applies. */
export async function accessChanges(context: AccessContext) {
  const ctx = managersOnly(context)
  const world = await shadowWorld(ctx.baseTables)
  const reports = await reportNames(ctx)
  const shapes = new Map([...reports].map(([k, r]) => [k, r.shape]))
  const people = await population(world)
  const roleName = new Map(world.model.roles.map(r => [r.id, r.name]))
  const changed = []
  for (const person of people) {
    const { shadow, found } = await comparePerson(world, ctx, person, shapes)
    if (!found.kind) continue
    changed.push({ person, kind: found.kind, roles: [...new Set(shadow.held.map(h => roleName.get(h.role)!))].sort(), ...await changeWords(world, reports, found) })
  }
  const names = await personNames(ctx, changed.map(c => c.person))
  const who = await whoIs(ctx.baseTables, changed.map(c => c.person), world.today)
  const rows = changed.map(c => ({ ...c, name: names.get(c.person) ?? 'Someone', who: who.get(c.person)! })).sort((a, b) => a.name.localeCompare(b.name))
  return { people: people.length, changed: rows.length, groups: GROUPS.map(kind => ({ kind, people: rows.filter(r => r.kinds.includes(kind)) })) }
}

const CHANGES = ['Correct', 'Also give']
/** Whether a business role of this id exists. */
const roleExists = async (ctx: Ctx, role: string) => (await all(ctx.baseTables, ROLE, ['role_name'], [['row_id', '=', role]])).length > 0

/** Correct or Also give a business role to one person, with an optional end date and a reason. */
export async function giveRole(context: AccessContext) {
  const ctx = managersOnly(context)
  const { person, change, role, site, ends_on: ends, reason } = Object.fromEntries(['person', 'change', 'role', 'site', 'ends_on', 'reason'].map(k => [k, text(ctx.payload[k])]))
  if (!person) ctx.reject!('Choose a person')
  if (!CHANGES.includes(change)) ctx.reject!('Choose Correct or Also give')
  if (!(await roleExists(ctx, role))) ctx.reject!('Choose a business role')
  if (site && !(await all(ctx.baseTables, 'Site', ['is_store'], [['row_id', '=', site]])).some(r => checked(r.is_store))) ctx.reject!('Choose a store')
  if (ends && !/^\d{4}-\d{2}-\d{2}$/.test(ends)) ctx.reject!('The end date is a day, such as 31-Mar-2027')
  if (ends && ends < istToday()) ctx.reject!('The end date has passed')
  const saved = await ctx.documents!.create!(ROLE_ASSIGNMENT, { person, change, business_role: role, site: site || null, ends_on: ends || null, reason: reason || null, given_by_name: text(ctx.userName) || null })
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
  const [chosen] = await all(ctx.baseTables, ROLE, ['role_name', 'by_hand_only'], [['row_id', '=', role]])
  if (checked(chosen.by_hand_only)) ctx.reject!(`${text(chosen.role_name)} is given by hand only`)
  const existing = (await all(ctx.baseTables, TITLE_MAP, ['title', 'updated_at'])).find(r => text(r.title).toLowerCase() === title.toLowerCase())
  if (existing) await ctx.documents!.update!(TITLE_MAP, { row_id: exact(existing.row_id), business_role: role, updated_at: exact(existing.updated_at) })
  else await ctx.documents!.create!(TITLE_MAP, { title, business_role: role })
  return { title }
}

/**
 * Write Jeyarama's starting roles that are missing, with their permissions and Title Map rows: only on this click
 * (#1277, owner 18-Nov-2026: he approves each role). A second click is harmless: a role or title already there, by
 * name, is left as it is. Each addition is logged.
 */
export async function addStartingRoles(context: AccessContext) {
  const ctx = managersOnly(context)
  return ensureStartingRoles(ctx.baseTables, ctx.documents as never, await logger(ctx.baseTables, ctx.documents as never))
}
