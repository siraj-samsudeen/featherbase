// The one rule for a column name the platform turns into DDL, and the one way
// to put any identifier into a SQL string. Interpolating a name without both
// lets a crafted name end the statement and run its own.
export const COLUMN_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/

export function isColumnName(name: unknown): name is string {
  return typeof name === 'string' && COLUMN_NAME_RE.test(name)
}

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}
