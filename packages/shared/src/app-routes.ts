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
export const INTERIM_APPS: Record<string, { root: string; title: string }> = {
  feather_dash: { root: '/featherbase/sales-target', title: 'Feather Dash' },
}

// #489: the person's own account pages live outside the Admin screens, so
// every address serves them (an app's address keeps people out of Admin).
export const ACCOUNT_ROOT = '/featherbase/account'
export const ACCOUNT_SIGN_IN_METHODS_PATH = `${ACCOUNT_ROOT}/sign-in-methods`

// Static pages under /featherbase/admin (no Table behind them), one catalog
// for every reader: the router, the page headings, the recent-actions
// recorder and the server's activity feed (#440). `slug` is the first path
// segment; `title` is what a person sees.
export const ADMIN_STATIC_PAGES = [
  { slug: 'imports', title: 'Imports' },
  { slug: 'access-tokens', title: 'Access tokens' },
  { slug: 'find-person', title: 'Find a person by identifier' },
  { slug: 'explore', title: 'Explore' },
  { slug: 'waiting-for-access', title: 'Waiting for access' },
] as const

/** Admin first segments that are real pages but not worth remembering
 *  (home, builders, browsers, prototypes) — never logged as a Table's list. */
export const ADMIN_UNRECORDED_ROOTS = [
  'new-table', 'import', 'jobs', 'all-tables', 'naming', 'permissions', 'home', 'source', 'prototype', 'map',
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
