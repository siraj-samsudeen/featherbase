// #1218 (option A, owner 17-Nov-2026): business roles in shadow. The one place a person's business
// roles are worked out: from the HR title through the Title Map (the designation's mapping, else the
// job's), merchandise assignments, a cluster naming them its head, and hand changes (Correct replaces
// the title's role, Also give adds one). Where each role applies is a spot; the server turns a spot
// into places with reachOf, so the place rules stay in provider.ts. Nothing here decides access today.
import { reportsReaching, type AccessRow, type BundleMember } from './report-access.ts'

export const REACHES = ['Own', 'Team', 'Area', 'All'] as const
export type Reach = (typeof REACHES)[number]
export interface BusinessRole { id: string; name: string; description?: string | null; by_hand_only?: boolean }
export interface Permission { role: string; app: string; level: string; verb: string; thing: string; reach: Reach }
export interface TitleRule { title: string; role: string | null }
export interface HandChange { id: string; change: 'Correct' | 'Also give'; role: string; ends_on?: string | null; reason?: string | null; removed?: boolean }
export interface HeldJob { id: string; job: string; designation: string | null }
export interface HeldMerchandise { id: string; responsibility: string }
export interface PersonFacts { jobs: HeldJob[]; merchandise: HeldMerchandise[]; clustersHeaded: string[]; hand: HandChange[] }
export interface Model { rules: TitleRule[]; roles: BusinessRole[]; permissions: Permission[]; today: string }

export type Source = 'hr_title' | 'merchandise' | 'cluster_head' | 'corrected' | 'also_given'
export const SOURCE_WORDS: Record<Source, string> = {
  hr_title: 'From HR title', merchandise: 'From merchandise assignment', cluster_head: 'Named cluster head', corrected: 'Corrected by hand', also_given: 'Also given by hand',
}
/** Where a role applies, before it is turned into stores and subcategories. */
export type Spot = { kind: 'job'; job: string } | { kind: 'merchandise'; assignments: string[] } | { kind: 'cluster'; cluster: string } | { kind: 'company' } | { kind: 'none' }
export interface HeldRole { role: string; source: Source; title: string | null; spot: Spot; hand?: string; until?: string | null; reason?: string | null }
export interface Unmapped { title: string; job: string }

/** D2: these reach the whole company wherever their assignment sits. */
const WHOLE_COMPANY = new Set(['head office', 'leadership'])
/** The job whose title names a cluster head's role. */
export const CLUSTER_TITLE = 'Cluster Manager'

const key = (title: string) => title.trim().toLowerCase()
function mapping(rules: TitleRule[]): Map<string, string> {
  return new Map(rules.filter(rule => rule.role).map(rule => [key(rule.title), rule.role!]))
}

/** A role reaches the whole company when its name says so (D2) or its every permission reaches All. */
export function wholeCompany(role: string, model: Pick<Model, 'roles' | 'permissions'>): boolean {
  const named = model.roles.find(r => r.id === role)?.name ?? ''
  const own = model.permissions.filter(p => p.role === role)
  return WHOLE_COMPANY.has(key(named)) || (own.length > 0 && own.every(p => p.reach === 'All'))
}

const inForce = (hand: HandChange, today: string) => !hand.removed && (!hand.ends_on || hand.ends_on >= today)

/** A person's business roles, each with its source and spot, and the titles nobody has mapped yet. */
export function rolesOf(facts: PersonFacts, model: Model): { held: HeldRole[]; unmapped: Unmapped[] } {
  const map = mapping(model.rules)
  const company = (role: string) => wholeCompany(role, model)
  const at = (role: string, job: string): Spot => (company(role) ? { kind: 'company' } : { kind: 'job', job })
  const hand = facts.hand.filter(h => inForce(h, model.today) && model.roles.some(r => r.id === h.role))
  const corrections = hand.filter(h => h.change === 'Correct')
  const handFacts = (h: HandChange) => ({ hand: h.id, until: h.ends_on ?? null, reason: h.reason ?? null })
  const held: HeldRole[] = []
  const unmapped: Unmapped[] = []
  for (const job of facts.jobs) {
    const byDesignation = job.designation ? map.get(key(job.designation)) : undefined
    const role = byDesignation ?? map.get(key(job.job))
    const title = byDesignation ? job.designation : job.job
    if (corrections.length) {
      for (const c of corrections) held.push({ role: c.role, source: 'corrected', title: title ?? job.job, spot: at(c.role, job.id), ...handFacts(c) })
      continue
    }
    if (!role) { unmapped.push({ title: job.designation ?? job.job, job: job.job }); continue }
    held.push({ role, source: 'hr_title', title, spot: at(role, job.id) })
  }
  if (!facts.jobs.length)
    for (const c of corrections) held.push({ role: c.role, source: 'corrected', title: null, spot: company(c.role) ? { kind: 'company' } : { kind: 'none' }, ...handFacts(c) })
  // Merchandise assignments: one role per mapped responsibility, over all its assignments.
  const byRole = new Map<string, { title: string; assignments: string[] }>()
  for (const m of facts.merchandise) {
    const role = map.get(key(m.responsibility))
    if (!role) { unmapped.push({ title: m.responsibility, job: m.responsibility }); continue }
    const entry = byRole.get(role) ?? { title: m.responsibility, assignments: [] }
    entry.assignments.push(m.id)
    byRole.set(role, entry)
  }
  for (const [role, { title, assignments }] of byRole)
    held.push({ role, source: 'merchandise', title, spot: company(role) ? { kind: 'company' } : { kind: 'merchandise', assignments } })
  const clusterRole = map.get(key(CLUSTER_TITLE))
  if (clusterRole) for (const cluster of facts.clustersHeaded) held.push({ role: clusterRole, source: 'cluster_head', title: null, spot: { kind: 'cluster', cluster } })
  for (const given of hand.filter(h => h.change === 'Also give')) {
    const spots: Spot[] = company(given.role) ? [{ kind: 'company' }]
      : facts.jobs.length ? facts.jobs.map(job => ({ kind: 'job', job: job.id }) as Spot)
        : facts.merchandise.length ? [{ kind: 'merchandise', assignments: facts.merchandise.map(m => m.id) }] : [{ kind: 'none' }]
    for (const spot of spots) held.push({ role: given.role, source: 'also_given', title: null, spot, ...handFacts(given) })
  }
  return { held, unmapped }
}

const roleName = (id: string, roles: BusinessRole[]) => roles.find(r => r.id === id)?.name ?? 'A role no longer listed'

/** The apps and levels the held roles give, each once, with the roles that give it. */
export function appsOf(held: HeldRole[], model: Pick<Model, 'roles' | 'permissions'>): { app: string; level: string; via: string[] }[] {
  const apps = new Map<string, { app: string; level: string; via: Set<string> }>()
  const ids = new Set(held.map(h => h.role))
  for (const p of model.permissions.filter(p => ids.has(p.role))) {
    const k = `${p.app} · ${p.level}`
    const entry = apps.get(k) ?? { app: p.app, level: p.level, via: new Set<string>() }
    entry.via.add(roleName(p.role, model.roles))
    apps.set(k, entry)
  }
  return [...apps.values()].map(a => ({ app: a.app, level: a.level, via: [...a.via].sort() }))
    .sort((a, b) => a.app.localeCompare(b.app) || a.level.localeCompare(b.level))
}

/** D3: Dash comes with a business role that holds a Dash permission. */
export const DASH_APP = 'Dash'
export const opensDash = (held: HeldRole[], model: Pick<Model, 'permissions'>) =>
  held.some(h => model.permissions.some(p => p.role === h.role && p.app === DASH_APP))

const COLLECTIVE = new Set(['staff', 'leadership', 'head office'])
const REACH_WORDS: Record<Reach, string> = { Own: 'they own', Team: 'for their Team', Area: 'in their Area', All: 'across the company' }
/** "Store Managers can Edit Sections in their Area". */
export function permissionSentence(role: string, p: Pick<Permission, 'verb' | 'thing' | 'reach'>): string {
  const who = COLLECTIVE.has(key(role)) || role.endsWith('s') ? role : `${role}s`
  return `${who} can ${p.verb} ${p.thing} ${REACH_WORDS[p.reach] ?? ''}`.trim()
}

export interface TitleInUse { title: string; people: string[]; job?: string }
export interface TitleRow { title: string; role: string | null; people: number; falls_back_to?: string }
/** The Title Map as read: every title in use, those not mapped yet first, each with how many people hold it. */
export function titleList(inUse: TitleInUse[], model: Pick<Model, 'rules' | 'roles'>): TitleRow[] {
  const map = mapping(model.rules)
  const rows = new Map<string, TitleRow & { set: Set<string> }>()
  for (const t of inUse) {
    const row = rows.get(key(t.title)) ?? { title: t.title, role: map.get(key(t.title)) ?? null, people: 0, set: new Set<string>() }
    for (const p of t.people) row.set.add(p)
    const fallback = !row.role && t.job ? map.get(key(t.job)) : undefined
    if (fallback) row.falls_back_to = roleName(fallback, model.roles)
    rows.set(key(t.title), row)
  }
  return [...rows.values()].map(({ set, ...row }) => ({ ...row, people: set.size }))
    .sort((a, b) => Number(!!a.role) - Number(!!b.role) || a.title.localeCompare(b.title))
}

export type ShadowReceiver = { kind: 'person'; person: string } | { kind: 'role'; role: string } | { kind: 'decision'; name: string }
/** D4 in shadow: a grant to a job goes to its business role; one to an app role (Dash Reader) needs a decision. */
export function shadowReceiver(row: AccessRow, model: Pick<Model, 'rules'>): ShadowReceiver | null {
  if (row.person) return { kind: 'person', person: row.person }
  if (row.job) {
    const role = mapping(model.rules).get(key(row.job))
    return role ? { kind: 'role', role } : { kind: 'decision', name: row.job }
  }
  return row.role ? { kind: 'decision', name: row.role } : null
}

export interface NewWhy { role?: string; person?: true; bundle: string | null }
/** The reports the new model gives a person: grants to them, and grants to a business role they hold. */
export function newModelReports(person: string, roles: string[], rows: readonly AccessRow[], members: readonly BundleMember[], model: Pick<Model, 'rules'>): Map<string, NewWhy[]> {
  const got = new Map<string, NewWhy[]>()
  const add = (report: string, why: NewWhy) => got.set(report, [...(got.get(report) ?? []), why])
  for (const row of rows) {
    if (Boolean(row.report) === Boolean(row.report_bundle)) continue
    const to = shadowReceiver(row, model)
    const why: Omit<NewWhy, 'bundle'> | null = to?.kind === 'person' && to.person === person ? { person: true }
      : to?.kind === 'role' && roles.includes(to.role) ? { role: to.role } : null
    if (!why) continue
    if (row.report) add(row.report, { ...why, bundle: null })
    else for (const m of members) if (m.report_bundle === row.report_bundle) add(m.report, { ...why, bundle: m.report_bundle })
  }
  return got
}

/** Reports that reach someone today only through an app role such as Dash Reader: the owner decides those (D4). */
export function decisionReports(who: { person: string; roles: readonly string[]; jobs: readonly string[] }, rows: readonly AccessRow[], members: readonly BundleMember[]): string[] {
  return [...reportsReaching(who, rows, members)].filter(([, because]) => because.every(b => b.kind === 'role')).map(([report]) => report).sort()
}

/** One side of the comparison: Dash opens, the places by store (null: the whole store), the reports. */
export interface Side { opens: boolean; places: Record<string, string[] | null>; reports: string[] }
export type ChangeKind = 'loses_dash' | 'gains_dash' | 'stores' | 'reports' | 'decision'
export interface Difference { kind: ChangeKind | null; storesGained: string[]; storesLost: string[]; storesChanged: string[]; gained: string[]; lost: string[]; decisions: string[] }

/** What changes for one person from today to the new model; `decisions` are today's reports given only through an app role. */
export function differences(today: Side, next: Side, decisions: string[]): Difference {
  const now = Object.keys(today.places)
  const then = Object.keys(next.places)
  const same = (a: string[] | null, b: string[] | null) => (a === null || b === null ? a === b : a.length === b.length && [...a].sort().join() === [...b].sort().join())
  const storesGained = then.filter(s => !now.includes(s)).sort()
  const storesLost = now.filter(s => !then.includes(s)).sort()
  const storesChanged = now.filter(s => then.includes(s) && !same(today.places[s], next.places[s])).sort()
  const gained = next.reports.filter(r => !today.reports.includes(r)).sort()
  const missing = today.reports.filter(r => !next.reports.includes(r))
  const lost = missing.filter(r => !decisions.includes(r)).sort()
  const undecided = missing.filter(r => decisions.includes(r)).sort()
  const kind: ChangeKind | null = today.opens && !next.opens ? 'loses_dash' : !today.opens && next.opens ? 'gains_dash'
    : storesGained.length || storesLost.length || storesChanged.length ? 'stores' : gained.length || lost.length ? 'reports' : undecided.length ? 'decision' : null
  return { kind, storesGained, storesLost, storesChanged, gained, lost, decisions: undecided }
}

/** Subcategory codes are SAP's levels: 2 digits the line of business, 4 the main category, 6 the category. */
const PREFIX_LENGTHS = [2, 4, 6] as const
/**
 * A merchandise area as Dash's code prefixes (the encoding #1269 sends to Dives): the shortest prefix
 * of which every known code is held, else the code itself. Never wider than the codes held.
 */
export function areaPrefixes(held: Iterable<string>, every: readonly string[]): string[] {
  const holds = new Set(held)
  const partial = new Map<number, Set<string>>(PREFIX_LENGTHS.map(length => [length, new Set<string>()]))
  for (const code of every) if (!holds.has(code)) for (const length of PREFIX_LENGTHS) partial.get(length)!.add(code.slice(0, length))
  const known = new Set(every)
  const sent = new Set<string>()
  for (const code of holds) {
    const length = known.has(code) ? PREFIX_LENGTHS.find(at => code.length > at && !partial.get(at)!.has(code.slice(0, at))) : undefined
    sent.add(length === undefined ? code : code.slice(0, length))
  }
  return [...sent].sort()
}
