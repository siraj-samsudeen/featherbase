// Canonical Featherbase pages and their compatibility roots are not runtime
// apps. Technical roots and Vite's development URLs are reserved too.
export const RESERVED_APP_ROOTS = [
  'featherbase', 'public', 'pg_catalog', 'information_schema',
  'api', 'assets', 'files', 'private', 'web', 'ws',
  'admin', 'login', 'form', 'portal', 'print', 'preview', 'oauth-callback',
  'reset-password', 'sales-target', 'src', 'node_modules',
] as const
export const APP_ROOT_PATTERN = `^/(?!(${RESERVED_APP_ROOTS.join('|')})(/|\\?|$))[a-z][a-z0-9_]{0,30}(/|\\?|$)`
export const LEGACY_HUMAN_ROOT_PATTERN = '^/(admin|login|form|portal|print|oauth-callback|reset-password|sales-target)(/|\\?|$)'
export function appHref(name: string): string { return `/${name}/` }

export const FEATHERBASE_ADMIN_DESTINATION = {
  label: 'Featherbase Admin',
  href: '/featherbase/admin',
} as const

// Interim until the app exists (design D8): Feather Dash is today's sales
// target report, a Featherbase page rather than an installed app. The server
// routes and names its address from this; the shared top bar names the page.
export const INTERIM_APPS: Record<string, { root: string; title: string; tabs?: readonly AppTab[] }> = {
  feather_dash: { root: '/featherbase/sales-target', title: 'Feather Dash' },
}

// #380 task 4.4: an app may declare the tabs its staff move between on a
// phone. The shared top bar draws them as a tab bar on a phone on that app's
// pages; an app that declares none gets none. An installed app declares them
// in its manifest (`tabs`, its own extension-point version); an interim app
// declares them above. The icons are a fixed set, named, so an app never
// ships its own artwork into the bar.
export const APP_TAB_ICONS = ['home', 'report', 'target', 'list', 'checklist', 'calendar', 'inbox', 'person'] as const
export type AppTabIcon = (typeof APP_TAB_ICONS)[number]
/** One tab as an app declares it: `path` is under the app's own root, '' for the root itself. */
export interface AppTab { label: string; icon: AppTabIcon; path: string }
/** One tab as the bar draws it. */
export interface AppTabLink { label: string; icon: AppTabIcon; href: string }
/** A tab's path: lower-case segments under the app's root, never a way out of it. */
export const APP_TAB_PATH = /^(?:[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*)?$/
export const APP_TAB_LABEL_MAX = 12
export function appTabLinks(root: string, tabs: readonly AppTab[]): AppTabLink[] {
  return tabs.map(({ label, icon, path }) => ({ label, icon, href: path ? `${root.replace(/\/$/, '')}/${path}` : root }))
}

// #642 (E4): the pages served with a frame policy of their own (the Sales
// Target report frames MotherDuck, until B9). The server sets the policy and
// the web app enters and leaves these pages by a full load; both match a path
// here, with or without one trailing slash, as the web router does.
const OWN_FRAME_POLICY_PAGES: readonly string[] = [INTERIM_APPS.feather_dash.root]

/** The page with its own frame policy that `path` shows, or null. */
export function ownFramePolicyPage(path: string): string | null {
  const bare = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  return OWN_FRAME_POLICY_PAGES.includes(bare) ? bare : null
}

// #489: the person's own account pages live outside the Admin screens, so
// every address serves them (an app's address keeps people out of Admin).
export const ACCOUNT_ROOT = '/featherbase/account'
export const ACCOUNT_SIGN_IN_METHODS_PATH = `${ACCOUNT_ROOT}/sign-in-methods`

// Static pages under /featherbase/admin (no Table behind them), one catalog
// for every reader: the router, the page headings, the recent-actions
// recorder and the server's activity feed (#440). `slug` is the first path
// segment; `title` is what a person sees.
// `manage`: only a System Manager can open the page; anyone else is sent to
// the Admin home, so their visit is never remembered as a recent (#476 rule).
export const ADMIN_STATIC_PAGES: readonly { slug: string; title: string; manage?: true }[] = [
  { slug: 'imports', title: 'Imports', manage: true },
  { slug: 'access-tokens', title: 'Access tokens' },
  { slug: 'find-person', title: 'Find a person by identifier' },
  { slug: 'explore', title: 'Explore' },
  { slug: 'glossary', title: 'Glossary' },
  { slug: 'waiting-for-access', title: 'Waiting for access', manage: true },
  { slug: 'instance-health', title: 'Instance health', manage: true },
]

/** Does this static admin page open only for a System Manager? */
export function adminPageNeedsManage(slug: string): boolean {
  return ADMIN_STATIC_PAGES.some((p) => p.slug === slug && p.manage === true)
}

/** Admin first segments that are real pages but not worth remembering
 *  (home, builders, browsers) — never logged as a Table's list. */
export const ADMIN_UNRECORDED_ROOTS = [
  'new-table', 'import', 'jobs', 'setup', 'all-tables', 'naming', 'permissions', 'home', 'source', 'map',
] as const

/** Admin first segments whose second segment names the page (`/dashboard/Sales`). */
export const ADMIN_NAMED_PAGE_KINDS: Record<string, string> = {
  'script-report': 'Report',
  dashboard: 'Dashboard',
}

/** The title of a static admin page, or undefined for any other slug. */
export function adminPageTitle(slug: string): string | undefined {
  return ADMIN_STATIC_PAGES.find((p) => p.slug === slug)?.title
}

/** The title when `path` is exactly a static admin page (any query, hash or
 *  trailing slash), else undefined. Read at render time, so entries recorded
 *  before the catalog existed (labelled with the slug) still read as titles. */
export function adminPathTitle(path: string | null | undefined): string | undefined {
  const m = /^\/featherbase\/admin\/([^/?#]+)\/?(?:[?#].*)?$/.exec(path ?? '')
  return m ? adminPageTitle(decodeURIComponent(m[1])) : undefined
}
