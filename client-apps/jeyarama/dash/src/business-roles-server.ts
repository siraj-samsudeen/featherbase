// #1218: the business roles pages on the server: the Business Roles page, Explain a person and Who Would Gain
// Or Lose Access. #1277: the new side of the comparison is businessAccess (business-access.ts), the very code
// that decides Dash access when business roles are live, so the comparison predicts exactly what happens.
// Read as the app, for Report Access Managers and System Managers only.
import { appsOf, decisionReports, differences, grantParts, permissionParts, permissionSentence, titleList, SOURCE_WORDS,
  type HeldRole, type Model, type Side, type Source, type Spot, type TitleInUse } from './business-roles.ts'
import { collapseCodes } from './reach-prefixes.ts'
import { reportsReaching, type AccessRow, type BundleMember, type Receiver } from './report-access.ts'
import { ACCESS, MEMBER, all, jobsOf, managesAccess, personNames, whoIs, type AccessContext } from './report-access-server.ts'
import { PROVIDER_FIELDS, reachOf, type Documents, type Place } from './provider.ts'
import { EMPLOYEE_STATUS, checked, exact, holdsOn, text } from './values.ts'
import { mayChangePermissions } from './permission-grid-server.ts'
import { istToday } from './report.ts'
import { STARTING_ROLES } from './starting-roles.ts'
import { opensDashFor, readableByRoles, offered } from './report-eligibility.ts'
import { DESIGNATION, PERMISSION, ROLE, ROLE_ASSIGNMENT, TITLE_MAP, businessAccess, businessModel, every as everyRow, isStore, readsDesignations, type Base, type HandRow, type Mine } from './business-access.ts'
import { openStore, siteKindRead, siteStoreFields } from './site-kind.ts'
import { businessReports, businessRolesOpen, opensDashByBusinessRoles } from './business-reports.ts'
import { carriedOver, ensureStartingRoles, logger } from './switch-over.ts'

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

/** The columns read of each Table, with HR's designation where the instance has it. */
const fieldsFor = (designations: boolean): Record<string, string[]> =>
  ({ ...FIELDS, [DESIGNATION]: ['designation'], 'Job Assignment': [...FIELDS['Job Assignment'], ...(designations ? ['designation'] : [])] })

/** Documents a comparison reads through: reads, whole Tables for the names it shows, and whether a Table can be read. */
export type WorldDocuments = Base & { rows(table: string): Promise<Row[]> }

/**
 * #1277: the core Tables read whole, once, and answered from memory, for Who Would Gain Or Lose Access: one bulk
 * read per Table for the whole company, never one per person. Each filtered read is answered from an index on its
 * first column, so a person's reads cost what they find, not the size of the Table. `withRetired`: as the scope
 * provider reads them (retired rows included), or as the app's own reads do (the old rules' report grants, by job).
 */
/** The columns each comparison reader reads, Table by Table: Site's kind and status too where the instance's Site has
 *  them (#1280), asked once as every reader asks it. One home, so the bulk comparison and Explain never differ. */
function siteAwareFields(base: Base, designations: boolean): (table: string) => Promise<string[]> {
  const fields = fieldsFor(designations)
  let siteFields: Promise<string[]> | undefined
  return async table => table === 'Site'
    ? await (siteFields ??= siteStoreFields(siteKindRead(base)).then(more => [...new Set([...fields.Site!, ...more])]))
    : fields[table]!
}

export function memoryDocuments(base: Base, designations: boolean, { withRetired = true }: { withRetired?: boolean } = {}): WorldDocuments {
  const loaded = new Map<string, Promise<Row[]>>()
  const indexes = new Map<string, Map<string, Row[]>>()
  const availability = new Map<string, Promise<boolean>>()
  const fieldsOf = siteAwareFields(base, designations)
  const rows = (table: string) => {
    if (!loaded.has(table)) loaded.set(table, fieldsOf(table).then(f => (withRetired ? everyRow(base, table, f) : all(base, table, f))))
    return loaded.get(table)!
  }
  const indexOf = async (table: string, column: string) => {
    const key = `${table}\u0000${column}`
    if (!indexes.has(key)) {
      const index = new Map<string, Row[]>()
      for (const row of await rows(table)) {
        const value = exact(row[column])
        const found = index.get(value)
        if (found) found.push(row)
        else index.set(value, [row])
      }
      indexes.set(key, index)
    }
    return indexes.get(key)!
  }
  const position = new Map<string, Map<Row, number>>()
  const orderOf = async (table: string) => {
    if (!position.has(table)) position.set(table, new Map((await rows(table)).map((row, i) => [row, i])))
    return position.get(table)!
  }
  const find = async (table: string, filters: Filter[]) => {
    if (!filters.length) return rows(table)
    const [[column, op, value], ...rest] = filters
    const index = await indexOf(table, column)
    let found: Row[]
    if (op === 'in') {
      // In the Table's own order (row_id), as one read of the Table would return them.
      const order = await orderOf(table)
      found = [...new Set((value as unknown[]).map(exact))].flatMap(v => index.get(v) ?? []).sort((a, b) => order.get(a)! - order.get(b)!)
    } else found = index.get(exact(value)) ?? []
    return rest.length ? found.filter(row => rest.every(filter => matches(row, filter))) : found
  }
  return {
    rows,
    // With columns (#1280), the instance is asked about them too; each question is asked once.
    available: (table, columns) => {
      const key = [table, ...(columns ?? [])].join('\u0000')
      if (!availability.has(key)) availability.set(key, base.available(table, columns))
      return availability.get(key)!
    },
    // Every read through here names its page length.
    list: async (table, args) => {
      const start = args.limit_start ?? 0
      return (await find(table, args.filters ?? [])).slice(start, start + args.limit_page_length!)
    },
  }
}

/**
 * One person's reads straight from the Tables, for Explain: what the scope provider reads, retired rows included,
 * each read returning the columns the in-memory one holds. Whole Tables are read only for the names a page shows.
 */
export function directDocuments(base: Base, designations: boolean): WorldDocuments {
  const loaded = new Map<string, Promise<Row[]>>()
  const fieldsOf = siteAwareFields(base, designations)
  return {
    rows: table => {
      if (!loaded.has(table)) loaded.set(table, fieldsOf(table).then(f => everyRow(base, table, f)))
      return loaded.get(table)!
    },
    available: (table, columns) => base.available(table, columns),
    list: async (table, args) => base.list(table, { ...args, fields: [...new Set([...args.fields, ...await fieldsOf(table)])], with_retired: true }),
  }
}

/** How much one Reaches covers, for the sentence an unresolved area reads as. Unset reads as such. */
const REACHES_ONE: Record<string, string> = { Section: 'one section', Floor: 'one floor', Department: 'one department', Store: 'one store', Cluster: 'one cluster', Region: 'one region',
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
  /** The app's own reads, as the old rules' report grants read jobs (retired rows left out). */
  base: Base
  docs: WorldDocuments
  /** What the old rules' report grants read a person's jobs from: the app's own reads, retired rows left out. */
  jobsBase: Documents
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

/**
 * Everything the comparison reads, once per request. `bulk`: the whole company is compared, so every Table is read
 * whole once and each person answered from memory (#1277); otherwise one person's own rows are read as they are asked for.
 */
export async function shadowWorld(base: Base, today: string = istToday(), { bulk = false }: { bulk?: boolean } = {}): Promise<ShadowWorld> {
  const designations = await readsDesignations(base)
  const docs = bulk ? memoryDocuments(base, designations) : directDocuments(base, designations)
  const { model, hand } = await businessModel(base, today)
  const designationNames = new Map((designations ? await everyRow(base, DESIGNATION, ['designation']) : []).map(row => [exact(row.row_id), text(row.designation)]))
  const every = (await docs.rows('Subcategory')).map(r => exact(r.row_id))
  const named = new Map<string, Promise<Map<string, string>>>()
  const names = (table: string, column = 'name') => {
    const key = `${table}\u0000${column}`
    if (!named.has(key)) named.set(key, docs.rows(table).then(rows => new Map(rows.map(r => [exact(r.row_id), text(r[column])]))))
    return named.get(key)!
  }
  return { base, docs, jobsBase: bulk ? memoryDocuments(base, designations, { withRetired: false }) : base, model, hand, designations, designationNames, every, grants: await grantRows(base), today, names }
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
  nextWhy: Map<string, { role?: string; person?: true; bundle: string | null; every?: true }[]>
  /** The roles they hold that would give them every report (viewsEveryReport). */
  everyReport: string[]
  /** Who they are to the old rules' report grants: their platform roles and their jobs. */
  receiver: Receiver
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
  // The old rules' report grants read jobs as reportsGivenTo does (Codex adversarial round 2).
  const jobNames = await jobsOf(world.jobsBase, person, today)
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
    everyReport: access.everyReport,
    receiver: { person, roles, jobs: jobNames },
  }
}

/** A site's region in words, as the site carries it, linking to the region's record. */
async function regionPart(world: ShadowWorld, site: string): Promise<Part> {
  const region = exact((await world.names('Site', 'operating_region')).get(site))
  return region ? { name: region, table: 'Operating Region', id: region } : { name: 'No region on this site' }
}

/** Where one held role applies, in words: the records its area names, and how many stores and subcategories it reaches. */
async function areaOf(world: ShadowWorld, held: HeldRole & { places: Place[] }, mine: Mine): Promise<Area> {
  // How far the role reaches is data on the role (Reaches); its name decides nothing.
  // Read as text: an unset Reaches is ''.
  const reaches = world.model.roles.find(r => r.id === held.role)!.reaches as string
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
  } else if (spot.kind === 'site' && reaches === 'Region') {
    parts = [await regionPart(world, spot.site)]
  } else if (spot.kind === 'site') {
    parts = [await part('Site', spot.site)]
  } else if (spot.kind === 'buyer_sections') {
    parts = mine.buyerSections.filter(b => spot.sections.includes(exact(b.row_id))).map(b => ({ name: text(b.name), table: 'Buyer Section', id: exact(b.row_id) }))
  } else if (spot.kind === 'job') {
    const job: Row = { ...mine.jobs.find(j => exact(j.row_id) === spot.job)!, ...(spot.site ? { site: spot.site } : {}) }
    const site = await part('Site', job.site)
    const cluster = (await world.names('Site', 'cluster')).get(exact(job.site))
    parts = reaches === 'Store' ? [site] : reaches === 'Cluster' ? [await part('Cluster', cluster)] : reaches === 'Region' ? [await regionPart(world, exact(job.site))]
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
  const plants = await world.docs.list('Plant', { fields: ['site'], filters: [['row_id', 'in', Object.keys(byStore)]], limit_page_length: 10_000 })
  // A job with no site or section names nothing there: its part is left out rather than shown blank.
  return { parts: parts.filter(p => p.name), stores: new Set(plants.map(p => exact(p.site))).size, subcategories: whole ? null : new Set(codes).size, prefixes: whole ? [] : collapseCodes(codes, world.every) }
}

// ---------- reads and actions ----------

const ONLY_MANAGERS = 'Only a Report Access Manager or a System Manager can see business roles'
/** The context, for a company-wide manager only. The platform always hands base Tables, documents, people and a payload. */
type Ctx = AccessContext & { baseTables: Base; payload: Record<string, unknown>
  people: { rolesOf(person: string): Promise<readonly string[]>; rolesOfMany?(persons: string[]): Promise<Readonly<Record<string, readonly string[]>>> } }
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
const REACHES_WORDS: Record<string, string> = { Section: 'their section', Floor: 'their floor', Department: 'their department', Store: 'their store', Cluster: 'their cluster', Region: 'their region',
  Merchandise: 'their merchandise', 'Whole company': 'the whole company', 'Given place': 'the place it is given at' }
const STARTING_ORDER = STARTING_ROLES.map(r => r.name)
const order = (name: string) => (STARTING_ORDER.includes(name) ? STARTING_ORDER.indexOf(name) : STARTING_ORDER.length)
/** How many holders of a title the Title Map names, each a link; the rest are counted. */
const HOLDERS_SHOWN = 20

/** The Business Roles page: each role's permissions (as sentences and as a grid), and the Title Map with what is not mapped first. */
/** How a role's people came to hold it, in the words of a role's header. */
const HOLDER_WORDS: Record<Source, string> = {
  hr_title: 'from HR title', merchandise: 'from merchandise assignment', buyer_section: 'as buyer on a Buyer Section', cluster_head: 'as named cluster head',
  corrected: 'by hand', also_given: 'by hand',
}
const joined = (words: string[]) => words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`

export async function businessRoles(context: AccessContext) {
  const ctx = managersOnly(context)
  const world = await shadowWorld(ctx.baseTables)
  const { roles, permissions } = world.model
  const nameOf = new Map(roles.map(r => [r.id, r.name]))
  const inUse = await titlesInUse(world)
  const holdersOf = new Map<string, Set<string>>()
  for (const t of inUse) for (const p of t.people) holdersOf.set(t.title.toLowerCase(), (holdersOf.get(t.title.toLowerCase()) ?? new Set()).add(p))
  // #1282 H4 (Codex standard round 1): each role's people as access decides them, by the same code Explain runs:
  // a person Corrected to another role counts there, and a hand change past its end date no longer counts.
  const bulk = await shadowWorld(ctx.baseTables, world.today, { bulk: true })
  const peopleOf = new Map<string, Set<string>>()
  const sourcesOf = new Map<string, Set<string>>()
  for (const person of await population(bulk)) {
    for (const held of (await businessAccess(bulk.docs, person, bulk.today, bulk)).held) {
      peopleOf.set(held.role, (peopleOf.get(held.role) ?? new Set()).add(person))
      sourcesOf.set(held.role, (sourcesOf.get(held.role) ?? new Set()).add(HOLDER_WORDS[held.source]))
    }
  }
  const sourceWords = (role: string) => joined(Object.values(HOLDER_WORDS).filter((w, i, all) => all.indexOf(w) === i && sourcesOf.get(role)?.has(w)))
  // #1282 H2: each report given to a role, said with every role it is given to.
  const reports = await reportNames(ctx)
  // As the caller may read them (Codex adversarial round 1): a bundle they may not read is not named to them.
  const bundles = new Map((await ctx.documents!.list('dash.report_bundle', { fields: ['row_id', 'bundle_name'], limit_page_length: 500 })).map(r => [exact(r.row_id), text(r.bundle_name)]))
  const named = new Map<string, { table: string; key: string; name: string }>([
    ...[...reports].map(([key, r]) => [`dash.report|${key}`, { table: 'dash.report', key, name: r.name }] as const),
    ...[...bundles].map(([key, name]) => [`dash.report_bundle|${key}`, { table: 'dash.report_bundle', key, name }] as const),
  ])
  const givenTo = new Map<string, string[]>()
  for (const row of world.grants.rows) {
    // A grant gives a report or a bundle; only one of those named here gets a line.
    const what = row.report ? `dash.report|${row.report}` : `dash.report_bundle|${row.report_bundle}`
    if (row.business_role) givenTo.set(what, [...new Set([...givenTo.get(what) ?? [], row.business_role])])
  }
  const shown = [...new Set([...holdersOf.values()].flatMap(set => [...set].slice(0, HOLDERS_SHOWN)).concat(roles.flatMap(r => [...peopleOf.get(r.id) ?? []].slice(0, HOLDERS_SHOWN))))]
  const names = await personNames(ctx, shown)
  return {
    // #1282 F1–F6: whether the grid steps for this caller, or is read-only.
    may_change: mayChangePermissions(ctx),
    // #1282: the reports grid's rows: every report and bundle the caller may read, and whether they may give them to roles.
    report_catalog: [...named.values()],
    may_give_reports: managesAccess(ctx),
    roles: roles.sort((a, b) => a.name.localeCompare(b.name)).sort((a, b) => order(a.name) - order(b.name)).map(role => ({
      id: role.id, name: role.name, description: role.description, by_hand_only: role.by_hand_only, reaches: REACHES_WORDS[role.reaches!] ?? 'Not set',
      permissions: permissions.filter(p => p.role === role.id).map(p => ({ app: p.app, level: p.level, verb: p.verb, thing: p.thing, reach: p.reach, sentence: permissionSentence(role.name, p), parts: permissionParts(role, p) })),
      reports: [...givenTo].filter(([what, given]) => given.includes(role.id) && named.has(what))
        .map(([what, given]) => grantParts(named.get(what)!, given.flatMap(id => roles.filter(r => r.id === id)))),
      // #1282: the reports grid's ticks: each report or bundle given to this role, as "dash.report|<key>".
      given: [...givenTo].filter(([what, given]) => given.includes(role.id) && named.has(what)).map(([what]) => what),
      people: peopleOf.get(role.id)?.size ?? 0,
      people_from: sourceWords(role.id) || 'nobody yet',
      holders: [...peopleOf.get(role.id) ?? []].slice(0, HOLDERS_SHOWN).map(person => ({ person, name: names.get(person) ?? 'Someone' })),
    })),
    titles: titleList(inUse, world.model).map(t => ({ ...t, role_name: nameOf.get(t.role!) ?? null,
      holders: [...holdersOf.get(t.title.toLowerCase()) ?? []].slice(0, HOLDERS_SHOWN).map(person => ({ person, name: names.get(person) ?? 'Someone' })) })),
  }
}

/** One person's comparison: the one computation both pages draw, so Explain and the list never disagree. */
async function comparePerson(world: ShadowWorld, roles: readonly string[], person: string, shapes: Map<string, string>) {
  const shadow = await personShadow(world, person, roles, shapes)
  return { shadow, found: differences(shadow.today, shadow.next, shadow.decisions) }
}

/** A comparison's changes as names, each naming its record. */
async function changeWords(world: ShadowWorld, reports: Map<string, { name: string }>, found: ReturnType<typeof differences>, everyReport: string[]) {
  const plants = await world.names('Plant', 'site')
  const siteNames = await world.names('Site')
  const siteParts = (stores: string[]) => [...new Set(stores.map(s => plants.get(s)!))].map(site => ({ name: text(siteNames.get(site)), table: 'Site', id: site }))
  const reportParts = (keys: string[]) => keys.filter(k => reports.has(k)).map(k => ({ name: reports.get(k)!.name, table: 'dash.report', id: k }))
  return { kinds: found.kinds, stores_gained: siteParts(found.storesGained), stores_lost: siteParts(found.storesLost), stores_changed: siteParts(found.storesChanged),
    gained: reportParts(found.gained), lost: reportParts(found.lost), decisions: reportParts(found.decisions),
    // Said in plain words: "every report, through Owner Director".
    every_report: everyReport.map(id => world.model.roles.find(r => r.id === id)!.name).sort() }
}

/** Explain a person: their roles with area and source, the apps they would open, the reports they would get, and what changes for them. */
export async function explainPerson(context: AccessContext) {
  const ctx = managersOnly(context)
  const person = exact(ctx.payload.person)
  if (!person) ctx.reject!('Choose a person')
  const world = await shadowWorld(ctx.baseTables)
  const reports = await reportNames(ctx)
  const { shadow, found } = await comparePerson(world, await ctx.people.rolesOf(person), person, new Map([...reports].map(([k, r]) => [k, r.shape])))
  const roleName = (id: string) => world.model.roles.find(r => r.id === id)!.name
  const bundleNames = new Map((await all(ctx.baseTables, 'dash.report_bundle', ['bundle_name'])).map(r => [exact(r.row_id), text(r.bundle_name)]))
  const updatedAt = new Map(world.hand.map(h => [h.id, h.updated_at]))
  const areaWords = (role: string) => shadow.held.filter(h => h.role === role).map(h => h.area.parts.map(p => p.name).join(' · ')).join('; ')
  const why = (w: { role?: string; person?: true; bundle: string | null; every?: true }) => w.every ? `Every report, through ${roleName(w.role!)}` :
    `${w.person ? 'Given to them directly' : `Given to ${roleName(w.role!)}, for ${areaWords(w.role!)}`}${w.bundle ? `, through ${text(bundleNames.get(w.bundle))}` : ''}`
  const plants = new Map((await world.docs.rows('Plant')).map(p => [exact(p.row_id), exact(p.site)]))
  const sites = await world.names('Site')
  const stores = (await world.docs.rows('Site')).filter(openStore).map(s => ({ id: exact(s.row_id), name: text(s.name) })).sort((a, b) => a.name.localeCompare(b.name))
  const employees = new Map((await world.docs.rows('Employee')).map(e => [exact(e.row_id), e]))
  const jobs = (await world.docs.list('Job Assignment', { fields: ['site', 'reports_to', 'job', 'starts_on', 'ends_on'], filters: [['employee', 'in', shadow.employees.map(e => exact(e.row_id))]], limit_page_length: 10_000 })).filter(j => holdsOn(j, world.today))
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
    roles: shadow.held.map(h => ({ role: h.role, name: roleName(h.role), source: SOURCE_WORDS[h.source], kind: h.source, from: h.title, area: h.area, until: h.until ?? null, reason: h.reason ?? null,
      hand: h.hand ?? null, hand_updated_at: h.hand ? updatedAt.get(h.hand)! : null })),
    unmapped: shadow.unmapped,
    apps: appsOf(shadow.held, world.model),
    // #1282: the roles each report comes through, and what each held role allows, for the Map's Why.
    reports: shadow.next.reports.map(key => ({ key, name: reports.get(key)!.name, why: shadow.nextWhy.get(key)!.map(why),
      roles: [...new Set(shadow.nextWhy.get(key)!.flatMap(w => w.role ? [w.role] : []))],
      // Given to the person themself (directly, or through a bundle given to them).
      direct: shadow.nextWhy.get(key)!.some(w => w.person === true) })),
    permissions: world.model.permissions.filter(p => shadow.held.some(h => h.role === p.role))
      .map(p => ({ role: p.role, app: p.app, level: p.level, verb: p.verb, thing: p.thing, reach: p.reach })),
    today: { opens: shadow.today.opens, reports: shadow.today.reports.length, stores: new Set(Object.keys(shadow.today.places).map(s => plants.get(s))).size },
    next: { opens: shadow.next.opens, reports: shadow.next.reports.length, stores: new Set(Object.keys(shadow.next.places).map(s => plants.get(s))).size },
    change: await changeWords(world, reports, found, shadow.everyReport),
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

/**
 * The roles the platform enforces for each person, in one read where the platform offers it (#1277): asking person by
 * person meant two database round trips for each of thousands of people.
 */
export async function platformRolesOf(people: Ctx['people'], persons: string[]): Promise<Map<string, readonly string[]>> {
  if (people.rolesOfMany) {
    const found = await people.rolesOfMany(persons)
    return new Map(persons.map(person => [person, found[person] ?? []]))
  }
  const found = new Map<string, readonly string[]>()
  for (const person of persons) found.set(person, await people.rolesOf(person))
  return found
}

/**
 * Who would gain or lose access: every person whose Dash would differ, in every group that applies. #1277: every Table
 * is read whole once and every person's roles in one read; each person is then compared in memory, by the same code
 * Explain runs for one person.
 */
export async function accessChanges(context: AccessContext) {
  const ctx = managersOnly(context)
  const world = await shadowWorld(ctx.baseTables, istToday(), { bulk: true })
  const reports = await reportNames(ctx)
  const shapes = new Map([...reports].map(([k, r]) => [k, r.shape]))
  const people = await population(world)
  const platformRoles = await platformRolesOf(ctx.people, people)
  const roleName = new Map(world.model.roles.map(r => [r.id, r.name]))
  const changed = []
  const losing: { receiver: Receiver; lost: string[] }[] = []
  for (const person of people) {
    const { shadow, found } = await comparePerson(world, platformRoles.get(person)!, person, shapes)
    if (!found.kind) continue
    // Every report they get today and would not under business roles, whether lost or awaiting a decision.
    losing.push({ receiver: shadow.receiver, lost: shadow.today.reports.filter(k => !shadow.next.reports.includes(k)) })
    changed.push({ person, kind: found.kind, roles: [...new Set(shadow.held.map(h => roleName.get(h.role)!))].sort(), ...await changeWords(world, reports, found, shadow.everyReport) })
  }
  const names = await personNames(ctx, changed.map(c => c.person))
  const who = await whoIs(ctx.baseTables, changed.map(c => c.person), world.today)
  const rows = changed.map(c => ({ ...c, name: names.get(c.person) ?? 'Someone', who: who.get(c.person)! })).sort((a, b) => a.name.localeCompare(b.name))
  return { people: people.length, changed: rows.length, groups: GROUPS.map(kind => ({ kind, people: rows.filter(r => r.kinds.includes(kind)) })),
    not_carried_over: await notCarriedOver(ctx, world, reports, losing, new Map(rows.map(r => [r.person, r.name]))) }
}

/**
 * #1277 (owner, 18-Nov-2026, decision 7: start narrow; add on request): each live grant that Give Old Grants To Business
 * Roles leaves where it is (one to a job, to Dash All-Stores Reader, to any role but Dash Reader), with each person who
 * would lose a report of it under business roles. `losing`: each changed person's old receiver and the reports they would lose.
 */
async function notCarriedOver(ctx: Ctx, world: ShadowWorld, reports: Map<string, { name: string }>, losing: { receiver: Receiver; lost: string[] }[], names: Map<string, string>) {
  const rows = (await all(ctx.baseTables, ACCESS, ['report', 'report_bundle', 'person', 'role', 'job', 'business_role', 'removed'])).filter(r => !checked(r.removed))
  const bundleNames = new Map((await all(ctx.baseTables, 'dash.report_bundle', ['bundle_name'])).map(r => [exact(r.row_id), text(r.bundle_name)]))
  const reportPart = (k: string) => ({ name: reports.get(k)?.name ?? 'No longer listed', table: 'dash.report', id: k })
  const out = []
  for (const row of rows) {
    const carried = carriedOver(row, world.model)
    if (!carried || carried.roles.length) continue
    const given = exact(row.report) ? [exact(row.report)] : world.grants.members.filter(m => m.report_bundle === exact(row.report_bundle)).map(m => m.report)
    const people = losing.filter(({ receiver }) => (carried.old.kind === 'job' ? receiver.jobs : receiver.roles).includes(carried.old.name))
      // Everyone losing a report is a changed person, so the page has already named them.
      .map(({ receiver, lost }) => ({ person: receiver.person, name: names.get(receiver.person)!, reports: given.filter(k => lost.includes(k)).sort().map(reportPart) }))
      .filter(p => p.reports.length).sort((a, b) => `${a.name}\u0000${a.person}`.localeCompare(`${b.name}\u0000${b.person}`))
    out.push({ grant: exact(row.row_id), gives: exact(row.report) ? reportPart(exact(row.report)) : { name: text(bundleNames.get(exact(row.report_bundle))) || 'No longer listed', table: 'dash.report_bundle', id: exact(row.report_bundle) },
      receiver: carried.old, note: 'Not carried over: add on request', people })
  }
  const order = (g: { gives: { name: string }; receiver: { name: string }; grant: string }) => `${g.gives.name}\u0000${g.receiver.name}\u0000${g.grant}`
  return out.sort((a, b) => order(a).localeCompare(order(b)))
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
  if (site && !(await isStore(ctx.baseTables, site))) ctx.reject!('Choose a store')
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

/** Where a role came from, as the Why map says it: HR's own facts, or someone's hand. */
const BY_HAND = new Set(['corrected', 'also_given'])

/** At most this many boxes in one column of the Why map; the rest is counted. With the person, four such columns stay
 *  within the platform's 40 boxes (Codex round 2). */
const WHY_COLUMN = 9
/** The platform's most edges in one Why map: past it the rest of the lines are left out rather than the map refused. */
const WHY_EDGES = 200
/** Area words that name no record, safe to show anyone who may see the role. */
const PLAIN_AREAS = new Set(['Whole company', 'No area yet'])

/**
 * A role box's area for the Map's Why, part by part: each part naming a record carries it (a link, shown only to
 * someone who may read every one), at most 10, and the plain words above. Text naming a record without saying which
 * (an unresolved area's message) is left out (Codex adversarial, round 3).
 */
export function areaParts(parts: Part[]): { detailParts?: { name: string; record?: { table: string; row: string } }[] } {
  const shown = parts.flatMap(p => p.table && p.id ? [{ name: clip(p.name, 80), record: { table: p.table, row: p.id } }]
    : PLAIN_AREAS.has(p.name) ? [{ name: p.name }] : []).slice(0, 10)
  return shown.length ? { detailParts: shown } : {}
}

/** A name or a detail on a Why box, within the platform's 120 characters. */
const clip = (words: string, most = 120) => words.length > most ? `${words.slice(0, most - 1)}…` : words

/**
 * #1282 Why mode: whether the platform's Map may explain this record for this viewer: a Person, for company-wide
 * managers only (as Explain a Person).
 */
/**
 * #1282 C10–C11 (UI owner, option A): a person's worked-out sections for the platform's record panel (the Lens), from
 * Explain a Person's own answer, so the two never disagree: the apps they can open and the reports they see, each with
 * the roles that give it and the one-line chain Why? opens. Only for someone who may have this person's access
 * explained, as Why is; anyone else is shown nothing (the platform draws no section). No pronoun: "They", "their".
 */
export async function workedOut(context: AccessContext) {
  if (!mayExplainAccess(context)) return null
  const person = String((context.payload as { row: string }).row)
  const explained = await explainPerson({ ...context, payload: { person } })
  // Every name within the platform's limits (Codex standard round 1): one long name must not refuse both sections.
  const self = { name: clip(explained.name), record: { table: 'Person', row: person } }
  const roleByName = new Map(explained.roles.map(r => [r.name, r]))
  const roleById = new Map(explained.roles.map(r => [r.role, r]))
  const roleLink = (r: { role: string; name: string }) => ({ name: clip(r.name), record: { table: ROLE, row: r.role } })
  // The role's area as record parts (as Why's boxes carry it), so the platform hides a chain naming an area the viewer may not read.
  const chainVia = (r: { role: string; name: string; area: { parts: Part[] } } | undefined) => (r ? [{ ...roleLink(r), ...areaParts(r.area.parts) }] : [])
  const apps: WorkedRow[] = explained.apps.slice(0, WORKED_OUT_ROWS).map(a => {
    const via = a.via.flatMap(name => roleByName.has(name) ? [roleByName.get(name)!] : [])
    return { name: clip(a.app), detail: clip(`at level ${a.level}`), via: via.slice(0, 6).map(roleLink),
      why: [self, ...chainVia(via[0]), { name: clip(`${a.app} · ${a.level}`) }] }
  })
  const reports: WorkedRow[] = explained.reports.slice(0, WORKED_OUT_ROWS).map(r => {
    const via = r.roles.flatMap(id => roleById.has(id) ? [roleById.get(id)!] : [])
    const report = { name: clip(r.name), record: { table: 'dash.report', row: r.key } }
    return { ...report, via: via.slice(0, 6).map(roleLink), why: [self, ...chainVia(via[0]), report] }
  })
  return { version: 1, sections: [
    { heading: 'Apps They Can Open', note: 'worked out from their roles', empty: 'No apps from roles yet', rows: apps },
    { heading: 'Reports They See', note: 'given to their roles', empty: 'No reports from roles yet', rows: reports },
  ] }
}
/** The most rows one worked-out section holds (the platform's limit). */
const WORKED_OUT_ROWS = 50
type Named = { name: string; record?: { table: string; row: string } }
/** One row of a worked-out section, as the platform's shape has it. */
type WorkedRow = Named & { detail?: string; via: Named[]; why: (Named & { detailParts?: Named[] })[] }

export function mayExplainAccess(context: AccessContext): boolean {
  // The platform always sends a payload; anything that is not { table, row } names no Person.
  const { table, row } = Object(context.payload) as { table?: unknown; row?: unknown }
  return table === 'Person' && typeof row === 'string' && row.length > 0 && managesAccess(context)
}

/**
 * #1282 Why mode: a person's access as the platform Map draws it, from Explain a Person's own reasoning: Person →
 * Business Role · Area (HR or by hand) → App · Level → What They Can Do (with reach), and the reports each role gives.
 */
export async function whyAccess(context: AccessContext) {
  if (!mayExplainAccess(context)) context.reject!(ONLY_MANAGERS)
  const person = String((context.payload as { row: string }).row)
  const e = await explainPerson({ ...context, payload: { person } } as AccessContext)
  // Verifier and UI owner: the chain runs Person → each role held → App · Level → what it allows and the reports it
  // gives, so App · Level is on every chain and no line skips a column. Each App · Level is one box, naming the roles
  // that give it ("both roles", or their names), reached from each of them; lighting what it allows lights every role
  // that reaches it (UI owner, 18-Nov-2026). A permission is one box; a report comes from its role's Dash box, or
  // from Given To Them Directly. Codex: one box per role held.
  const capped = <T>(items: T[], box: (item: T) => Record<string, unknown>, more: string) =>
    items.length <= WHY_COLUMN ? items.map(box)
      : [...items.slice(0, WHY_COLUMN - 1).map(box), { id: `${more}:more`, name: `+ ${items.length - WHY_COLUMN + 1} more` }]
  const direct = e.reports.filter(r => r.direct)
  const holders = [...e.roles.map((r, i) => ({ id: `role:${i}`, role: r.role as string | null, name: r.name })),
    ...(direct.length ? [{ id: 'direct', role: null, name: 'Given To Them Directly' }] : [])]
  const appId = (app: string, level: string) => `app:${app}:${level}`
  const levels = [...new Map(e.permissions.map(p => [appId(p.app, p.level), { app: p.app, level: p.level }])).values()]
  const reaching = (l: { app: string; level: string }) => holders.filter(h => h.role !== null && e.permissions.some(p => p.role === h.role && p.app === l.app && p.level === l.level))
  const roleCount = e.roles.length
  const givenBy = (hs: { name: string }[]) => hs.length === 2 && roleCount === 2 ? 'both roles' : clip([...new Set(hs.map(h => h.name))].join(' · '))
  const apps = [
    ...levels.map(l => ({ id: appId(l.app, l.level), name: clip(`${l.app} · ${l.level}`), app: l.app, level: l.level, from: reaching(l) })),
    ...(direct.length ? [{ id: 'direct:app:Dash', name: 'Dash · Reports Given To Them', app: 'Dash', level: '', from: holders.filter(h => h.role === null) }] : []),
  ]
  const permKey = (p: { app: string; level: string; verb: string; thing: string; reach: string }) => `can:${p.app}:${p.level}:${p.verb}:${p.thing}:${p.reach}`
  const allowed = [...new Map(e.permissions.map(p => [permKey(p), p])).values()]
  const roleBoxes = capped(holders, h => {
    const r = h.role === null ? undefined : e.roles[Number(h.id.split(':')[1])]
    return r ? { id: h.id, name: clip(r.name), record: { table: ROLE, row: r.role }, ...areaParts(r.area.parts), source: BY_HAND.has(r.kind) ? 'hand' : 'hr' }
      : { id: h.id, name: h.name }
  }, 'role')
  const appBoxes = capped(apps, a => ({ id: a.id, name: a.name, ...(a.from.length && a.level ? { detail: givenBy(a.from) } : {}) }), 'app')
  const can = capped([
    ...allowed.map(p => ({ id: permKey(p), name: clip(`${p.verb} ${p.thing}`), detail: clip(`${p.app} · ${p.level}`), reach: p.reach })),
    ...e.reports.map(r => ({ id: `report:${r.key}`, name: clip(r.name), detail: 'Report', record: { table: 'dash.report', row: r.key } })),
  ], box => box, 'can')
  const shown = new Set(['person', ...[...roleBoxes, ...appBoxes, ...can].map(b => String(b.id))])
  // A report comes through the Dash box its role reaches (else straight from the role).
  const dashOf = (h: { id: string }) => apps.find(a => a.app === 'Dash' && a.from.some(f => f.id === h.id))?.id
  const edges = ([
    ...holders.map(h => ['person', h.id]),
    ...apps.flatMap(a => a.from.map(h => [h.id, a.id])),
    ...allowed.map(p => [appId(p.app, p.level), permKey(p)]),
    ...e.reports.flatMap(r => [
      ...r.roles.flatMap(role => holders.filter(h => h.role === role).map(h => [dashOf(h) ?? h.id, `report:${r.key}`])),
      ...(r.direct ? [['direct:app:Dash', `report:${r.key}`]] : []),
    ]),
  ] as [string, string][]).filter(([from, to]) => shown.has(from) && shown.has(to))
  const unique = [...new Map(edges.map(edge => [edge.join('→'), edge])).values()].slice(0, WHY_EDGES)
  const columns = [
    { heading: 'Person', boxes: [{ id: 'person', name: clip(e.name), record: { table: 'Person', row: person } }] },
    { heading: 'Business Role · Area', boxes: roleBoxes },
    { heading: 'App · Level', boxes: appBoxes },
    { heading: 'What They Can Do', boxes: can },
  ].filter(c => c.boxes.length)
  return { version: 1, columns, edges: unique }
}
