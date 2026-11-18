// #1277 (J2): what business roles give one person in Dash, live. The scope provider, the server's reads
// and the Who Would Gain Or Lose Access comparison all call businessAccess, so the comparison predicts
// exactly what the live rules do. The role rules are business-roles.ts; where a role applies is reachOf's
// (provider.ts), run over only the assignment that gives the role.
import { BUYER_TITLE, DASH_APP, everyReportRoles, opensDash, rolesOf, type BusinessRole, type HandChange, type HeldRole, type Model, type Permission, type Reach, type Reaches, type TitleRule } from './business-roles.ts'
import { PROVIDER_FIELDS, reachOf, type Documents, type Place } from './provider.ts'
import { EMPLOYEE_STATUS, checked, day, exact, holdsOn, text } from './values.ts'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]
export const ROLE = 'dash.business_role'
export const PERMISSION = 'dash.business_role_permission'
export const TITLE_MAP = 'dash.title_map'
export const ROLE_ASSIGNMENT = 'dash.role_assignment'
/** HR's titles (production's Designation Table), linked from Job Assignment.designation. Optional: without it, the job decides. */
export const DESIGNATION = 'Designation'

/** Documents that also say whether a Table can be read now (the platform's base Tables and the scope provider's reads). */
export type Base = Documents & { available(table: string): Promise<boolean> }

const PAGE = 500
/**
 * Every row of a list, 500 a call in row_id order; reads one at a time, as the scope provider requires. Retired rows
 * too: the scope provider always sees them (retiring never changes reach), so every reader of access rules must, or
 * the provider and the reads would disagree (Codex standard round 1 on #1277).
 */
export async function every(documents: Documents, table: string, fields: string[], filters: Filter[] = []): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { fields: ['row_id', ...fields], filters, order_by: 'row_id asc', limit_start: rows.length, limit_page_length: PAGE, with_retired: true })
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

const nullable = (v: unknown) => (exact(v) === '' ? null : exact(v))

/** Whether Job Assignment carries HR's designation here: only where the Designation Table can be read. */
export const readsDesignations = async (docs: Base) => await docs.available('Job Assignment') && await docs.available(DESIGNATION)

export type HandRow = HandChange & { person: string; updated_at: string }
/** The roles, their permissions, the Title Map and the hand changes (of one person, when named). */
export async function businessModel(docs: Documents, today: string, person?: string): Promise<{ model: Model; hand: HandRow[] }> {
  const roles: BusinessRole[] = (await every(docs, ROLE, ['role_name', 'description', 'by_hand_only', 'reaches']))
    .map(r => ({ id: exact(r.row_id), name: text(r.role_name), description: text(r.description), by_hand_only: checked(r.by_hand_only), reaches: text(r.reaches) as Reaches }))
  const permissions: Permission[] = (await every(docs, PERMISSION, ['business_role', 'app', 'level', 'verb', 'thing', 'reach']))
    .map(p => ({ role: exact(p.business_role), app: text(p.app), level: text(p.level), verb: text(p.verb), thing: text(p.thing), reach: text(p.reach) as Reach }))
  const rules: TitleRule[] = (await every(docs, TITLE_MAP, ['title', 'business_role'])).map(r => ({ title: text(r.title), role: nullable(r.business_role) }))
  const hand = (await every(docs, ROLE_ASSIGNMENT, ['person', 'change', 'business_role', 'site', 'ends_on', 'reason', 'removed', 'updated_at'], person ? [['person', '=', person]] : []))
    .filter(r => !checked(r.removed))
    .map(r => ({ id: exact(r.row_id), person: exact(r.person), change: text(r.change) as HandChange['change'], role: exact(r.business_role), site: nullable(r.site),
      ends_on: day(r.ends_on) || null, reason: text(r.reason) || null, updated_at: exact(r.updated_at) }))
  return { model: { rules, roles, permissions, today }, hand }
}

/** The rows that give a person their roles: current staff rows, and what they hold on the day. */
export interface Mine { employees: Row[]; jobs: Row[]; merchandise: Row[]; clusters: Row[]; buyerSections: Row[] }

/** One person's own rows, read with the columns the provider reads (and HR's designation, where there is one). */
export async function mineOf(docs: Base, person: string, today: string, designations: boolean): Promise<Mine> {
  const employees = (await every(docs, 'Employee', PROVIDER_FIELDS.Employee, [['person', '=', person]])).filter(e => text(e[EMPLOYEE_STATUS]) === 'Current')
  const ids = employees.map(e => exact(e.row_id))
  if (!ids.length) return { employees, jobs: [], merchandise: [], clusters: [], buyerSections: [] }
  const mine: Filter[] = [['employee', 'in', ids]]
  const jobs = (await every(docs, 'Job Assignment', [...PROVIDER_FIELDS['Job Assignment'], ...(designations ? ['designation'] : [])], mine)).filter(j => holdsOn(j, today))
  const merchandise = (await every(docs, 'Merchandise Assignment', PROVIDER_FIELDS['Merchandise Assignment'], mine)).filter(m => holdsOn(m, today))
  const clusters = await every(docs, 'Cluster', PROVIDER_FIELDS.Cluster, [['cluster_manager', 'in', ids]])
  // #1246: the open Buyer Sections naming them their buyer, where the instance has them.
  const buyerSections = (await docs.available('Buyer Section') ? await every(docs, 'Buyer Section', PROVIDER_FIELDS['Buyer Section'], [['buyer', 'in', ids]]) : [])
    .filter(b => holdsOn(b, today))
  return { employees, jobs, merchandise, clusters, buyerSections }
}

/** reachOf over only the rows that give one role: its job (as the role's job), merchandise rows, or cluster. */
function onlyThese(docs: Base, rows: { jobs: Row[]; merchandise: Row[]; clusters: Row[]; buyerSections: boolean; employees?: Row[]; notMine?: string[] }): Base {
  const given: Record<string, Row[]> = { 'Job Assignment': rows.jobs, 'Merchandise Assignment': rows.merchandise, Cluster: rows.clusters, ...(rows.employees ? { Employee: rows.employees } : {}) }
  const page = (found: Row[], args: { filters?: Filter[]; limit_start?: number; limit_page_length?: number }) => {
    const kept = found.filter(row => args.filters!.every(([column, op, value]) =>
      op === 'in' ? (value as unknown[]).map(exact).includes(exact(row[column])) : exact(row[column]) === exact(value)))
    // reachOf reads in pages, always naming them.
    return kept.slice(args.limit_start!, args.limit_start! + args.limit_page_length!)
  }
  return {
    // reachOf asks only about the Buyer Section Tables, which only a Buyer's own run reads.
    available: async table => rows.buyerSections && docs.available(table),
    list: async (table, args) => {
      if (table in given) return page(given[table], args)
      // Retired rows too, as the scope provider always reads them, so the app's reads and the provider agree (Codex round 12).
      const read = await docs.list(table, { ...args, with_retired: true })
      // Buyer Sections still take subcategories from Buyer rows; only a Buyer role gives the person their own (Codex adversarial round 4).
      return table === 'Buyer Section' && rows.notMine?.length ? read.map(row => (rows.notMine!.includes(exact(row.buyer)) ? { ...row, buyer: null } : row)) : read
    },
  }
}

/** A role reaching a place on the location axis covers what a job of this kind there does: reachOf's rules. */
const AS_JOB: Partial<Record<Reaches, string>> = { Section: 'Team Leader', Floor: 'Floor Manager', Department: 'Department Manager', Store: 'Store Manager', Cluster: 'Cluster Manager' }

/** The places one held role reaches, by reachOf over only what gives it. A role whose area is unresolved or none reaches nothing. */
export async function rolePlaces(docs: Base, person: string, today: string, held: HeldRole, reaches: Reaches | null | undefined, mine: Mine): Promise<Place[]> {
  const reach = async (rows: Partial<Parameters<typeof onlyThese>[1]>) =>
    (await reachOf(onlyThese(docs, { jobs: [], merchandise: [], clusters: [], buyerSections: false, ...rows }), person, today, [])).places
  const spot = held.spot
  // #1277 (owner, 18-Nov-2026): a role reaching a Region covers every store whose site is in the region of the site its
  // job (or the store it is given at) sits at, as a Store Manager of each; regions are the sites' own data.
  // A hand change naming a store places the role there, not at the job's own store (Codex round 5).
  const site = spot.kind === 'job' ? (spot.site || exact(mine.jobs.find(j => exact(j.row_id) === spot.job)?.site)) : spot.kind === 'site' ? spot.site : ''
  if (reaches === 'Region' && site) {
    const [here] = await every(docs, 'Site', ['operating_region'], [['row_id', '=', site]])
    const region = exact(here?.operating_region)
    if (!region) return []
    const stores = []
    for (const s of await every(docs, 'Site', SITE_STORE_FIELDS, [['operating_region', '=', region]])) if (openStore(s)) stores.push(s)
    return reach({ employees: [{ row_id: 'by-region', person, status: 'Current' }],
      jobs: stores.map(s => ({ row_id: `region-${exact(s.row_id)}`, employee: 'by-region', job: 'Store Manager', site: exact(s.row_id), starts_on: today })) })
  }
  switch (spot.kind) {
    // An every-store job reaches every store, whatever its site, for anyone holding it, on the staff list or not.
    case 'company': return reach({ employees: [{ row_id: 'by-role', person, status: 'Current' }], jobs: [{ row_id: 'company', employee: 'by-role', job: 'Director', site: '', starts_on: today }] })
    case 'cluster': return reach({ clusters: mine.clusters.filter(c => exact(c.row_id) === spot.cluster) })
    case 'merchandise': return reach({ merchandise: mine.merchandise.filter(m => spot.assignments.includes(exact(m.row_id))), buyerSections: reaches === 'Merchandise',
      // A merchandise role other than the Buyer's own gets no Buyer Section that names this person its buyer.
      ...(text(held.title).toLowerCase() === BUYER_TITLE.toLowerCase() ? {} : { notMine: mine.employees.map(e => exact(e.row_id)) }) })
    // A store given by hand to someone with no job there: the whole store, as a Store Manager's, even for someone off the staff list.
    case 'site': if (!(await isStore(docs, spot.site))) return []
      return reach({ employees: [{ row_id: 'by-hand', person, status: 'Current' }], jobs: [{ row_id: 'by-hand', employee: 'by-hand', job: 'Store Manager', site: spot.site, starts_on: today }] })
    case 'buyer_sections': return reach({ buyerSections: true })
    case 'job': {
      // A hand change naming a place puts the job there ("treat as Store Manager at Lakeside"). fit() lets only a location reach here.
      const job: Row = { ...mine.jobs.find(j => exact(j.row_id) === spot.job)!, ...(spot.site ? { site: spot.site } : {}) }
      // #1277 (owner, 18-Nov-2026): a head office or group site is no store: a role placed there reaches no store of it.
      if (reaches !== 'Cluster' && !(await isStore(docs, exact(job.site)))) return []
      return reach({ jobs: [{ ...job, job: AS_JOB[reaches!]!, acting: false }] })
    }
    default: return []
  }
}

/**
 * Whether a Site row is an open store (owner, 18-Nov-2026): with a status of Planned or Closed, never; with a site_kind,
 * only Store (any other kind, now or added later, is not); with neither, its is_store flag. Empty means not set.
 */
export function openStore(row: Row): boolean {
  if (['planned', 'closed'].includes(text(row.status).toLowerCase())) return false
  const kind = text(row.site_kind)
  return kind ? kind === 'Store' : checked(row.is_store)
}

/** The Site columns read for openStore. #1280's site_kind (and the Site's status) join this list, and every reader with
 *  it, once every instance has them: a read naming a column an instance lacks fails, and one path reading more than
 *  another would make the comparison and the live rules disagree (Codex round 9). Until then is_store decides. */
export const SITE_STORE_FIELDS = ['is_store']

/** Whether a site is an open store, read alike by the scope provider, the app's reads and the comparison. */
export async function isStore(docs: Base, site: string): Promise<boolean> {
  if (!site) return false
  const [row] = await every(docs, 'Site', SITE_STORE_FIELDS, [['row_id', '=', site]])
  return !!row && openStore(row)
}

/** What business roles give one person: each held role with its places, the Dash places, and whether a role opens Dash. */
export interface BusinessAccess {
  held: (HeldRole & { places: Place[] })[]
  unmapped: { title: string; job: string }[]
  /** The places of the roles that hold a Dash permission: the person's Dash scope. */
  places: Place[]
  /** A held role holds a Dash permission (D3). */
  opens: boolean
  /** Every business role they hold, for report grants to roles (D4). */
  roles: string[]
  /** The roles they hold that view every report (viewsEveryReport): every report, at every store. */
  everyReport: string[]
  mine: Mine
}

/** One person under business roles. `designationNames` maps a designation id to HR's title (all of them, or only theirs). */
export async function businessAccess(docs: Base, person: string, today: string,
  world: { model: Model; hand: HandRow[]; designationNames?: Map<string, string>; designations: boolean }): Promise<BusinessAccess> {
  const { model } = world
  const mine = await mineOf(docs, person, today, world.designations)
  const designationNames = world.designationNames ?? new Map((world.designations && mine.jobs.some(j => exact(j.designation))
    ? await every(docs, DESIGNATION, ['designation'], [['row_id', 'in', [...new Set(mine.jobs.map(j => exact(j.designation)).filter(Boolean))]]]) : [])
    .map(row => [exact(row.row_id), text(row.designation)]))
  const facts = {
    buyerSections: mine.buyerSections.map(b => exact(b.row_id)),
    jobs: mine.jobs.map(j => ({ id: exact(j.row_id), job: text(j.job), designation: designationNames.get(exact(j.designation)) ?? null })),
    merchandise: mine.merchandise.map(m => ({ id: exact(m.row_id), responsibility: text(m.responsibility) })),
    clustersHeaded: mine.clusters.map(c => exact(c.row_id)),
    hand: world.hand.filter(h => h.person === person),
  }
  const { held, unmapped } = rolesOf(facts, model)
  const reachesOf = new Map(model.roles.map(r => [r.id, r.reaches]))
  const withPlaces = []
  for (const role of held) withPlaces.push({ ...role, places: await rolePlaces(docs, person, today, role, reachesOf.get(role.role), mine) })
  const dash = new Set(model.permissions.filter(p => p.app === DASH_APP).map(p => p.role))
  const everyReport = everyReportRoles(held, model)
  // A role viewing every report does so at every store, wherever its own area lies; its own area stays as it is.
  const everyStore = everyReport.length
    ? await rolePlaces(docs, person, today, { role: everyReport[0], source: 'also_given', title: null, spot: { kind: 'company' } }, 'Whole company', mine) : []
  return { held: withPlaces, unmapped, places: mergePlaces([...withPlaces.filter(r => dash.has(r.role)).flatMap(r => r.places), ...everyStore]),
    opens: opensDash(held, model), roles: [...new Set(held.map(h => h.role))].sort(), everyReport, mine }
}

/**
 * Places from several roles as one scope: one place per label, its subcategories the union and a whole store
 * wherever any role holds it whole. The platform needs labels unique within a scope.
 */
export function mergePlaces(places: Place[]): Place[] {
  const byLabel = new Map<string, Place>()
  for (const place of places) {
    const seen = byLabel.get(place.label)
    if (!seen) { byLabel.set(place.label, { ...place, filters: { ...place.filters }, reasons: [...(place.reasons ?? [])] }); continue }
    const codes = seen.filters.subcategory && place.filters.subcategory ? [...new Set([...seen.filters.subcategory, ...place.filters.subcategory])].sort() : null
    if (codes) seen.filters.subcategory = codes
    else delete seen.filters.subcategory
    seen.basis = [...new Set([...(seen.basis ?? '').split(', '), ...(place.basis ?? '').split(', ')].filter(Boolean))].sort().join(', ')
    const reasons = new Map([...seen.reasons!, ...(place.reasons ?? [])].map(r => [JSON.stringify(r), r]))
    seen.reasons = [...reasons].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => r)
  }
  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label))
}
