// Which reports reach a person, and why (#1046). Access only ever adds up: a person sees whatever
// reaches them by any route, and no row means no report. A row that isn't exactly one thing given
// to one receiver gives nothing, so a bad row can never widen access.

export interface AccessRow {
  report: string | null
  report_bundle: string | null
  person: string | null
  role: string | null
  job: string | null
  /** #1277 (D4): a grant to a business role, read only when business roles decide. */
  business_role?: string | null
}
export interface BundleMember { report_bundle: string; report: string }
/** Who is asking, as read fresh for this request. */
export interface Receiver { person: string; roles: readonly string[]; jobs: readonly string[] }
/** One route by which a report reaches a person. */
export interface Because { kind: 'person' | 'role' | 'job' | 'business_role'; receiver: string; bundle: string | null }

function routeOf(row: AccessRow, who: Receiver): Omit<Because, 'bundle'> | null {
  // #1277: a grant to a business role is not one of the old rules' routes, whatever else the row names.
  if (row.business_role) return null
  const named = (['person', 'role', 'job'] as const).filter((kind) => row[kind])
  if (named.length !== 1) return null
  const kind = named[0]
  const receiver = row[kind] as string
  const reaches = kind === 'person' ? receiver === who.person : (kind === 'role' ? who.roles : who.jobs).includes(receiver)
  return reaches ? { kind, receiver } : null
}

/** Report key to every route that reaches this person. */
export function reportsReaching(who: Receiver, rows: readonly AccessRow[], members: readonly BundleMember[]): Map<string, Because[]> {
  const reached = new Map<string, Because[]>()
  const add = (report: string, because: Because) => reached.set(report, [...(reached.get(report) ?? []), because])
  for (const row of rows) {
    if (Boolean(row.report) === Boolean(row.report_bundle)) continue
    const route = routeOf(row, who)
    if (!route) continue
    if (row.report) add(row.report, { ...route, bundle: null })
    else for (const member of members) if (member.report_bundle === row.report_bundle) add(member.report, { ...route, bundle: member.report_bundle })
  }
  return reached
}

// #1277 (D4): the reports business roles give.
export interface NewWhy { role?: string; person?: true; bundle: string | null }
const RECEIVERS = ['person', 'role', 'job', 'business_role'] as const

/** Report key to why it reaches this person under business roles: given to them, or to a business role they hold. */
export function businessReportsReaching(who: { person: string; roles: readonly string[] }, rows: readonly AccessRow[], members: readonly BundleMember[]): Map<string, NewWhy[]> {
  const got = new Map<string, NewWhy[]>()
  const add = (report: string, why: NewWhy) => got.set(report, [...(got.get(report) ?? []), why])
  for (const row of rows) {
    if (Boolean(row.report) === Boolean(row.report_bundle)) continue
    // A row naming more than one receiver gives nothing, so a bad row can never widen access.
    const named = RECEIVERS.filter(kind => row[kind])
    if (named.length !== 1) continue
    const why: Omit<NewWhy, 'bundle'> | null = named[0] === 'person' && row.person === who.person ? { person: true }
      : named[0] === 'business_role' && who.roles.includes(row.business_role!) ? { role: row.business_role! } : null
    if (!why) continue
    if (row.report) add(row.report, { ...why, bundle: null })
    else for (const m of members) if (m.report_bundle === row.report_bundle) add(m.report, { ...why, bundle: m.report_bundle })
  }
  return got
}
