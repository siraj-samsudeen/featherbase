// #1222: View as. A tester sees what another person sees, read-only, without
// their password. An app declares who may (`viewAs.role`, one of its own
// roles) and how its people are found and described (`viewAs.people`, one of
// its reads). The platform keeps the state and swaps the person for reads
// (index.ts); any other request runs as the tester themself, and screens offer
// no change while viewing (permissions.ts).
//
// The state is one view_as_session row per signed-in session, keyed by the
// token's jti: it ends with the session, at Exit, after VIEW_AS_MINUTES, or
// as soon as the tester no longer holds the role or the person can no longer
// be viewed. Every start, switch and end is an Access Log row under the
// tester naming the person; Recent and Frequently used are read from them.
import { sql, type TxSql } from './db'
import { AppError } from './errors'
import { logAccess } from './audit'
import { getRoles, isPrivileged } from './permissions'
// runtime-packages is loaded when first needed: realtime and file serving import this module, and
// a static import here closes a cycle that breaks module start-up (migrate.ts, #1222).
const packages = () => import('./runtime-packages')
/** Live-update sockets: loaded when needed, for the same reason. */
const closeSockets = async (session: string) => (await import('./realtime')).closeViewAsSockets(session)
import { activeApps } from './app-lifecycle'
import type { SessionUser } from './auth'
import type { ViewingAs } from './view-as-context'

/** The answer to the one request that finds its View as has just ended. */
export const VIEW_AS_ENDED = 'View as has ended. Reload the page to see your own view.'

/** How long one View as lasts from its start (or its last switch). */
export const VIEW_AS_MINUTES = 60
const RECENT = 5
const FREQUENT = 5
const FREQUENT_DAYS = 30
const SEARCH_LIMIT = 20

const STARTED = ['view_as_start', 'view_as_switch']

/** What a person is in the picker: their name and, when the app knows, who they are. */
export interface ViewAsPerson {
  person: string
  name: string
  code?: string | null
  jobs?: string[]
}

/** The View as app this tester may use: the first, by app name, that is switched on and whose role they hold. */
async function testerApp(tester: string) {
  const declared = (await packages()).viewAsApps()
  if (!declared.length) return null
  // An app turned off (or not yet activated) gives no one View as.
  const on = new Set((await sql`select name from installed_app where enabled and not activation_pending and name in ${sql(declared.map((d) => d.app))}`)
    .map((r) => String(r.name)).filter((name) => activeApps.has(name)))
  const roles = new Set(await getRoles(tester))
  return declared.sort((a, b) => a.app.localeCompare(b.app)).find((entry) => on.has(entry.app) && roles.has(entry.role)) ?? null
}

export async function mayViewAs(user: SessionUser): Promise<boolean> {
  return user.kind === 'person' && !!user.sign_in && (await testerApp(user.row_id)) !== null
}

async function assertMayViewAs(user: SessionUser) {
  // A session only: an access token (an agent, a script) never views as anyone.
  if (user.kind !== 'person' || !user.sign_in || !(await testerApp(user.row_id)))
    throw new AppError('PermissionError', 'Only a View As Tester can view as someone else')
}

/** Why `person` can't be viewed by `tester`, or null when they can. */
async function unviewable(tester: string, person: string): Promise<string | null> {
  if (person === tester) return 'You are already yourself: choose someone else'
  const [row] = await sql`select row_id, enabled, built_in from person where row_id = ${person}`
  if (!row) return 'That person was not found'
  if (row.built_in) return 'A built-in account cannot be viewed'
  if (!row.enabled) return 'That person is turned off and cannot sign in, so there is nothing to view'
  // Read-only as a System Manager would still read the whole instance.
  if (await isPrivileged(person)) return 'A System Manager or Administrator cannot be viewed: they can read everything'
  return null
}

async function nameOf(person: string): Promise<string> {
  const [row] = await sql`select coalesce(nullif(trim(full_name), ''), '@' || nullif(username, ''), 'Unnamed person') as name from person where row_id = ${person}`
  return String(row?.name ?? 'Unnamed person')
}

/**
 * The View as this request runs under, checked afresh: a live row for this
 * session, a tester who still holds the role, a person who can still be
 * viewed. Anything else ends it, and the request runs as the tester.
 */
export async function activeViewAs(user: SessionUser, { told = true }: { told?: boolean } = {}): Promise<{ as: ViewingAs; user: SessionUser } | null> {
  const session = user.sign_in?.session_id
  if (!session || user.kind !== 'person') return null
  const [row] = await sql`select tester, person, expires_at <= now() as expired, ended_at is not null as ended from view_as_session where session_id = ${session}`
  if (!row) return null
  if (row.expired || row.ended) {
    // Its end is logged (by the sweep, or here); this session's next request is told, once.
    await sql.begin(async (tx) => {
      await lockSession(tx, session)
      await endExpired(tx)
      // A request answers 409 itself, so the marker goes; a socket check leaves it for the page's next request.
      if (told) await tx`delete from view_as_session where session_id = ${session} and ended_at is not null`
    })
    throw new AppError('ConflictError', VIEW_AS_ENDED)
  }
  const person = String(row.person)
  if (String(row.tester) !== user.row_id || !(await testerApp(user.row_id)) || (await unviewable(user.row_id, person))) {
    // Marked ended (and logged), not removed: whichever request or socket check finds it first,
    // the page's next request is still told, and reloads rather than mixing two people.
    await sql.begin(async (tx) => {
      await lockSession(tx, session)
      const [ended] = await tx`update view_as_session set ended_at = now() where session_id = ${session} and ended_at is null returning tester, person`
      if (ended) await logAccess(String(ended.tester), 'view_as_end', { table: 'Person', row_id: String(ended.person), method: 'no_longer_allowed', required: true }, tx)
      if (told) await tx`delete from view_as_session where session_id = ${session} and ended_at is not null`
    })
    await closeSockets(session)
    throw new AppError('ConflictError', VIEW_AS_ENDED)
  }
  const [viewed] = await sql`select row_id, email, full_name from person where row_id = ${person}`
  const name = await nameOf(person)
  return {
    as: { tester: user.row_id, person, name },
    // The tester's sign-in claims stay: they are this session's, and sign-out ends it.
    user: { row_id: person, kind: 'person', email: (viewed.email as string | null) ?? null, full_name: (viewed.full_name as string | null) ?? null, sign_in: user.sign_in },
  }
}

/**
 * Whether the signed-in tester still views as `person`, checked in full (live, the tester still
 * holds the role, the person still viewable), before a viewed read's answer is released. Anything
 * else ends it, logged, as any request would.
 */
export async function viewAsStillHolds(signedIn: SessionUser, person: string): Promise<boolean> {
  const still = await activeViewAs(signedIn).catch(() => null)
  return still?.as.person === person
}

/** Start viewing as `person`, or switch to them. */
export async function startViewAs(user: SessionUser, person: unknown): Promise<void> {
  await assertMayViewAs(user)
  if (typeof person !== 'string' || !person) throw new AppError('ValidationError', 'Expected { person }')
  const reason = await unviewable(user.row_id, person)
  if (reason) throw new AppError('PermissionError', reason)
  const session = user.sign_in!.session_id
  // Never outlives the session it belongs to.
  const ends = Math.min(Date.now() + VIEW_AS_MINUTES * 60_000, user.sign_in!.expires_at * 1000)
  await sql.begin(async (tx) => {
    await lockSession(tx, session)
    // Under the lock: a sign-out that got here first has ended this session.
    const [revoked] = await tx`select 1 from revoked_session where jti = ${session}`
    if (revoked) throw new AppError('AuthenticationError', 'Invalid or expired session')
    await endExpired(tx)
    const [before] = await tx`select person from view_as_session where session_id = ${session} and ended_at is null`
    await tx`insert into view_as_session (session_id, tester, person, expires_at)
      values (${session}, ${user.row_id}, ${person}, ${new Date(ends)})
      on conflict (session_id) do update set tester = excluded.tester, person = excluded.person, started_at = now(), expires_at = excluded.expires_at, ended_at = null`
    await logAccess(user.row_id, before ? 'view_as_switch' : 'view_as_start', { table: 'Person', row_id: person, method: 'view_as', required: true }, tx)
  })
  await closeSockets(session)
}

/** Stop viewing as anyone; a no-op when not viewing. */
export async function endViewAs(user: SessionUser, method = 'exit'): Promise<void> {
  if (user.sign_in?.session_id) await endViewAsSession(user.sign_in.session_id, method)
}

/**
 * End one session's View as, logged under the tester who started it, naming
 * the person: at Exit, sign-out, expiry, or when it may no longer go on.
 * Every way of ending goes through here, so every start has its end.
 */
export async function endViewAsSession(session: string, method: string): Promise<void> {
  await sql.begin(async (tx) => {
    await lockSession(tx, session)
    const [ended] = await tx`delete from view_as_session where session_id = ${session} returning tester, person, ended_at`
    // One whose time already ran out had its end logged then.
    if (ended && ended.ended_at == null) await logAccess(String(ended.tester), 'view_as_end', { table: 'Person', row_id: String(ended.person), method, required: true }, tx)
  })
  await closeSockets(session)
}

/** Start, switch and every ending of one session's View as happen one at a time, row or no row. */
async function lockSession(tx: TxSql, session: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`view_as:${session}`}, 0))`
}

/** End every View as whose time is up, each logged under its tester with the time it ended. */
async function endExpired(tx: TxSql) {
  // Kept, marked, so its own session is still told it ended; removed once nobody can come back for it.
  await tx`delete from view_as_session where ended_at < now() - interval '31 days'`
  for (const ended of await tx`update view_as_session set ended_at = now() where expires_at <= now() and ended_at is null returning tester, person, expires_at`)
    await logAccess(String(ended.tester), 'view_as_end', { table: 'Person', row_id: String(ended.person), method: 'expired',
      scope: `ended ${new Date(ended.expires_at as string).toISOString()}`, required: true }, tx)
}

const SWEEP_MS = 60_000
let lastSweep = 0
/**
 * Expired View as rows are ended and logged by any request to the instance, at
 * most once a minute per server, so an end is on the record even when the
 * tester never comes back.
 */
export async function sweepExpiredViewAs(now = false): Promise<void> {
  if (!now && Date.now() - lastSweep < SWEEP_MS) return
  lastSweep = Date.now()
  const [due] = await sql`select 1 from view_as_session where (expires_at <= now() and ended_at is null) or ended_at < now() - interval '31 days' limit 1`
  if (due) await sql.begin(endExpired)
}

/** The people the app describes, in the order asked; a name only where it can't. */
async function describe(tester: string, persons: string[]): Promise<ViewAsPerson[]> {
  if (!persons.length) return []
  const app = await testerApp(tester)
  const described = new Map<string, ViewAsPerson>()
  if (app) {
    const answer = await (await packages()).runGrant(app.app, 'read', app.people, { payload: { persons } }, tester).catch(() => null)
    for (const entry of peopleOf(answer)) described.set(entry.person, entry)
  }
  const out: ViewAsPerson[] = []
  for (const person of persons) {
    const entry = described.get(person) ?? { person, name: '' }
    out.push(entry.name ? entry : { ...entry, name: await nameOf(person) })
  }
  return out
}

/** The app's answer, kept to the shape the picker shows: never an email or anything else. */
function peopleOf(answer: unknown): ViewAsPerson[] {
  if (!Array.isArray(answer)) return []
  return answer.flatMap((entry) => {
    const e = entry as Record<string, unknown>
    if (typeof e?.person !== 'string' || typeof e.name !== 'string') return []
    return [{ person: e.person, name: e.name.trim(), code: typeof e.code === 'string' ? e.code : null,
      jobs: Array.isArray(e.jobs) ? e.jobs.filter((job): job is string => typeof job === 'string') : [] }]
  })
}

/** Keep only the people this tester may view, in order. */
async function viewableOnly(tester: string, people: ViewAsPerson[]): Promise<ViewAsPerson[]> {
  const kept: ViewAsPerson[] = []
  for (const entry of people) if (!(await unviewable(tester, entry.person))) kept.push(entry)
  return kept
}

/** People the tester may view whose name, code, or job and site match what was typed. */
export async function searchViewAs(user: SessionUser, q: unknown): Promise<ViewAsPerson[]> {
  await assertMayViewAs(user)
  const typed = typeof q === 'string' ? q.trim() : ''
  if (typed.length < 2) return []
  const app = (await testerApp(user.row_id))!
  const answer = peopleOf(await (await packages()).runGrant(app.app, 'read', app.people, { payload: { q: typed } }, user.row_id))
  // Someone the app doesn't list (not on its staff list, say) is still found by their name.
  const listed = new Set(answer.map((entry) => entry.person))
  const named = (await sql`select row_id from person
    where enabled and not built_in and full_name ilike ${`%${typed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}
    order by full_name, row_id limit ${SEARCH_LIMIT}`).map((r) => String(r.row_id)).filter((id) => !listed.has(id))
  const people = [...answer, ...(await describe(user.row_id, named))]
  return (await viewableOnly(user.row_id, people)).slice(0, SEARCH_LIMIT)
}

/** Whether this person may view as anyone, whom they are viewing as now, and their Recent and Frequently used. */
export async function viewAsState(user: SessionUser) {
  if (!(await mayViewAs(user))) return { may: false as const }
  const tester = user.row_id
  const [row] = await sql`select person, expires_at from view_as_session where session_id = ${user.sign_in!.session_id} and expires_at > now() and ended_at is null`
  const recentIds = (await sql`
    select reference_name as person from access_log
    where "user" = ${tester} and operation in ${sql(STARTED)} and ref_table = 'Person' and reference_name is not null
    group by reference_name order by max(created_at) desc limit ${RECENT * 2}`).map((r) => String(r.person))
  const frequentIds = (await sql`
    select reference_name as person from access_log
    where "user" = ${tester} and operation in ${sql(STARTED)} and ref_table = 'Person' and reference_name is not null
      and created_at > now() - make_interval(days => ${FREQUENT_DAYS})
    group by reference_name having count(*) >= 2
    order by count(*) desc, max(created_at) desc limit ${FREQUENT * 2}`).map((r) => String(r.person))
  const all = [...new Set([...(row ? [String(row.person)] : []), ...recentIds, ...frequentIds])]
  const described = new Map((await describe(tester, all)).map((entry) => [entry.person, entry]))
  const usable = async (ids: string[], cap: number) => (await viewableOnly(tester, ids.map((id) => described.get(id)!))).slice(0, cap)
  return {
    may: true as const,
    viewing: row ? { ...described.get(String(row.person))!, expires_at: new Date(row.expires_at as string).toISOString() } : null,
    recent: await usable(recentIds, RECENT),
    frequent: await usable(frequentIds, FREQUENT),
    minutes: VIEW_AS_MINUTES,
  }
}

/** Featherbase's reads that are sent as POST (a body too large for an address), and the record of an export, which is a read's own audit row. */
const READ_POSTS = new Set(['/api/access_request', '/api/access_log', '/api/dashboard/count', '/api/dashboard/chart', '/api/report_chart', '/api/run_script_report', '/api/row_titles', '/api/people/names', '/api/sales_target/embed_session'])

/**
 * How the middleware treats a request while viewing:
 * - `read`: a read, run as the person viewed;
 * - `drop`: the browser's recent-pages trail, accepted and not recorded;
 * - `tester`: everything else (the View as controls, any change), run as the tester themself.
 */
export function viewAsRoute(method: string, path: string): 'read' | 'drop' | 'tester' {
  if (path === '/api/view_as' || path.startsWith('/api/view_as/')) return 'tester'
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'read'
  if (method === 'POST' && (/^\/api\/app_reads\/[^/]+\/[^/]+$/.test(path) || READ_POSTS.has(path))) return 'read'
  if (method === 'POST' && path === '/api/events') return 'drop'
  return 'tester'
}
