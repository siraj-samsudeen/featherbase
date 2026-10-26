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
// "Handed" means a one-time, one-minute code for the target address
// (oauth.ts mintAddressHandoffCode), redeemed at its /featherbase/oauth-callback.
import type { SessionUser } from './auth'
import { config } from './config'
import { ADMIN, adminAddress, appRoot, matchAddress, type InstanceAddress } from './instance-addresses'
import { mintAddressHandoffCode } from './oauth'
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

function handTo(user: SessionUser, target: InstanceAddress): Landing {
  const code = mintAddressHandoffCode(user, target.host)
  return { handoff: `${target.address}/featherbase/oauth-callback?code=${encodeURIComponent(code)}` }
}

/** The landing for `user`, who just signed in on `host`. `handOff: false` is
 *  for a session that was itself just handed over: it stays where it is,
 *  so two addresses can never pass a person back and forth. */
export async function landingAfterSignIn(user: SessionUser, host: string, { handOff = true } = {}): Promise<Landing> {
  const list = config.instanceAddresses
  const here = matchAddress(list, host)
  const person = user.row_id

  // An app's address.
  if (here && here.opens !== ADMIN) {
    if (await canOpenApp(person, here.opens)) return { landing: appRoot(here.opens) }
    if (handOff && list && (await canUseAdmin(person))) return handTo(user, adminAddress(list))
    return { landing: appRoot(here.opens) }
  }

  if (await canUseAdmin(person)) return {}

  // The Admin address: an app that has an address, in the list's order.
  if (here && list && handOff)
    for (const entry of list)
      if (entry.opens !== ADMIN && (await canOpenApp(person, entry.opens))) return handTo(user, entry)

  // No list (development and test), or a host the list does not name: that
  // host is served as one address holding everything, as before #488, so a
  // report viewer opens the report right here.
  if (!here && (await canOpenApp(person, 'feather_dash'))) return { landing: appRoot('feather_dash') }
  return {}
}
