// API-005/API-008: credential columns are never serialized, selectable,
// filterable or writable through the generic APIs — regardless of where the
// row lives. One definition, shared by the native query/document paths and
// the bound-source path (PR #103 review finding 2: reflected foreign columns
// with these names must get the same treatment as native ones).
export const SENSITIVE_COLUMNS = new Set([
  'password_hash',
  'api_secret_hash',
  'api_key',
  'new_password',
])

export function isSensitiveColumn(name: string): boolean {
  return SENSITIVE_COLUMNS.has(name)
}
