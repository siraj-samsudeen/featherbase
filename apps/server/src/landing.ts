// #488 (design D3): where a person lands after any sign-in — password,
// delegated, sign-up or Google. It replaced a single role check that sent
// report viewers to the report. A person lands where they can do something:
//
//   1. on an app's address, a person who can open that app stays;
//   2. else, a person who can use Admin is handed to the Admin address;
//   3. on the Admin address, a person who cannot use Admin but can open an app
//      that has an address is handed to that address;
//   4. else, the no-access page (on an app's address: the app's own refusal).
//
// "Handed" means the browser-bound round trip in oauth.ts: a one-minute
// ticket sends the browser to the target's /api/handoff/start, which sets its
// nonce cookie and sends it back to the source's /api/handoff/bind, which
// mints the code redeemed at the target's /featherbase/oauth-callback.
import type { SessionUser } from './auth'
import { config } from './config'
import { ADMIN, adminAddress, appRoot, matchAddress, type InstanceAddress } from './instance-addresses'
import { mintHandoffTicket } from './oauth'
import { getRoles, tableAccessFor } from './permissions'
import { appCatalog } from './runtime-packages'
import { VIEWER_ROLE } from './sales-target'

/** What a sign-in answer carries besides the session: a path on this address
 *  to open (`landing`), or a URL on another address to go to (`handoff`).
 *  Neither means the Admin, which shows the no-access page to someone who
 *  cannot use it. */
export interface Landing {
  landing?: string
  handoff?: string
}

/** Can this person use Admin at all: manage it, or reach some Table in it.
 *  The same facts /api/whoami's capabilities draw the shell from. */
export async function canUseAdmin(person: string): Promise<boolean> {
  const roles = await getRoles(person)
  if (person === 'Administrator' || roles.includes('System Manager')) return true
  return (await tableAccessFor(person, roles)).any
}

/** Can this person open the app an address opens. Feather Dash's interim
 *  gate is today's report gate (design D8); an installed app is open to
 *  whoever its catalog lists. */
export async function canOpenApp(person: string, app: string): Promise<boolean> {
  if (app === 'feather_dash') return (await getRoles(person)).includes(VIEWER_ROLE)
  return (await appCatalog(person)).some((entry) => entry.name === app)
}

function handTo(session: SignedInSession, here: InstanceAddress, target: InstanceAddress): Landing {
  const ticket = mintHandoffTicket(session.token, here.host, target.host)
  return { handoff: `${target.address}/api/handoff/start?ticket=${encodeURIComponent(ticket)}` }
}

/** The session a sign-in just issued on this address. */
export interface SignedInSession {
  token: string
  user: SessionUser
}

/** The landing for `session`, just signed in on `host`. `handOff: false` is
 *  for a session that was itself just handed over: it stays where it is,
 *  so two addresses can never pass a person back and forth. */
export async function landingAfterSignIn(session: SignedInSession, host: string, { handOff = true } = {}): Promise<Landing> {
  const list = config.instanceAddresses
  const here = matchAddress(list, host)
  const person = session.user.row_id

  // An app's address.
  if (here && here.opens !== ADMIN) {
    if (await canOpenApp(person, here.opens)) return { landing: appRoot(here.opens) }
    if (handOff && list && (await canUseAdmin(person))) return handTo(session, here, adminAddress(list))
    return { landing: appRoot(here.opens) }
  }

  if (await canUseAdmin(person)) return {}

  // The Admin address: an app that has an address, in the list's order.
  if (here && list && handOff)
    for (const entry of list)
      if (entry.opens !== ADMIN && (await canOpenApp(person, entry.opens))) return handTo(session, here, entry)

  // No list (development and test), or a host the list does not name: that
  // host is served as one address holding everything, as before #488, so a
  // report viewer opens the report right here.
  if (!here && (await canOpenApp(person, 'feather_dash'))) return { landing: appRoot('feather_dash') }
  return {}
}

const ADMIN_ROOT = '/featherbase/admin'

/** #489: "Open Admin" in the shared top bar. On an app's address, a hand-off
 *  to the Admin address (the same one-time code a sign-in uses), so the person
 *  arrives signed in there. Where this host is itself the Admin (the Admin
 *  address, an unlisted host, or no list at all), the Admin's own path. Null
 *  for a person who cannot use Admin. */
export async function openAdminFor(user: SessionUser, host: string): Promise<Landing | null> {
  if (!(await canUseAdmin(user.row_id))) return null
  const list = config.instanceAddresses
  const here = matchAddress(list, host)
  if (list && here && here.opens !== ADMIN) return handTo(user, adminAddress(list))
  return { landing: ADMIN_ROOT }
}
