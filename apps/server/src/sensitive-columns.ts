// API-005/API-008: credential columns are never serialized, selectable,
// filterable or writable through the generic APIs — regardless of where the
// row lives. One definition, shared by the native query/document paths and
// the bound-source path (PR #103 review finding 2: reflected foreign columns
// with these names must get the same treatment as native ones).
export const SENSITIVE_COLUMNS = new Set([
  'password_hash',
  // #131 dropped the native api_key/api_secret_hash columns, but a bound
  // foreign source may still expose columns with these names — keep them
  // (and token_hash) blocked.
  'api_secret_hash',
  'api_key',
  'token_hash',
  'new_password',
])

export function isSensitiveColumn(name: string): boolean {
  return SENSITIVE_COLUMNS.has(name)
}
