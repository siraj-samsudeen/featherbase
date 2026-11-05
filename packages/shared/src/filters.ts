// The list page's `filters` search param is user input (a typed or pasted
// URL): valid JSON is not enough. Only an array of [field, op, value] triples
// is a filter; anything else is discarded and the list shows unfiltered.
// One parser for the list page (web) and the activity feed (server), so the
// feed says "filtered" exactly when the list did (#440).
export type ListFilter = [string, string, unknown]

// The relationship filter: the one operator whose value is an object, and how
// deep it may nest. The server enforces these; the web path accepts the same.
export const RELATED_OPS = ['related', 'not related'] as const
export const MAX_RELATED_DEPTH = 3

export function parseFilters(raw: string | undefined): ListFilter[] {
  if (!raw) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  const ok =
    Array.isArray(value) &&
    value.every(
      (f) =>
        Array.isArray(f) &&
        f.length === 3 &&
        typeof f[0] === 'string' &&
        typeof f[1] === 'string',
    )
  return ok ? (value as ListFilter[]) : []
}
