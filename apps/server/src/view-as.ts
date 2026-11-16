// #1222: View as. A tester sees what another person sees, read-only, without
// their password. An app declares who may (`viewAs.role`, one of its own
// roles) and how its people are found and described (`viewAs.people`, one of
// its reads). The platform keeps the state, swaps the person for reads, and
// refuses every write (index.ts, permissions.ts, runtime-actions.ts).
//
// The state is one view_as_session row per signed-in session, keyed by the
// token's jti: it ends with the session, at Exit, after VIEW_AS_MINUTES, or
// as soon as the tester no longer holds the role or the person can no longer
// be viewed. Every start, switch and end is an Access Log row under the
// tester naming the person; Recent and Frequently used are read from them.
import { sql } from './db'
import { AppError } from './errors'
import { logAccess } from './audit'
import { getRoles, isPrivileged } from './permissions'
import { runGrant, viewAsApps } from './runtime-packages'
import type { SessionUser } from './auth'
import type { ViewingAs } from './view-as-context'

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

/** The View as app this tester may use: the first, by app name, whose role they hold. */
async function testerApp(tester: string) {
  const roles = new Set(await getRoles(tester))
  return viewAsApps().sort((a, b) => a.app.localeCompare(b.app)).find((entry) => roles.has(entry.role)) ?? null
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
export async function activeViewAs(user: SessionUser): Promise<{ as: ViewingAs; user: SessionUser } | null> {
  const session = user.sign_in?.session_id
  if (!session || user.kind !== 'person') return null
  const [row] = await sql`select tester, person from view_as_session where session_id = ${session} and expires_at > now()`
  if (!row) return null
  const person = String(row.person)
  if (String(row.tester) !== user.row_id || !(await testerApp(user.row_id)) || (await unviewable(user.row_id, person))) {
    await endViewAs(user, 'no_longer_allowed')
    return null
  }
  const [viewed] = await sql`select row_id, email, full_name from person where row_id = ${person}`
  const name = await nameOf(person)
  return {
    as: { tester: user.row_id, person, name },
    // The tester's sign-in claims stay: they are this session's, and sign-out ends it.
    user: { row_id: person, kind: 'person', email: (viewed.email as string | null) ?? null, full_name: (viewed.full_name as string | null) ?? null, sign_in: user.sign_in },
  }
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
    await tx`delete from view_as_session where expires_at < now()`
    const [before] = await tx`select person from view_as_session where session_id = ${session}`
    await tx`insert into view_as_session (session_id, tester, person, expires_at)
      values (${session}, ${user.row_id}, ${person}, ${new Date(ends)})
      on conflict (session_id) do update set tester = excluded.tester, person = excluded.person, started_at = now(), expires_at = excluded.expires_at`
    await logAccess(user.row_id, before ? 'view_as_switch' : 'view_as_start', { table: 'Person', row_id: person, method: 'view_as', required: true }, tx)
  })
}

/** Stop viewing as anyone; a no-op when not viewing. */
export async function endViewAs(user: SessionUser, method = 'exit'): Promise<void> {
  const session = user.sign_in?.session_id
  if (!session) return
  await sql.begin(async (tx) => {
    const [ended] = await tx`delete from view_as_session where session_id = ${session} returning person`
    if (ended) await logAccess(user.row_id, 'view_as_end', { table: 'Person', row_id: String(ended.person), method, required: true }, tx)
  })
}

/** The people the app describes, in the order asked; a name only where it can't. */
async function describe(tester: string, persons: string[]): Promise<ViewAsPerson[]> {
  if (!persons.length) return []
  const app = await testerApp(tester)
  const described = new Map<string, ViewAsPerson>()
  if (app) {
    const answer = await runGrant(app.app, 'read', app.people, { payload: { persons } }, tester).catch(() => null)
    for (const entry of peopleOf(answer)) described.set(entry.person, entry)
  }
  const out: ViewAsPerson[] = []
  for (const person of persons) out.push(described.get(person) ?? { person, name: await nameOf(person) })
  return out
}

/** The app's answer, kept to the shape the picker shows: never an email or anything else. */
function peopleOf(answer: unknown): ViewAsPerson[] {
  if (!Array.isArray(answer)) return []
  return answer.flatMap((entry) => {
    const e = entry as Record<string, unknown>
    if (typeof e?.person !== 'string' || typeof e.name !== 'string') return []
    return [{ person: e.person, name: e.name, code: typeof e.code === 'string' ? e.code : null,
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
  const answer = peopleOf(await runGrant(app.app, 'read', app.people, { payload: { q: typed } }, user.row_id))
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
  const [row] = await sql`select person, expires_at from view_as_session where session_id = ${user.sign_in!.session_id} and expires_at > now()`
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

/**
 * How the middleware treats a request while viewing:
 * - `own`: the tester's own View as controls, run as the tester;
 * - `read`: a read, run as the person viewed;
 * - `drop`: the browser's recent-pages trail, accepted and not recorded;
 * - `refuse`: everything else.
 */
export function viewAsRoute(method: string, path: string): 'own' | 'read' | 'drop' | 'refuse' {
  if (path === '/api/view_as' || path.startsWith('/api/view_as/')) return 'own'
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'read'
  if (method === 'POST' && /^\/api\/app_reads\/[^/]+\/[^/]+$/.test(path)) return 'read'
  if (method === 'POST' && path === '/api/events') return 'drop'
  return 'refuse'
}
