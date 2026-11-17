// #1225 prototype: stands in for src/api.ts with made-up data, so the Report access page's
// layouts and Add a Dive's ways can be tried without a server or MotherDuck. Every name, code
// and Dive here is invented. `?scope=team` shows a Team Report Manager's page (#1217).
import { fitOf, reportShapeFor } from '../src/dive-contract'

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}
type Who = { code: string | null; jobs: string[]; staff: 'current' | 'left' | 'none' }
const people: { person: string; name: string; who: Who }[] = [
  { person: 'p1', name: 'Arun Kumar', who: { code: 'E1001', jobs: ['Store Manager · Lakeside'], staff: 'current' } },
  { person: 'p2', name: 'Priya Nair', who: { code: 'E1002', jobs: ['Category Buyer · Head Office'], staff: 'current' } },
  { person: 'p3', name: 'Meena Raghavan', who: { code: 'E1003', jobs: ['Floor Supervisor · Hillview'], staff: 'current' } },
  { person: 'p4', name: 'Vinod Raj', who: { code: 'E1004', jobs: ['Cashier · Lakeside'], staff: 'current' } },
  { person: 'p5', name: 'Vinod Raj', who: { code: 'E1017', jobs: ['Store Manager · Riverside'], staff: 'current' } },
  { person: 'p6', name: 'Kavya Menon', who: { code: 'E1006', jobs: ['Regional Manager · North'], staff: 'current' } },
  { person: 'p7', name: 'Suresh Babu', who: { code: 'E0900', jobs: [], staff: 'left' } },
  { person: 'p8', name: 'Anitha Joseph', who: { code: 'E1008', jobs: ['Category Buyer · Head Office'], staff: 'current' } },
  { person: 'p9', name: 'Deepak Pillai', who: { code: null, jobs: [], staff: 'none' } },
  { person: 'p10', name: 'Lakshmi Iyer', who: { code: 'E0101', jobs: ['Executive Assistant · Head Office'], staff: 'current' } },
  { person: 'p11', name: 'Rahul Varma', who: { code: 'E0102', jobs: ['Report Access Manager · Head Office'], staff: 'current' } },
]
/** #1225: which Featherbase Tables this viewer may open, as `/api/table/<name>:meta` answers #1223's RecordLink. */
export function opensTable(table: string): boolean {
  if (team()) return table === 'dash.report'
  return viewer() === 'ram' ? ['dash.report', 'dash.report_bundle'].includes(table) : true
}
/** #1225: who is looking. A System Manager opens every record; a Report Access Manager (made up) only reports and bundles. */
const viewer = () => new URLSearchParams(window.location.search).get('viewer') === 'ram' ? 'ram' : 'system'
type MadeUpReport = { key: string; name: string; areas?: ('Sales' | 'Inventory' | 'Buying' | 'Operations' | 'HR' | 'Finance')[]; filter_shape: string; pickers_in_dive?: boolean; waiting_for_owner?: boolean; dive?: string
  closed?: string | null; last_change?: string | null; checked_version?: number }
const reports: MadeUpReport[] = [
  { key: 'sales-target', name: 'Sales · Target vs Actual', filter_shape: 'No filter', pickers_in_dive: true },
  { key: 'women-buyers', name: 'Women Buyers Dashboard', filter_shape: 'Stores and subcategories', dive: '1c76d636-0000-4000-8000-000000000006', checked_version: 87 },
  { key: 'store-cockpit', name: 'Store & Section Cockpit', filter_shape: 'One store and subcategories' },
  { key: 'cashier', name: 'Cashier Scorecard', filter_shape: 'Whole stores' },
  { key: 'vendor-sales', name: 'Vendor Sales', filter_shape: 'Stores and subcategories' },
  { key: 'region-overview', name: 'Region Sales Overview', filter_shape: 'No filter' },
  { key: 'stock-ageing', name: 'Stock Ageing', filter_shape: 'No filter' },
  { key: 'attendance', name: 'Attendance Summary', filter_shape: 'Whole stores' },
]
const bundles = [
  { id: 'b1', name: 'Store manager pack', reports: ['store-cockpit', 'cashier', 'sales-target'] },
  { id: 'b2', name: 'Buyer pack', reports: ['women-buyers', 'vendor-sales'] },
]
const nameOf = (key: string) => reports.find(r => r.key === key)!.name
let rowId = 100
const row = (gives: ['Report' | 'Bundle', string], to: ['Person' | 'Role' | 'Job', string], by = 'p10', on = '2026-11-12', removable = true) => {
  const person = to[0] === 'Person' ? people.find(p => p.person === to[1])! : null
  const giver = people.find(p => p.person === by)
  const givesId = gives[0] === 'Report' ? reports.find(r => r.name === gives[1])?.key : bundles.find(b => b.name === gives[1])?.id
  return { id: `r${rowId++}`, updated_at: '2026-11-12T10:00:00Z', gives: { kind: gives[0], name: gives[1], id: givesId },
    to: { kind: to[0], name: person ? person.name : to[1], id: person ? person.person : to[1], ...(person ? { who: person.who } : {}) },
    given_by: giver?.name ?? by, given_by_id: giver?.person ?? null, given_on: on, removable, person: person?.person }
}
let rows = [
  row(['Bundle', 'Store manager pack'], ['Job', 'Store Manager']),
  row(['Bundle', 'Buyer pack'], ['Job', 'Category Buyer']),
  row(['Report', 'Sales · Target vs Actual'], ['Role', 'Regional Manager'], 'p11', '2026-11-10'),
  row(['Report', 'Region Sales Overview'], ['Person', 'p6'], 'p10', '2026-11-15'),
  row(['Report', 'Region Sales Overview'], ['Person', 'p1'], 'p10', '2026-11-15'),
  row(['Report', 'Women Buyers Dashboard'], ['Person', 'p2']),
  row(['Report', 'Women Buyers Dashboard'], ['Person', 'p8']),
  row(['Report', 'Vendor Sales'], ['Person', 'p3'], 'p11', '2026-11-09'),
  row(['Report', 'Cashier Scorecard'], ['Person', 'p4'], 'p11', '2026-11-08'),
  row(['Report', 'Store & Section Cockpit'], ['Person', 'p5'], 'p11', '2026-11-08'),
  row(['Report', 'Store & Section Cockpit'], ['Person', 'p3'], 'p11', '2026-11-08'),
  row(['Report', 'Stock Ageing'], ['Person', 'p6'], 'p2', '2026-11-05', false),
  row(['Report', 'Attendance Summary'], ['Job', 'Store Manager'], 'p11', '2026-11-04'),
  row(['Report', 'Sales · Target vs Actual'], ['Person', 'p7'], 'p11', '2026-10-30'),
]
// The Jockey Women Dive is real (its id, title, version 5 and the keys its source reads, checked
// 16-Nov-2026), so its MotherDuck link opens; its owner is shown as a made-up handle. The rest are invented.
const dives: { dive_id: string; title: string; owner: string; saved_on: string | null; version: number; reads: string[] | null; in_dash?: string }[] = [
  { dive_id: '1c76d636-3af8-45fb-926e-14f6ba6737ad', title: 'Fashion · Jockey Women — Store SKU/Size Stock, Cover Days & Kerala Transfers', owner: 'buyer_lead', saved_on: '2026-11-16', version: 5,
    reads: ['store', 'brand', 'tab', 'range', 'from', 'to', 'openParents'] },
  { dive_id: '1c76d636-0000-4000-8000-000000000002', title: 'Footwear Sell-through by Store', owner: 'analyst_two', saved_on: '2026-11-15', version: 9, reads: ['reach', 'store', 'month', 'app_origin'] },
  { dive_id: '1c76d636-0000-4000-8000-000000000008', title: 'Store Daily Snapshot', owner: 'analyst_two', saved_on: '2026-11-14', version: 3, reads: ['plant_code', 'material_groups', 'whole_store', 'month'] },
  { dive_id: '1c76d636-0000-4000-8000-000000000003', title: 'Company P&L Summary', owner: 'finance_lead', saved_on: '2026-11-14', version: 12, reads: ['month'] },
  { dive_id: '1c76d636-0000-4000-8000-000000000004', title: 'Grocery Fill Rate by Store', owner: 'analyst_two', saved_on: '2026-11-13', version: 2, reads: ['plant_code', 'week'] },
  { dive_id: '1c76d636-0000-4000-8000-000000000005', title: 'Festival Planner', owner: 'buyer_lead', saved_on: '2026-11-11', version: 1, reads: null },
  { dive_id: '1c76d636-0000-4000-8000-000000000006', title: 'Women Buyers Dashboard', owner: 'buyer_lead', saved_on: '2026-11-10', version: 87, reads: ['reach', 'month'], in_dash: 'Women Buyers Dashboard' },
]
const waiting = [
  { person: 'p9', name: 'Deepak Pillai', asked_on: '2026-11-15', who: people[8].who },
  { person: 'p4', name: 'Vinod Raj', asked_on: '2026-11-14', who: people[3].who },
]
const team = () => new URLSearchParams(window.location.search).get('scope') === 'team'
const teamMembers = people.filter(p => ['p3', 'p4', 'p5'].includes(p.person)).map(p => ({ person: p.person, name: p.name, ...p.who }))
const today = '16-Nov-2026'
const reportOf = (payload: Record<string, unknown>) => {
  const report = reports.find(r => r.key === payload.report)
  if (!report) throw new ApiError('That report is no longer in Dash')
  return report
}
/**
 * As the server would: read the Dive's source now and decide from the keys it really reads. A
 * waiting report switches to each person's stores; a store-aware one whose Dive dropped the keys
 * closes rather than show everyone everything. Each change is logged with what made it.
 */
function check(report: MadeUpReport, trigger: string) {
  const dive = dives.find(d => d.dive_id === report.dive)
  const shape = reportShapeFor(fitOf(dive?.reads))
  const version = dive?.version ?? null
  report.checked_version = version ?? undefined
  const fit = fitOf(dive?.reads)
  const missing = fit.kind === 'partly' ? fit.missing : ['reach']
  if (shape && (report.waiting_for_owner || report.closed)) {
    Object.assign(report, { filter_shape: shape.filter_shape, pickers_in_dive: shape.pickers_in_dive, waiting_for_owner: false, closed: null,
      last_change: `Switched to each person's stores on ${today}, ${trigger} (Dive version ${version}).` })
    return { switched: true, version }
  }
  if (!shape && !report.waiting_for_owner && report.filter_shape !== 'No filter') {
    Object.assign(report, { closed: `Closed on ${today}: Dive version ${version} no longer takes each person's stores, so Dash won't open it for anyone. Ask its owner, or remove it.`,
      last_change: `Closed ${trigger} (Dive version ${version}).` })
    return { switched: false, closed: true, version }
  }
  return { switched: false, version, missing: shape ? [] : missing }
}
const pause = () => new Promise(resolve => setTimeout(resolve, 150))

function page() {
  const visible = team() ? rows.filter(r => r.to.kind === 'Person' && teamMembers.some(m => m.person === r.person)) : rows
  return {
    ...(team() ? { scope: 'team', team: teamMembers } : { scope: 'company' }),
    reports: (team() ? reports.filter(r => ['store-cockpit', 'cashier'].includes(r.key)) : reports)
      .map(({ dive, checked_version: _v, ...r }) => { const d = dives.find(x => x.dive_id === dive); return { ...r, dive_owner: d?.owner ?? null, dive_title: d?.title ?? null, dive_id: d?.dive_id ?? null } }),
    bundles: team() ? [] : bundles.map(b => ({ id: b.id, name: b.name, reports: b.reports.map(key => ({ member: `${b.id}-${key}`, updated_at: 'x', key, name: nameOf(key) })) })),
    roles: ['Regional Manager', 'Buyer', 'Store Manager'], jobs: ['Store Manager', 'Floor Supervisor', 'Category Buyer', 'Cashier'],
    rows: visible.map(({ person: _p, ...rest }) => rest), waiting: team() ? [] : waiting,
  }
}

export async function read<T>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
  await pause()
  const answers: Record<string, () => unknown> = {
    access_page: page,
    reports: () => reports.map(r => ({ key: r.key, name: r.name, takes_store: false, takes_month: false })),
    approvals: () => ({ state: 'ok', proposals: [] }),
    department_approvals: () => [],
    manages_access: () => true,
    // #1223's RecordLink asks whether this viewer may open each person on Dash's own page.
    dash_pages_open: () => ((payload.refs as unknown[]) ?? []).map(() => viewer() !== 'ram'),
    holds_master_data: () => false,
    holds_department_job: () => false,
    dive_choices: () => (team() ? (() => { throw new ApiError('Only a Report Access Manager or a System Manager can add reports', 403) })() : { dives: dives.map(d => ({ ...d, owner_person: ({ buyer_lead: 'Priya Nair', finance_lead: 'Anitha Joseph' } as Record<string, string>)[d.owner] ?? null, in_dash: d.in_dash ?? null, in_dash_key: reports.find(r => r.dive === d.dive_id)?.key ?? null })) }),
    person_search: () => {
      const q = String(payload.q ?? '').toLowerCase()
      const pool = team() ? people.filter(p => teamMembers.some(m => m.person === p.person)) : people
      return pool.filter(p => p.name.toLowerCase().includes(q) || (p.who.code ?? '').toLowerCase().includes(q)).map(p => ({ person: p.person, name: p.name, ...p.who }))
    },
    person_lookup: () => {
      const p = people.find(x => x.person === payload.person)!
      // As the server does: given to them, or to their job; a bundle gives each report in it.
      const jobs = p.who.jobs.map(job => job.split(' · ')[0])
      const reaching = rows.filter(r => (r.to.kind === 'Person' && r.person === p.person) || (r.to.kind === 'Job' && jobs.includes(r.to.name)))
      const found = new Map<string, { key: string; name: string; because: string[]; closed: null }>()
      for (const r of reaching) {
        const why = r.to.kind === 'Job' ? `Through their job, ${r.to.name}` : `Given to them by ${r.given_by}`
        const keys = r.gives.kind === 'Report' ? [r.gives.id!] : bundles.find(b => b.id === r.gives.id)?.reports ?? []
        for (const key of keys) {
          const entry = found.get(key) ?? { key, name: nameOf(key), because: [], closed: null }
          entry.because.push(r.gives.kind === 'Bundle' ? `${why}, in ${r.gives.name}` : why)
          found.set(key, entry)
        }
      }
      return { name: p.name, reports: [...found.values()] }
    },
  }
  if (!answers[name]) throw new ApiError(`The prototype has no read called ${name}`)
  return answers[name]() as T
}

export async function act<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  await pause()
  if (name === 'give_report') {
    const what: ['Report' | 'Bundle', string] = payload.report ? ['Report', nameOf(String(payload.report))] : ['Bundle', bundles.find(b => b.id === payload.report_bundle)!.name]
    const to: ['Person' | 'Role' | 'Job', string] = payload.person ? ['Person', String(payload.person)] : payload.role ? ['Role', String(payload.role)] : ['Job', String(payload.job)]
    rows = [row(what, to, 'You', '2026-11-16'), ...rows]
    return {} as T
  }
  if (name === 'remove_report_access') { rows = rows.filter(r => r.id !== payload.id); return {} as T }
  if (name === 'add_report') {
    const dive = dives.find(d => d.dive_id === payload.dive_id)!
    const reportName = String(payload.name)
    if (reports.some(r => r.name.toLowerCase() === reportName.toLowerCase())) throw new ApiError(`Another report is called ${reportName}`)
    // As the server would: the shape comes from the Dive as read now, never from the page.
    const shape = reportShapeFor(fitOf(dive.reads))
    if (payload.store_aware === true && !shape) throw new ApiError('This Dive no longer shows each person only their stores. Choose it again.')
    const key = reportName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    // Newest first, so a report just added is at the top of the list.
    reports.unshift({ key, name: reportName, dive: dive.dive_id, areas: Array.isArray(payload.areas) ? payload.areas as MadeUpReport['areas'] : undefined, filter_shape: shape?.filter_shape ?? 'No filter', pickers_in_dive: shape?.pickers_in_dive,
      waiting_for_owner: !shape && payload.owner_asked === true, checked_version: dive.version })
    dive.in_dash = reportName
    return { key, name: reportName } as T
  }
  if (name === 'recheck_report') return check(reportOf(payload), 'after you pressed "The owner has done it — check now"') as T
  if (name === 'prototype_reader_opens') {
    // As the server would on every open: read the Dive again only when its version moved on.
    const report = reportOf(payload)
    const dive = dives.find(d => d.dive_id === report.dive)
    if (!dive || dive.version === report.checked_version) return { checked: false, switched: false, version: dive?.version ?? null } as T
    return { checked: true, ...check(report, 'by itself, when a reader opened it') } as T
  }
  if (name === 'prototype_owner_saves') {
    const dive = dives.find(d => d.dive_id === reportOf(payload).dive)!
    const base = (dive.reads ?? []).filter(key => !['reach', 'month'].includes(key))
    dive.reads = payload.reach ? ['reach', ...new Set([...base, 'store', 'month'])] : base
    dive.version += 1
    return {} as T
  }
  if (name === 'retire_report') {
    // A retire: the report leaves Dash, its grants stop and it leaves bundles; history is kept.
    const report = reportOf(payload)
    reports.splice(reports.indexOf(report), 1)
    rows = rows.filter(r => !(r.gives.kind === 'Report' && r.gives.name === report.name))
    for (const b of bundles) b.reports = b.reports.filter(key => key !== report.key)
    const dive = dives.find(d => d.dive_id === report.dive)
    if (dive) delete dive.in_dash
    return {} as T
  }
  if (name === 'prototype_decline_waiting') { waiting.splice(waiting.findIndex(w => w.person === payload.person), 1); return {} as T }
  if (name === 'make_bundle') {
    if (bundles.some(b => b.name.toLowerCase() === String(payload.name).toLowerCase())) throw new ApiError(`Another bundle is called ${payload.name}`)
    const id = `b${bundles.length + 1}`
    bundles.push({ id, name: String(payload.name), reports: [] })
    return { id } as T
  }
  if (name === 'add_to_bundle') { bundles.find(b => b.id === payload.bundle)!.reports.push(String(payload.report)); return {} as T }
  if (name === 'remove_from_bundle') { for (const b of bundles) b.reports = b.reports.filter(key => `${b.id}-${key}` !== payload.id); return {} as T }
  throw new ApiError(`The prototype has no action called ${name}`)
}

export async function accessFacts() { return { manages: false } }
