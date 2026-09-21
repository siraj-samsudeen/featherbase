// The legacy human roots remain reserved until platform screens converge
// under /featherbase. Technical roots and Vite's development URLs are not apps.
export const RESERVED_APP_ROOTS = [
  'featherbase', 'public', 'pg_catalog', 'information_schema',
  'api', 'assets', 'files', 'private', 'web', 'ws',
  'admin', 'login', 'form', 'portal', 'print', 'preview', 'oauth-callback',
  'reset-password', 'sales-target', 'src', 'node_modules',
] as const
export const APP_ROOT_PATTERN = `^/(?!(${RESERVED_APP_ROOTS.join('|')})(/|$))[a-z][a-z0-9_]{0,30}(/|$)`
export function appHref(name: string): string { return `/${name}/` }
