// #488 (design D3): INSTANCE_ADDRESSES says what each web address of this
// instance opens, and which one emailed links use. It is the only place the
// server learns its own addresses.
//
//   [{ "address": "https://dash.example.com", "opens": "feather_dash", "emails": true },
//    { "address": "https://featherbase.example.com", "opens": "admin" }]
//
// Read at boot, before the database, so nothing here may touch it. The list is
// configuration: a request's Host header can only SELECT one of its entries,
// never add one, and every absolute URL the server builds comes from here.

import { APP_ROOT_PATTERN, RESERVED_APP_ROOTS, appHref } from 'shared'
import { DEV_ENVIRONMENTS } from './env'

/** What an address opens: the Admin screens, or one app by name. */
export const ADMIN = 'admin'

export interface InstanceAddress {
  /** The absolute origin, lowercased, no trailing slash (`https://dash.example.com`). */
  address: string
  /** The hostname alone, port stripped — what a request's Host is matched against. */
  host: string
  /** `admin`, or an app name. */
  opens: string
  /** The one address emailed links use. */
  emails: boolean
}

/** The environments where plain http, and an unset list, are allowed. */
export const RELAXED_ENVIRONMENTS = DEV_ENVIRONMENTS

// An app name, as an app root is spelled (shared/app-routes APP_ROOT_PATTERN).
const APP_NAME = /^[a-z][a-z0-9_]{0,30}$/

function refuse(reason: string): never {
  throw new Error(`INSTANCE_ADDRESSES: ${reason} (docs/DEPLOY.md, "Configuration").`)
}

/** Parses and validates the raw variable. Unset (or blank) is `null`; whether
 *  that is allowed is the caller's question. Throws, naming the rule, on
 *  anything else that is not a valid list. */
export function parseInstanceAddresses(raw: string | undefined, environment: string): InstanceAddress[] | null {
  if (!raw?.trim()) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    refuse('must be a JSON array of { address, opens, emails? } entries')
  }
  if (!Array.isArray(value)) refuse('must be a JSON array of { address, opens, emails? } entries')
  return validateInstanceAddresses(value.map(normalizeEntry), environment)
}

function normalizeEntry(entry: unknown): InstanceAddress {
  if (!entry || typeof entry !== 'object') refuse('each entry must be an object { address, opens, emails? }')
  const { address, opens, emails } = entry as Record<string, unknown>
  if (typeof address !== 'string') refuse('each entry needs an address')
  let url: URL
  try {
    url = new URL(address.trim())
  } catch {
    refuse(`"${address}" is not an absolute origin such as https://app.example.com`)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password
    || !/^https?:\/\/[^/]+\/?$/i.test(address.trim()))
    refuse(`"${address}" is not an absolute origin such as https://app.example.com (no path)`)
  return { address: url.origin, host: url.hostname, opens: typeof opens === 'string' ? opens : '', emails: emails === true }
}

/** The rules every list obeys. Also run by the release preflight against the
 *  environment the release will run as. */
export function validateInstanceAddresses(entries: InstanceAddress[], environment: string): InstanceAddress[] {
  const relaxed = RELAXED_ENVIRONMENTS.includes(environment)
  const hosts = new Set<string>()
  for (const entry of entries) {
    if (!relaxed && !entry.address.startsWith('https://'))
      refuse(`${entry.address} must use https on a "${environment}" server`)
    if (hosts.has(entry.host)) refuse(`the host ${entry.host} is listed more than once`)
    hosts.add(entry.host)
    if (entry.opens !== ADMIN && (!APP_NAME.test(entry.opens) || (RESERVED_APP_ROOTS as readonly string[]).includes(entry.opens)))
      refuse(`${entry.address} opens "${entry.opens}": opens must be "admin" or an app name`)
  }
  if (entries.filter((e) => e.emails).length !== 1) refuse('exactly one entry must be marked "emails": true')
  if (!entries.some((e) => e.opens === ADMIN)) refuse('at least one entry must open "admin"')
  return entries
}

/** A request's host as the list is matched against it: lowercased, port
 *  stripped. `requestUrl` is the URL the server was asked for, whose host is
 *  the request's Host header. */
export function requestHost(requestUrl: string): string {
  return new URL(requestUrl).hostname.toLowerCase()
}

/** The listed entry a host selects, if any. */
export function matchAddress(list: readonly InstanceAddress[] | null, host: string): InstanceAddress | undefined {
  return list?.find((entry) => entry.host === host)
}

/** The first entry that opens Admin: where an unlisted host's links point,
 *  and where a person who can use Admin is handed. */
export function adminAddress(list: readonly InstanceAddress[]): InstanceAddress {
  return list.find((entry) => entry.opens === ADMIN)!
}

/** The entry links built for this host use: its own, or for an unlisted host
 *  the Admin entry. A header can choose between listed origins, never add one. */
export function linkAddress(list: readonly InstanceAddress[], host: string): InstanceAddress {
  return matchAddress(list, host) ?? adminAddress(list)
}

/** The one entry emailed links use. */
export function emailsAddress(list: readonly InstanceAddress[]): InstanceAddress {
  return list.find((entry) => entry.emails)!
}

/** Where a development checkout's web app answers when nothing else says. */
export const DEV_WEB_ORIGIN = 'http://localhost:5173'

/** The origin an emailed link (an invitation, a password reset, the
 *  waiting-for-access alert) is built on: the entry marked for emails. With no
 *  list, a development or test server falls back to the request's origin when
 *  there is one, else to the dev web origin; anywhere else there is no origin,
 *  and the link is not sent. */
export function emailOrigin(list: readonly InstanceAddress[] | null, environment: string, requestOrigin?: string): string | null {
  return emailedLinkOrigin(list, environment, requestOrigin, (l) => emailsAddress(l))
}

/** The origin of an emailed link whose page is an Admin page (the
 *  waiting-for-access alert): the `admin` entry, since an app's address would
 *  redirect the page away. Same fallback as `emailOrigin` with no list. */
export function adminLinkOrigin(list: readonly InstanceAddress[] | null, environment: string): string | null {
  return emailedLinkOrigin(list, environment, undefined, (l) => adminAddress(l))
}

function emailedLinkOrigin(
  list: readonly InstanceAddress[] | null,
  environment: string,
  requestOrigin: string | undefined,
  pick: (list: readonly InstanceAddress[]) => InstanceAddress,
): string | null {
  if (list) return pick(list).address
  if (!RELAXED_ENVIRONMENTS.includes(environment)) return null
  return requestOrigin ?? DEV_WEB_ORIGIN
}

// Interim until the app exists (design D8): Feather Dash is today's sales
// target report, a Featherbase page rather than an installed app.
const INTERIM_APP_ROOTS: Record<string, string> = { feather_dash: '/featherbase/sales-target' }
const INTERIM_APP_TITLES: Record<string, string> = { feather_dash: 'Feather Dash' }

/** The title of an app that is not yet a package (design D8). */
export function interimAppTitle(app: string): string | undefined {
  return INTERIM_APP_TITLES[app]
}

/** Where an app's address keeps people: the app's own root. */
export function appRoot(app: string): string {
  return INTERIM_APP_ROOTS[app] ?? appHref(app)
}

// The Featherbase pages an app's address still serves: signing in, resetting a
// password, the OAuth hand-back, and the runtime shell's assets.
const SERVED_EVERYWHERE = [
  '/featherbase/login',
  '/featherbase/reset-password',
  '/featherbase/oauth-callback',
  '/featherbase/runtime-shell.css',
  '/featherbase/runtime-shell.js',
]

const under = (path: string, root: string) => {
  const bare = root.replace(/\/$/, '')
  return path === bare || path.startsWith(`${bare}/`)
}
const appRootPattern = new RegExp(APP_ROOT_PATTERN)

/** On an address that opens an app, where a GET of `path` is sent instead,
 *  or null when it is served as it is. */
export function addressRedirect(entry: InstanceAddress, path: string): string | null {
  const root = appRoot(entry.opens)
  if (path === '/') return root
  if (under(path, root) || SERVED_EVERYWHERE.some((page) => under(path, page))) return null
  if (under(path, '/featherbase') || appRootPattern.test(path)) return root
  return null
}
