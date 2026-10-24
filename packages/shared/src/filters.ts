// The list page's `filters` search param is user input (a typed or pasted
// URL): valid JSON is not enough. Only an array of [field, op, value] triples
// is a filter; anything else is discarded and the list shows unfiltered.
// One parser for the list page (web) and the activity feed (server), so the
// feed says "filtered" exactly when the list did (#440).
export type ListFilter = [string, string, unknown]

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
