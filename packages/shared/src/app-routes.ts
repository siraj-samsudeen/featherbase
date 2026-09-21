// Canonical Featherbase pages and their compatibility roots are not runtime
// apps. Technical roots and Vite's development URLs are reserved too.
// @spec app_owns_client_root
export const RESERVED_APP_ROOTS = [
  'featherbase', 'public', 'pg_catalog', 'information_schema',
  'api', 'assets', 'files', 'private', 'web', 'ws',
  'admin', 'login', 'form', 'portal', 'print', 'preview', 'oauth-callback',
  'reset-password', 'sales-target', 'src', 'node_modules',
] as const
export const APP_ROOT_PATTERN = `^/(?!(${RESERVED_APP_ROOTS.join('|')})(/|\\?|$))[a-z][a-z0-9_]{0,30}(/|\\?|$)`
export const LEGACY_HUMAN_ROOT_PATTERN = '^/(admin|login|form|portal|print|oauth-callback|reset-password|sales-target)(/|\\?|$)'
export function appHref(name: string): string { return `/${name}/` }
