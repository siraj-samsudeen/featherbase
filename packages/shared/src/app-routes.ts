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

export const FEATHERBASE_HOME_DESTINATION = {
  label: 'Featherbase Home',
  href: '/featherbase/admin',
} as const

// Static pages under /featherbase/admin (no Table behind them), one catalog
// for every reader: the router, the page headings, the recent-actions
// recorder and the server's activity feed (#440). `slug` is the first path
// segment; `title` is what a person sees.
export const ADMIN_STATIC_PAGES = [
  { slug: 'imports', title: 'Imports' },
  { slug: 'access-tokens', title: 'Access tokens' },
  { slug: 'sign-in-methods', title: 'Sign-in methods' },
  { slug: 'find-person', title: 'Find a person by identifier' },
  { slug: 'explore', title: 'Cross-filter workspace' },
] as const

/** Admin first segments that are real pages but not worth remembering
 *  (home, builders, browsers, prototypes) — never logged as a Table's list. */
export const ADMIN_UNRECORDED_ROOTS = [
  'new-table', 'import', 'jobs', 'all-tables', 'naming', 'permissions', 'home', 'source', 'prototype', 'map',
] as const

/** Admin first segments whose second segment names the page (`/dashboard/Sales`). */
export const ADMIN_NAMED_PAGE_KINDS: Record<string, string> = {
  'query-report': 'Report',
  'script-report': 'Report',
  dashboard: 'Dashboard',
}

/** The title of a static admin page, or undefined for any other slug. */
export function adminPageTitle(slug: string): string | undefined {
  return ADMIN_STATIC_PAGES.find((p) => p.slug === slug)?.title
}
