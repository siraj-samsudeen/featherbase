// Spec 0007, BUD-R15 in the Admin: a decision may address a SCOPE — declared
// key columns mapped to values, where an absent or null dimension means
// "all". The engine stores that shape and never expands it, so the surface
// is the only place a human ever sees what a scope reaches. These two
// functions are that reading, shared by the composer (which builds a scope)
// and the ledger (which reads one back), so the two can never disagree.

/**
 * A scope arrives from the server as its JSON image (JSON columns round-trip
 * as text) or, straight from a form, as a plain object. Either way this
 * yields an object — never a throw, because a ledger row must still render
 * when its scope is unreadable.
 */
export function parseScope(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

/**
 * BUD-R15's "absent means all", said out loud. Every declared dimension is
 * named — the ones the decision pinned with their value, the ones it left
 * open as `all` — because a dimension silently missing from the rendering is
 * exactly the ambiguity the rule exists to remove. Declaration order, so two
 * scopes of one book always read in the same order.
 */
export function formatScope(raw: unknown, keyColumns: string[]): string {
  const scope = parseScope(raw)
  const cols = keyColumns.length ? keyColumns : Object.keys(scope)
  if (!cols.length) return 'all'
  return cols
    .map((c) => {
      const v = scope[c]
      return `${c}: ${v == null || v === '' ? 'all' : String(v)}`
    })
    .join(' · ')
}
