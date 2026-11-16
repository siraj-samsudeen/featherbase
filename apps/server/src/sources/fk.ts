// The key a foreign-key edge is filed under: owning schema, table and column.
export function fkKey(schema: string, table: string, column: string): string {
  return `${schema}\u0000${table}\u0000${column}`
}
