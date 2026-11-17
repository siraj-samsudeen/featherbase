// #1255: several signed-in accounts on one browser, one click apart
// (OpenSpec change `account-switcher`, Siraj's pick A with S1).
//
// The browser's accounts ride a second httpOnly cookie, `sid_accounts`, whose
// Path is /api/accounts: page scripts never read it and no other route
// receives it (D1). Each entry is an ordinary session token, so every check a
// request makes (resolveToken) applies to a held account unchanged. The list
// includes the active account; the active one is `sid` (D2).
import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { sql } from './db'
import { AppError } from './errors'
import { logAccess } from './audit'
import { checkSession, revokeSession, sessionClaims, type SessionClaims, type SessionEnd, type SessionUser } from './auth'
import { externalOrigin, setSidCookie } from './session-cookies'
import { closeSessionSockets } from './realtime'
import { endViewAsSession } from './view-as'

export const ACCOUNTS_COOKIE = 'sid_accounts'
export const ACCOUNTS_PATH = '/api/accounts'
/** The active account plus four held (D5). Five tokens keep the cookie well under 4 KB. */
export const MAX_ACCOUNTS = 5

interface Entry {
  token: string
  /** Seconds since the epoch this account was last the active one. */
  usedAt: number
}

/** What a correctly signed token names. Expiry is not checked: an expired
 *  account is still listed, as signed out. */
type Named = SessionClaims
const named = sessionClaims

const now = () => Math.floor(Date.now() / 1000)

// `usedAt!token~usedAt!token`: `!` and `~` are never in a token and survive
// the cookie's encoding unescaped.
function parse(raw: string | undefined): Entry[] {
  if (!raw) return []
  return raw.split('~').slice(0, MAX_ACCOUNTS * 2).flatMap((part) => {
    const at = part.indexOf('!')
    const usedAt = Number(part.slice(0, at))
    const token = part.slice(at + 1)
    return at > 0 && Number.isFinite(usedAt) && token ? [{ token, usedAt }] : []
  })
}

/** A browser's accounts as the request carries them: each correctly signed
 *  entry once per person (the most recently used wins), the forged dropped. */
interface Held extends Entry, Named {}
async function held(c: Context): Promise<Held[]> {
  const out = new Map<string, Held>()
  for (const entry of parse(getCookie(c, ACCOUNTS_COOKIE))) {
    const n = await named(entry.token)
    if (!n) continue
    const before = out.get(n.person)
    if (!before || before.usedAt < entry.usedAt) out.set(n.person, { ...entry, ...n })
  }
  return [...out.values()]
}

function write(c: Context, accounts: Held[]) {
  const secure = externalOrigin(c).protocol === 'https:'
  if (!accounts.length) {
    deleteCookie(c, ACCOUNTS_COOKIE, { path: ACCOUNTS_PATH, secure })
    return
  }
  // The cookie lives as long as its longest-lived session.
  const maxAge = Math.max(60, Math.max(...accounts.map((a) => a.exp)) - now())
  setCookie(c, ACCOUNTS_COOKIE, accounts.map((a) => `${a.usedAt}!${a.token}`).join('~'), {
    httpOnly: true, sameSite: 'Lax', path: ACCOUNTS_PATH, maxAge, secure,
  })
}

function clearSid(c: Context) {
  deleteCookie(c, 'sid', { path: '/', secure: externalOrigin(c).protocol === 'https:' })
}

/** End one session as sign-out does (#411, #1222): its sockets, the sign-out
 *  list, and any View as on it. False when the record could not be written. */
async function endSession(n: Named, method: string): Promise<boolean> {
  closeSessionSockets(n.jti)
  let complete = true
  try {
    await revokeSession({ jti: n.jti, person: n.person, expiresAt: n.exp })
  } catch (err) {
    console.error('account switcher: revoking a session failed', err)
    complete = false
  }
  try {
    await endViewAsSession(n.jti, method)
  } catch (err) {
    console.error('account switcher: ending View as failed', err)
    complete = false
  }
  return complete
}

type State = { live: true; user: SessionUser } | { live: false; reason: SessionEnd }
async function stateOf(token: string): Promise<State> {
  const checked = await checkSession(token)
  return 'ended' in checked ? { live: false, reason: checked.ended } : { live: true, user: checked.user }
}

/** The browser's list with the active `sid` joined to it (D2): an account seen
 *  for the first time is recorded beside each live one already held (D7).
 *  A full list makes room by dropping ended accounts first, then the least
 *  recently used (D5); a dropped session is not ended. */
async function register(c: Context): Promise<{ accounts: Held[]; active: Held | null; states: Map<string, State> }> {
  let accounts = await held(c)
  const states = new Map<string, State>()
  for (const a of accounts) states.set(a.jti, await stateOf(a.token))
  const sid = getCookie(c, 'sid')
  const named_ = sid ? await named(sid) : null
  let active: Held | null = null
  if (sid && named_) {
    const known = accounts.find((a) => a.jti === named_.jti)
    if (known) active = known
    else {
      const state = await stateOf(sid)
      if (state.live) {
        const others = accounts.filter((a) => a.person !== named_.person)
        const alongside = others.filter((a) => states.get(a.jti)?.live)
        active = { token: sid, usedAt: now(), ...named_ }
        states.set(active.jti, state)
        const room = [...others].sort((x, y) =>
          Number(states.get(y.jti)?.live) - Number(states.get(x.jti)?.live) || y.usedAt - x.usedAt)
        accounts = [active, ...room.slice(0, MAX_ACCOUNTS - 1)]
        for (const other of alongside)
          await logAccess(named_.person, 'account_added', { table: 'Person', row_id: other.person, method: 'same_browser', required: true })
        write(c, accounts)
      }
    }
  }
  return { accounts, active, states }
}

const REASON_TEXT: Record<SessionEnd, string> = {
  invalid: 'Signed out',
  expired: 'Signed out: the session ran out',
  signed_out: 'Signed out',
  turned_off: 'Signed out: the account was turned off',
  sessions_ended: 'Signed out: an administrator ended its sessions',
  method_ended: 'Signed out: that way of signing in was ended',
}

/** What the page shows: name, how they signed in, and the ID to fill in when
 *  they sign in again. Never a token. */
async function describe(accounts: Held[], active: Held | null, states: Map<string, State>) {
  if (!accounts.length) return { accounts: [], full: false }
  const people = new Map((await sql`
    select row_id, full_name, email, username from person where row_id = any(${accounts.map((a) => a.person)})`).map((p) => [String(p.row_id), p]))
  const methods = new Map((await sql`
    select row_id, kind, label from sign_in_method where row_id = any(${accounts.flatMap((a) => (a.method ? [a.method] : []))})`).map((m) => [String(m.row_id), m]))
  const identities = new Map((await sql`
    select id, subject, email from sign_in_identity where id = any(${accounts.flatMap((a) => (a.identity ? [a.identity] : []))})`).map((i) => [String(i.id), i]))
  const rows = [...accounts].sort((x, y) => Number(y.jti === active?.jti) - Number(x.jti === active?.jti) || y.usedAt - x.usedAt).map((a) => {
    const p = people.get(a.person)
    const m = a.method ? methods.get(a.method) : undefined
    const i = a.identity ? identities.get(a.identity) : undefined
    const kind = (m?.kind as string | undefined) ?? null
    // The ID they would type: a connected service's ID, else the address or username.
    const id = (kind === 'delegated' ? (i?.subject as string | undefined) : undefined)
      ?? (i?.email as string | undefined) ?? (p?.email as string | undefined) ?? (p?.username as string | undefined) ?? null
    const state = states.get(a.jti)
    return {
      session: a.jti,
      person: a.person,
      name: (p?.full_name as string | null | undefined) ?? (p?.username as string | null | undefined) ?? null,
      method: a.method,
      method_kind: kind,
      method_label: (m?.label as string | undefined) ?? null,
      sign_in_id: id,
      last_used: a.usedAt,
      active: a.jti === active?.jti,
      state: state?.live ? 'live' : 'ended',
      ...(state && !state.live ? { reason: state.reason, reason_text: REASON_TEXT[state.reason] } : {}),
    }
  })
  return { accounts: rows, full: [...states.values()].filter((s) => s.live).length >= MAX_ACCOUNTS }
}

type Landing = (c: Context, session: { token: string; user: SessionUser }) => Promise<object>

const sessionIn = async (c: Context) => {
  const body = (await c.req.json().catch(() => null)) as { session?: unknown } | null
  return typeof body?.session === 'string' ? body.session : ''
}

/** The switcher's routes. Public: they read only the browser's own cookies,
 *  never the request's session or a viewed person (D8). */
export function accountRoutes(withLanding: Landing) {
  const routes = new Hono()
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })

  // The browser's accounts, the active one joined if it is new.
  routes.post('/', async (c) => {
    const { accounts, active, states } = await register(c)
    return c.json(await describe(accounts, active, states))
  })

  // D3: continue as a held account. The browser only chooses among what it holds.
  routes.post('/switch', async (c) => {
    const session = await sessionIn(c)
    const { accounts, active } = await register(c)
    const target = accounts.find((a) => a.jti === session)
    if (!target) throw new AppError('NotFoundError', 'That account is not signed in on this browser')
    const state = await stateOf(target.token)
    if (!state.live) throw new AppError('AuthenticationError', REASON_TEXT[state.reason])
    if (active && active.jti !== target.jti) await endViewAsSession(active.jti, 'account_switch')
    target.usedAt = now()
    write(c, accounts)
    setSidCookie(c, target.token, Math.max(1, target.exp - now()))
    if (active?.jti !== target.jti)
      await logAccess(target.person, 'account_switch', { table: 'Person', row_id: active?.person, method: 'account_switch', required: true })
    return c.json(await withLanding(c, { token: target.token, user: state.user }))
  })

  // D6: sign out of this account; continue as the most recently used live one.
  routes.post('/sign_out', async (c) => {
    const { accounts, active } = await register(c)
    const sid = getCookie(c, 'sid')
    const leaving = active ?? (sid ? await named(sid) : null)
    const ends = new Map<string, Named>()
    if (leaving) ends.set(leaving.jti, leaving)
    // The page's own copy of the session, when it names another one (as /api/logout).
    const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
    const fromHeader = bearer ? await named(bearer) : null
    if (fromHeader) ends.set(fromHeader.jti, fromHeader)
    let complete = true
    for (const n of ends.values()) complete = (await endSession(n, 'sign_out')) && complete
    const rest = accounts.filter((a) => !ends.has(a.jti)).sort((x, y) => y.usedAt - x.usedAt)
    clearSid(c)
    let next: { held: Held; user: SessionUser } | null = null
    for (const a of rest) {
      const s = await stateOf(a.token)
      if (s.live) { next = { held: a, user: s.user }; break }
    }
    if (next) next.held.usedAt = now()
    write(c, rest)
    if (!complete)
      return c.json({ error: { type: 'ServiceUnavailableError', message: 'Sign-out did not complete. Try again.' } }, 503)
    if (!next) return c.json({ signed_out: true })
    setSidCookie(c, next.held.token, Math.max(1, next.held.exp - now()))
    await logAccess(next.held.person, 'account_switch', { table: 'Person', row_id: leaving?.person, method: 'sign_out', required: true })
    return c.json(await withLanding(c, { token: next.held.token, user: next.user }))
  })

  // D6: sign out of every account this browser holds.
  routes.post('/sign_out_all', async (c) => {
    const accounts = await held(c)
    const ends = new Map<string, Named>(accounts.map((a) => [a.jti, a]))
    for (const token of [getCookie(c, 'sid'), c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]]) {
      const n = token ? await named(token) : null
      if (n) ends.set(n.jti, n)
    }
    let complete = true
    for (const n of ends.values()) complete = (await endSession(n, 'sign_out')) && complete
    clearSid(c)
    write(c, [])
    if (!complete)
      return c.json({ error: { type: 'ServiceUnavailableError', message: 'Sign-out did not complete. Try again.' } }, 503)
    return c.json({ signed_out: true })
  })

  // Take an account off this browser, ending its session.
  routes.post('/remove', async (c) => {
    const session = await sessionIn(c)
    const { accounts, active } = await register(c)
    const target = accounts.find((a) => a.jti === session)
    if (!target) throw new AppError('NotFoundError', 'That account is not signed in on this browser')
    if (!(await endSession(target, 'sign_out')))
      return c.json({ error: { type: 'ServiceUnavailableError', message: 'Removing the account did not complete. Try again.' } }, 503)
    const rest = accounts.filter((a) => a.jti !== target.jti)
    write(c, rest)
    if (active?.jti === target.jti) clearSid(c)
    const states = new Map<string, State>()
    for (const a of rest) states.set(a.jti, await stateOf(a.token))
    return c.json(await describe(rest, active?.jti === target.jti ? null : active, states))
  })

  return routes
}
