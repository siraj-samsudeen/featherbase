import { z } from 'zod'
import type { PersonScope, ScopePlace } from 'shared'

// #559 (design E1): what a `person_scope` request may name — places by their
// label, and filter values. The platform narrows the person's scope to them
// and hands the handler only the narrowed places.
const text = z.string().min(1).max(200)
const distinct = (values: string[]) => new Set(values).size === values.length
const requestedScope = z.object({
  places: z.array(text).min(1).refine(distinct).optional(),
  filters: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), z.array(text).min(1).refine(distinct))
    .refine((filters) => Object.keys(filters).length > 0).optional(),
}).strict()

/** The person's scope narrowed to what the request names, or null when the
 *  request names anything outside it: a place the person does not cover, or a
 *  filter value that no single place covers together with the others. A
 *  place that does not name a requested filter keeps its own filters and
 *  gains the requested values, which narrows it; it never widens it. */
export function narrowPersonScope(scope: PersonScope, request: unknown): PersonScope | null {
  if (request === undefined) return scope
  const parsed = requestedScope.safeParse(request)
  if (!parsed.success) return null
  const { places: labels, filters: requested } = parsed.data
  let places: ScopePlace[] = [...scope]
  if (labels) {
    if (labels.some((label) => !scope.some((place) => place.label === label))) return null
    places = scope.filter((place) => labels.includes(place.label))
  }
  if (!requested) return places
  const narrowed: ScopePlace[] = []
  for (const place of places) {
    const filters: Record<string, readonly string[]> = { ...place.filters }
    let empty = false
    for (const [name, values] of Object.entries(requested)) {
      const own = place.filters[name]
      filters[name] = own ? values.filter((value) => own.includes(value)) : values
      if (!filters[name].length) empty = true
    }
    if (empty) {
      if (labels) return null
      continue
    }
    const confirmation = place.confirmation && Object.fromEntries(Object.entries(place.confirmation)
      .map(([name, statuses]) => [name, Object.fromEntries(Object.entries(statuses).filter(([value]) => filters[name].includes(value)))]))
    narrowed.push({ ...place, filters, ...(confirmation ? { confirmation } : {}) })
  }
  const covered = Object.entries(requested).every(([name, values]) =>
    values.every((value) => narrowed.some((place) => place.filters[name].includes(value))))
  return covered ? narrowed : null
}
