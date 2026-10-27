// The jsonb ledger columns (tables/roles/perms) round-trip as arrays, but
// tolerate a stored JSON string too (defensive against double-encoding).
export function asNameList(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[]
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? (parsed as string[]) : []
    } catch {
      return []
    }
  }
  return []
}
