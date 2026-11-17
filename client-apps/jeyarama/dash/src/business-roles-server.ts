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
}

const matches = (row: Row, [column, op, value]: Filter) =>
  op === 'in' ? (value as unknown[]).map(exact).includes(exact(row[column])) : op === '!=' ? exact(row[column]) !== exact(value) : exact(row[column]) === exact(value)
const page = (rows: Row[], args: { filters?: Filter[]; limit_start?: number; limit_page_length?: number }) => {
  const found = rows.filter(row => (args.filters ?? []).every(filter => matches(row, filter)))
  const start = args.limit_start ?? 0
  return found.slice(start, start + (args.limit_page_length ?? 500))
}

/**
 * The core Tables read whole, once, and answered from memory: reachOf for every person on the
 * comparison page would otherwise read the same Tables thousands of times.
 */
export function memoryDocuments(base: Documents, designations: boolean): Documents & { rows(table: string): Promise<Row[]> } {
  const loaded = new Map<string, Promise<Row[]>>()
  const rows = (table: string) => {
    let found = loaded.get(table)
    if (!found) {
      const fields = table === 'Job Assignment' && designations ? [...FIELDS[table], 'designation'] : FIELDS[table]
      found = all(base, table, fields)
      loaded.set(table, found)
    }
    return found
  }
  return { rows, available: base.available?.bind(base), list: async (table, args) => page(await rows(table), args) }
}

/** reachOf over only the rows that give one role: its job (as the role's job), merchandise rows, or cluster. */
function onlyThese(docs: Documents, rows: { jobs?: Row[]; merchandise?: Row[]; clusters?: Row[]; buyerSections?: boolean }): Documents {
  const given: Record<string, Row[]> = { 'Job Assignment': rows.jobs ?? [], 'Merchandise Assignment': rows.merchandise ?? [], Cluster: rows.clusters ?? [] }
  return {
    available: async table => (table === 'Buyer Section' || table === 'Buyer Section Subcategory') && !rows.buyerSections ? false : (docs.available ? docs.available(table) : false),
    list: async (table, args) => (table in given ? page(given[table], args) : docs.list(table, args)),
  }
}

/** The business roles whose area is the same as a job's of that name. */
const LOCATION_ROLES = new Set(['staff', 'team leader', 'floor manager', 'department manager', 'store manager', 'cluster manager'])
const BUYER = 'buyer'

export interface ShadowWorld {
  docs: ReturnType<typeof memoryDocuments>
  model: Model
  hand: (HandChange & { person: string; given_by_name: string; updated_at: string })[]
  designationNames: Map<string, string>
  every: string[]
  grants: { rows: AccessRow[]; members: BundleMember[] }
  today: string
}

const nullable = (v: unknown) => (exact(v) === '' ? null : exact(v))

/** Everything the shadow model reads, once per request. */
export async function shadowWorld(base: Documents, today: string = istToday()): Promise<ShadowWorld> {
  const designations = !!(await base.available?.('Job Assignment').catch(() => false))
  const docs = memoryDocuments(base, designations)
  const roles: BusinessRole[] = (await all(base, ROLE, ['role_name', 'description', 'by_hand_only']))
    .map(r => ({ id: exact(r.row_id), name: text(r.role_name), description: text(r.description) || null, by_hand_only: checked(r.by_hand_only) }))
  const permissions: Permission[] = (await all(base, PERMISSION, ['business_role', 'app', 'level', 'verb', 'thing', 'reach']))
    .map(p => ({ role: exact(p.business_role), app: text(p.app), level: text(p.level), verb: text(p.verb), thing: text(p.thing), reach: text(p.reach) as Reach }))
  const rules: TitleRule[] = (await all(base, TITLE_MAP, ['title', 'business_role'])).map(r => ({ title: text(r.title), role: nullable(r.business_role) }))
  const hand = (await all(base, ROLE_ASSIGNMENT, ['person', 'change', 'business_role', 'ends_on', 'reason', 'removed', 'given_by_name', 'updated_at']))
    .filter(r => !checked(r.removed))
    .map(r => ({ id: exact(r.row_id), person: exact(r.person), change: text(r.change) as HandChange['change'], role: exact(r.business_role), ends_on: day(r.ends_on) || null,
      reason: text(r.reason) || null, given_by_name: text(r.given_by_name), updated_at: exact(r.updated_at) }))
  const designationNames = new Map<string, string>()
  if (designations && await base.available?.(DESIGNATION).catch(() => false))
    for (const row of await all(base, DESIGNATION, ['designation'])) designationNames.set(exact(row.row_id), text(row.designation))
  const every = (await docs.rows('Subcategory')).map(r => exact(r.row_id))
  const grantRows = (await all(base, ACCESS, ['report', 'report_bundle', 'person', 'role', 'job', 'removed'])).filter(r => !checked(r.removed))
    .map(r => ({ report: nullable(r.report), report_bundle: nullable(r.report_bundle), person: nullable(r.person), role: nullable(r.role), job: nullable(r.job) }))
  const members = (await all(base, MEMBER, ['report_bundle', 'report', 'removed'])).filter(r => !checked(r.removed)).map(r => ({ report_bundle: exact(r.report_bundle), report: exact(r.report) }))
  return { docs, model: { rules, roles, permissions, today }, hand, designationNames, every, grants: { rows: grantRows, members }, today }
}

/** A name to show, with the record it names when there is one. */
export interface Part { name: string; table?: string; id?: string }
export interface Area { parts: Part[]; stores: number; subcategories: number | null; prefixes: string[] }
export interface PersonShadow {
  employees: Row[]
  jobs: Row[]
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
  for (const place of places)
    for (const store of place.filters.store ?? []) {
      const codes = place.filters.subcategory
      if (!codes || out[store] === null) { out[store] = null; continue }
      out[store] = [...new Set([...(out[store] ?? []), ...codes])].sort()
    }
  return out
}

/** One person, today and in the new model. `roles`: the roles the platform enforces for them today. */
export async function personShadow(world: ShadowWorld, person: string, roles: readonly string[], reportShapes: Map<string, string>): Promise<PersonShadow> {
  const { docs, model, today } = world
  const employees = (await docs.list('Employee', { fields: [], filters: [['person', '=', person]] })).filter(e => text(e[EMPLOYEE_STATUS]) === 'Current')
  const ids = employees.map(e => exact(e.row_id))
  const jobs = ids.length ? (await docs.list('Job Assignment', { fields: [], filters: [['employee', 'in', ids]], limit_page_length: 10_000 })).filter(j => holdsOn(j, today)) : []
  const merchandise = ids.length ? (await docs.list('Merchandise Assignment', { fields: [], filters: [['employee', 'in', ids]], limit_page_length: 10_000 })).filter(m => holdsOn(m, today)) : []
  const clusters = ids.length ? await docs.list('Cluster', { fields: [], filters: [['cluster_manager', 'in', ids]] }) : []
  const facts = {
    jobs: jobs.map(j => ({ id: exact(j.row_id), job: text(j.job), designation: world.designationNames.get(exact(j.designation)) ?? null })),
    merchandise: merchandise.map(m => ({ id: exact(m.row_id), responsibility: text(m.responsibility) })),
    clustersHeaded: clusters.map(c => exact(c.row_id)),
    hand: world.hand.filter(h => h.person === person),
  }
  const { held, unmapped } = rolesOf(facts, model)
  const name = (role: string) => model.roles.find(r => r.id === role)?.name.toLowerCase() ?? ''
  const withPlaces = []
  for (const role of held) {
    const places = await placesOf(world, person, role.role, name(role.role), role.spot, { jobs, merchandise, clusters })
    withPlaces.push({ ...role, places, area: await areaOf(world, role.spot, name(role.role), places, { jobs, merchandise }) })
  }
  const todayPlaces = (await reachOf(docs, person, today, roles)).places
  const dashRoles = withPlaces.filter(r => model.permissions.some(p => p.role === r.role && p.app === 'Dash'))
  const nextPlaces = dashRoles.flatMap(r => r.places)
  const jobNames = [...new Set(jobs.map(j => text(j.job)).filter(Boolean))]
  const { rows, members } = world.grants
  // As reportsFor: a report taking a filter needs a place to open in.
  const opensIn = (keys: string[], places: Place[]) => keys.filter(k => reportShapes.has(k) && (places.length > 0 || reportShapes.get(k) === 'No filter')).sort()
  const todayReports = opensIn([...reportsReaching({ person, roles, jobs: jobNames }, rows, members).keys()], todayPlaces)
  const nextWhy = newModelReports(person, [...new Set(held.map(h => h.role))], rows, members, model)
  const nextReports = opensIn([...nextWhy.keys()], nextPlaces)
  const todayOpens = managesAccess({ roles } as AccessContext) || roles.some(r => DASH_APP_ROLES.has(r)) || todayReports.length > 0
  return {
    employees, jobs, held: withPlaces, unmapped,
    today: { opens: todayOpens, places: placesByStore(todayPlaces), reports: todayReports },
    next: { opens: opensDash(held, model) || nextReports.length > 0, places: placesByStore(nextPlaces), reports: nextReports },
    decisions: decisionReports({ person, roles, jobs: jobNames }, rows, members),
    nextWhy,
  }
}
/** Today's roles that open Dash (server.ts DASH_ROLES), named here so this module reads nothing of today's gate. */
const DASH_APP_ROLES = new Set(['Dash All-Stores Reader', 'Dash Reader', 'Report Access Manager', 'Team Report Manager', 'View As Tester'])

async function placesOf(world: ShadowWorld, person: string, roleId: string, role: string, spot: Spot, mine: { jobs: Row[]; merchandise: Row[]; clusters: Row[] }): Promise<Place[]> {
  const reach = (rows: Parameters<typeof onlyThese>[1]) => reachOf(onlyThese(world.docs, rows), person, world.today, []).then(r => r.places)
  if (spot.kind === 'company') {
    // An every-store job reaches every store, whatever its site.
    const employee = mine.jobs[0]?.employee ?? (await world.docs.list('Employee', { fields: [], filters: [['person', '=', person]] }))[0]?.row_id
    return employee ? reach({ jobs: [{ row_id: `company-${roleId}`, employee, job: 'Director', site: '', starts_on: world.today }] }) : []
  }
  if (spot.kind === 'job') {
    const job = mine.jobs.find(j => exact(j.row_id) === spot.job)
    if (!job || !LOCATION_ROLES.has(role)) return []
    const asJob = role.replace(/\b\w/g, c => c.toUpperCase())
    return reach({ jobs: [{ ...job, job: asJob, acting: false }] })
  }
  if (spot.kind === 'merchandise') return reach({ merchandise: mine.merchandise.filter(m => spot.assignments.includes(exact(m.row_id))), buyerSections: role === BUYER })
  if (spot.kind === 'cluster') return reach({ clusters: mine.clusters.filter(c => exact(c.row_id) === spot.cluster) })
  return []
}

async function areaOf(world: ShadowWorld, spot: Spot, role: string, places: Place[], mine: { jobs: Row[]; merchandise: Row[] }): Promise<Area> {
  const byStore = placesByStore(places)
  const codes = Object.values(byStore).flatMap(c => c ?? [])
  const whole = Object.values(byStore).some(c => c === null)
  const counts = { stores: new Set(await storesOf(world, Object.keys(byStore))).size, subcategories: whole ? null : new Set(codes).size, prefixes: whole ? [] : areaPrefixes(codes, world.every) }
  const named = async (table: string, id: unknown, column = 'name'): Promise<Part | null> => {
    if (!exact(id)) return null
    const row = (await world.docs.list(table, { fields: [], filters: [['row_id', '=', exact(id)]] }))[0]
    return { name: text(row?.[column]) || 'Unnamed', table, id: exact(id) }
  }
  const parts = async (): Promise<Part[]> => {
    if (spot.kind === 'company') return [{ name: 'Whole company' }]
    if (spot.kind === 'cluster') return [await named('Cluster', spot.cluster) ?? { name: 'A cluster' }]
    if (spot.kind === 'merchandise') {
      return mine.merchandise.filter(m => spot.assignments.includes(exact(m.row_id))).flatMap(m => {
        const level = (['subcategory', 'category', 'subdivision', 'division'] as const).find(l => exact(m[l]))
        const table = level === 'subcategory' ? 'Subcategory' : level === 'category' ? 'Category' : level === 'subdivision' ? 'Subdivision' : 'Division'
        return [level ? { name: text(m[level]), table, id: exact(m[level]) } : { name: 'Every subcategory' },
          m.operating_region ? { name: text(m.operating_region), table: 'Operating Region', id: exact(m.operating_region) } : { name: 'Every region' }]
      })
    }
    if (spot.kind === 'job') {
      const job = mine.jobs.find(j => exact(j.row_id) === spot.job)
      if (!job || !LOCATION_ROLES.has(role)) return [{ name: role === BUYER || role === 'category head' ? 'No merchandise assigned yet' : 'No area yet' }]
      const site = await named('Site', job.site)
      if (role === 'cluster manager') {
        const cluster = (await world.docs.list('Site', { fields: [], filters: [['row_id', '=', exact(job.site)]] }))[0]?.cluster
        return [await named('Cluster', cluster) ?? { name: 'No cluster' }]
      }
      if (role === 'store manager') return [site!]
      if (role === 'floor manager') return [await named('Store Floor', job.floor).catch(() => null) ?? { name: 'Their floor' }, site!]
      if (role === 'department manager') return [{ name: 'Their department' }, site!]
      return [await named('Section', job.section) ?? { name: 'No section' }, site!]
    }
    return [{ name: 'No area yet' }]
  }
  return { parts: (await parts()).filter(Boolean), ...counts }
}

/** The sites of these plants. */
async function storesOf(world: ShadowWorld, plants: string[]): Promise<string[]> {
  if (!plants.length) return []
  return (await world.docs.list('Plant', { fields: [], filters: [['row_id', 'in', plants]], limit_page_length: 10_000 })).map(p => exact(p.site))
}

// ---------- reads and actions ----------

const ONLY_MANAGERS = 'Only a Report Access Manager or a System Manager can see business roles'
function managersOnly(ctx: AccessContext) {
  if (!managesAccess(ctx)) ctx.reject!(ONLY_MANAGERS)
}

async function reportNames(ctx: AccessContext): Promise<Map<string, { name: string; shape: string }>> {
  const rows = await ctx.documents!.list('dash.report', { fields: ['report_key', 'report_name', 'filter_shape'], order_by: 'report_name asc', limit_page_length: 500 })
  return new Map(rows.map(r => [exact(r.report_key), { name: text(r.report_name), shape: text(r.filter_shape) }]))
}

/** Every title in use today: designations, jobs and merchandise responsibilities, each with who holds it. */
async function titlesInUse(world: ShadowWorld): Promise<TitleInUse[]> {
  const people = new Map((await world.docs.rows('Employee')).filter(e => text(e[EMPLOYEE_STATUS]) === 'Current').map(e => [exact(e.row_id), exact(e.person) || exact(e.row_id)]))
  const out: TitleInUse[] = []
  for (const job of (await world.docs.rows('Job Assignment')).filter(j => holdsOn(j, world.today) && people.has(exact(j.employee)))) {
    const who = [people.get(exact(job.employee))!]
    const designation = world.designationNames.get(exact(job.designation))
    if (designation) out.push({ title: designation, people: who, job: text(job.job) })
    if (text(job.job)) out.push({ title: text(job.job), people: designation ? [] : who })
  }
  for (const m of (await world.docs.rows('Merchandise Assignment')).filter(m => holdsOn(m, world.today) && people.has(exact(m.employee))))
    if (text(m.responsibility)) out.push({ title: text(m.responsibility), people: [people.get(exact(m.employee))!] })
  return out
}

/** The Business Roles page: each role's permissions as sentences, and the Title Map with what is not mapped first. */
export async function businessRoles(ctx: AccessContext) {
  managersOnly(ctx)
  const world = await shadowWorld(ctx.baseTables!)
  const { roles, permissions } = world.model
  const titles = titleList(await titlesInUse(world), world.model)
  const mappedTitles = new Set(titles.map(t => t.title.toLowerCase()))
  // A mapping no one uses today still shows, so it can be found and changed.
  for (const rule of world.model.rules) if (!mappedTitles.has(rule.title.toLowerCase())) titles.push({ title: rule.title, role: rule.role, people: 0 })
  return {
    roles: roles.sort((a, b) => STARTING_ORDER(a.name) - STARTING_ORDER(b.name) || a.name.localeCompare(b.name)).map(role => ({
      id: role.id, name: role.name, description: role.description ?? null, by_hand_only: !!role.by_hand_only,
      permissions: permissions.filter(p => p.role === role.id).map(p => ({ app: p.app, level: p.level, reach: p.reach, sentence: permissionSentence(role.name, p) })),
    })),
    titles: titles.map(t => ({ ...t, role_name: t.role ? roles.find(r => r.id === t.role)?.name ?? null : null })),
  }
}
const STARTING_ORDER = (name: string) => { const at = STARTING_ROLES.findIndex(r => r.name === name); return at < 0 ? STARTING_ROLES.length : at }

/** Explain a person: their roles with area and source, the apps they would open, and the reports they would get. */
export async function explainPerson(ctx: AccessContext) {
  managersOnly(ctx)
  const person = exact((ctx.payload as { person?: unknown } | undefined)?.person)
  if (!person) ctx.reject!('Choose a person')
  const world = await shadowWorld(ctx.baseTables!)
  const reports = await reportNames(ctx)
  const roles = (await ctx.people!.rolesOf?.(person)) ?? []
  const shadow = await personShadow(world, person, roles, new Map([...reports].map(([k, r]) => [k, r.shape])))
  const roleName = (id: string) => world.model.roles.find(r => r.id === id)?.name ?? 'A role no longer listed'
  const bundleNames = new Map((await all(ctx.baseTables!, 'dash.report_bundle', ['bundle_name'])).map(r => [exact(r.row_id), text(r.bundle_name)]))
  const name = (await personNames(ctx, [person])).get(person) ?? 'This person'
  const who = (await whoIs(ctx.baseTables!, [person], world.today)).get(person)
  const areaWords = (role: string) => shadow.held.filter(h => h.role === role).map(h => h.area.parts.map(p => p.name).join(' · ')).join('; ')
  return {
    person, name, who, employee: exact(shadow.employees[0]?.employee_code ?? shadow.employees[0]?.row_id) || null,
    roles: shadow.held.map(h => ({ role: h.role, name: roleName(h.role), source: SOURCE_WORDS[h.source], from: h.title, area: h.area, until: h.until ?? null, reason: h.reason ?? null,
      hand: h.hand ?? null, hand_updated_at: h.hand ? world.hand.find(x => x.id === h.hand)?.updated_at ?? null : null })),
    unmapped: shadow.unmapped,
    apps: appsOf(shadow.held, world.model),
    reports: shadow.next.reports.map(key => ({ key, name: reports.get(key)?.name ?? 'A report no longer listed',
      why: (shadow.nextWhy.get(key) ?? []).map(w => `${w.person ? 'Given to them directly' : `Given to ${roleName(w.role!)}${areaWords(w.role!) ? `, for ${areaWords(w.role!)}` : ''}`}${w.bundle ? `, through ${bundleNames.get(w.bundle) ?? 'a bundle'}` : ''}`) })),
    today: { opens: shadow.today.opens, reports: shadow.today.reports.length, stores: (await storesOf(world, Object.keys(shadow.today.places))).filter((s, i, a) => a.indexOf(s) === i).length },
    next: { opens: shadow.next.opens },
    decisions: shadow.decisions.filter(k => reports.has(k)).map(key => ({ key, name: reports.get(key)!.name })),
    choices: world.model.roles.map(r => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

const GROUPS = ['loses_dash', 'gains_dash', 'stores', 'reports', 'decision'] as const

/** Who would gain or lose access: every current person whose Dash would differ, by kind of change. */
export async function accessChanges(ctx: AccessContext) {
  managersOnly(ctx)
  const world = await shadowWorld(ctx.baseTables!)
  const reports = await reportNames(ctx)
  const shapes = new Map([...reports].map(([k, r]) => [k, r.shape]))
  const people = [...new Set((await world.docs.rows('Employee')).filter(e => text(e[EMPLOYEE_STATUS]) === 'Current' && exact(e.person)).map(e => exact(e.person)))]
  const plants = new Map((await world.docs.rows('Plant')).map(p => [exact(p.row_id), exact(p.site)]))
  const siteNames = new Map((await world.docs.rows('Site')).map(s => [exact(s.row_id), text(s.name)]))
  const siteParts = (stores: string[]) => [...new Set(stores.map(s => plants.get(s) ?? s))].map(site => ({ name: siteNames.get(site) ?? 'A store', table: 'Site', id: site }))
  const reportParts = (keys: string[]) => keys.filter(k => reports.has(k)).map(k => ({ name: reports.get(k)!.name, table: 'dash.report', id: k }))
  const changed = []
  for (const person of people) {
    const shadow = await personShadow(world, person, (await ctx.people!.rolesOf?.(person)) ?? [], shapes)
    const found = differences(shadow.today, shadow.next, shadow.decisions)
    if (!found.kind) continue
    changed.push({ person, kind: found.kind, roles: [...new Set(shadow.held.map(h => world.model.roles.find(r => r.id === h.role)?.name ?? ''))].filter(Boolean).sort(),
      stores_gained: siteParts(found.storesGained), stores_lost: siteParts(found.storesLost), stores_changed: siteParts(found.storesChanged),
      gained: reportParts(found.gained), lost: reportParts(found.lost), decisions: reportParts(found.decisions) })
  }
  const names = await personNames(ctx, changed.map(c => c.person))
  const who = await whoIs(ctx.baseTables!, changed.map(c => c.person), world.today)
  const rows = changed.map(c => ({ ...c, name: names.get(c.person) ?? 'Someone', who: who.get(c.person) ?? null })).sort((a, b) => a.name.localeCompare(b.name))
  return { people: people.length, groups: GROUPS.map(kind => ({ kind, people: rows.filter(r => r.kind === kind) })) }
}

const CHANGES = ['Correct', 'Also give'] as const
/** Correct or Also give a business role to one person, with an optional end date and a reason. */
export async function giveRole(ctx: AccessContext) {
  managersOnly(ctx)
  const p = (ctx.payload ?? {}) as Record<string, unknown>
  const person = exact(p.person)
  const change = text(p.change) as (typeof CHANGES)[number]
  const role = exact(p.role)
  const ends = text(p.ends_on)
  if (!person) ctx.reject!('Choose a person')
  if (!CHANGES.includes(change)) ctx.reject!('Choose Correct or Also give')
  if (!(await all(ctx.baseTables!, ROLE, ['role_name'], [['row_id', '=', role]])).length) ctx.reject!('Choose a business role')
  if (ends && !/^\d{4}-\d{2}-\d{2}$/.test(ends)) ctx.reject!('The end date is a day, such as 31-Mar-2027')
  if (ends && ends < istToday()) ctx.reject!('The end date has passed')
  const saved = await ctx.documents!.create!(ROLE_ASSIGNMENT, { person, change, business_role: role, ends_on: ends || null, reason: text(p.reason) || null, given_by_name: text(ctx.userName) || null })
  return { id: exact(saved.row_id) }
}

/** Take a hand change away: the row is marked removed, so its history says who and when. */
export async function removeRole(ctx: AccessContext) {
  managersOnly(ctx)
  const { id, updated_at } = (ctx.payload ?? {}) as { id?: unknown; updated_at?: unknown }
  if (!exact(id) || !exact(updated_at)) ctx.reject!('Choose a hand change to remove')
  await ctx.documents!.update!(ROLE_ASSIGNMENT, { row_id: exact(id), removed: true, updated_at: exact(updated_at) })
  return { removed: exact(id) }
}

/** Map a title to a business role, or change its mapping. */
export async function mapTitle(ctx: AccessContext) {
  managersOnly(ctx)
  const { title, role } = (ctx.payload ?? {}) as { title?: unknown; role?: unknown }
  if (!text(title)) ctx.reject!('Name the title')
  if (!(await all(ctx.baseTables!, ROLE, ['role_name'], [['row_id', '=', exact(role)]])).length) ctx.reject!('Choose a business role')
  const existing = (await all(ctx.baseTables!, TITLE_MAP, ['title', 'updated_at'])).find(r => text(r.title).toLowerCase() === text(title).toLowerCase())
  if (existing) await ctx.documents!.update!(TITLE_MAP, { row_id: exact(existing.row_id), business_role: exact(role), updated_at: exact(existing.updated_at) })
  else await ctx.documents!.create!(TITLE_MAP, { title: text(title), business_role: exact(role) })
  return { title: text(title) }
}

/** Write Jeyarama's starting roles, their permissions and the Title Map for today's jobs: once, while there are no roles. */
export async function addStartingRoles(ctx: AccessContext) {
  managersOnly(ctx)
  if ((await all(ctx.baseTables!, ROLE, ['role_name'])).length) ctx.reject!('There are business roles already: edit them instead')
  const ids = new Map<string, string>()
  for (const role of STARTING_ROLES) {
    const saved = await ctx.documents!.create!(ROLE, { role_name: role.name, description: role.description, by_hand_only: !!role.by_hand_only })
    ids.set(role.name, exact(saved.row_id))
    for (const [app, level, verb, thing, reach] of role.grants)
      await ctx.documents!.create!(PERMISSION, { business_role: exact(saved.row_id), app, level, verb, thing, reach })
  }
  const mapped = new Set((await all(ctx.baseTables!, TITLE_MAP, ['title'])).map(r => text(r.title).toLowerCase()))
  for (const [title, role] of STARTING_TITLES)
    if (!mapped.has(title.toLowerCase())) await ctx.documents!.create!(TITLE_MAP, { title, business_role: ids.get(role)! })
  return { roles: STARTING_ROLES.length }
}
