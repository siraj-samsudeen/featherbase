// Shared FK-edge grouping for driver introspection. Both SQL drivers read
// information_schema.key_column_usage rows in the same alias shape; this
// folds them into per-column single-column edges. A composite FK (two rows
// under one constraint) is dropped — a Reference holds ONE value, so only a
// single-column FK can ever become one. A column under two constraints keeps
// the first (deterministic via the driver's ORDER BY).

export interface FkEdge {
  schema: string
  table: string
  column: string
}

export interface FkRow {
  constraint_schema?: unknown
  constraint_name?: unknown
  table_schema?: unknown
  table_name?: unknown
  column_name?: unknown
  referenced_table_schema?: unknown
  referenced_table_name?: unknown
  referenced_column_name?: unknown
}

export function fkKey(schema: string, table: string, column: string): string {
  return `${schema}\u0000${table}\u0000${column}`
}

// → Map of fkKey(owning schema, table, column) → referenced edge.
export function singleColumnFks(rows: FkRow[]): Map<string, FkEdge> {
  const byConstraint = new Map<string, FkRow[]>()
  for (const r of rows) {
    const ck = `${r.constraint_schema}\u0000${r.table_schema}\u0000${r.table_name}\u0000${r.constraint_name}`
    const list = byConstraint.get(ck) ?? []
    list.push(r)
    byConstraint.set(ck, list)
  }
  const edges = new Map<string, FkEdge>()
  for (const list of byConstraint.values()) {
    if (list.length !== 1) continue // composite FK — not Reference-shaped
    const r = list[0]
    const key = fkKey(String(r.table_schema), String(r.table_name), String(r.column_name))
    if (edges.has(key)) continue
    edges.set(key, {
      schema: String(r.referenced_table_schema),
      table: String(r.referenced_table_name),
      column: String(r.referenced_column_name),
    })
  }
  return edges
}
