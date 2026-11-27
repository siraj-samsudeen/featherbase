import type { PageStateValue } from 'shared'

// #1410: a page's state lives in its address. A state key is a query-string key;
// the definition's `state` gives each key's default, and the default's type is
// the key's type. A key at its default is left out of the address.

type State = Record<string, PageStateValue>

/** `given` as the type of `fallback`, or `fallback` when it cannot be. */
function asTypeOf(fallback: PageStateValue, given: unknown): PageStateValue {
  if (typeof fallback === 'string') return ['string', 'number', 'boolean'].includes(typeof given) ? String(given) : fallback
  if (typeof fallback === 'number') {
    const number = typeof given === 'number' ? given : typeof given === 'string' && given.trim() !== '' ? Number(given) : NaN
    return Number.isFinite(number) ? number : fallback
  }
  return given === true || given === 'true' ? true : given === false || given === 'false' ? false : fallback
}

/** The page's state as its address says: each key's value from the query string, else its default. */
export function stateFromSearch(defaults: State, search: Record<string, unknown>): State {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, key in search ? asTypeOf(fallback, search[key]) : fallback]))
}

/** The query string after state changes: what it held, with each changed key set, or removed when back at its default. */
export function searchWithState(defaults: State, search: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> {
  const next = { ...search }
  for (const [key, value] of Object.entries(values)) {
    if (!(key in defaults)) continue
    const typed = asTypeOf(defaults[key]!, value)
    if (typed === defaults[key]) delete next[key]
    else next[key] = typed
  }
  return next
}
