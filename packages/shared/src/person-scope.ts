import { z } from 'zod'

// #559 (design E1): the platform's shape for a person's scope. An app that
// provides the scope fills it; the platform validates it, freezes it and hands
// it to `person_scope` operations. A scope is a list of places the person
// covers; each place names its filter values, for example
// `{ store: ['12'], section: ['kids'] }`.

const text = z.string().min(1).max(200).refine((s) => s.trim().length > 0)
const filterName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

export const SCOPE_CONFIRMATIONS = ['confirmed', 'assumed'] as const
export type ScopeConfirmation = (typeof SCOPE_CONFIRMATIONS)[number]

const distinct = (values: string[]) => new Set(values).size === values.length

/** A calendar day, YYYY-MM-DD, that exists. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const date = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(s)
}, 'Expected a day as YYYY-MM-DD')

/** #628 (Q1 C): why the person has a place, from the app that gives it, and
 *  the days it holds from and to where the app knows them. */
export const scopeReasonSchema = z.object({ text, since: day.optional(), until: day.optional() }).strict()

// A place always names at least one filter value: a place without one would
// read as "everything", which a scope never means.
export const scopePlaceSchema = z.object({
  label: text,
  filters: z.record(filterName, z.array(text).min(1).refine(distinct, 'Filter values must be distinct'))
    .refine((filters) => Object.keys(filters).length > 0, 'A place names at least one filter'),
  basis: text.optional(),
  reasons: z.array(scopeReasonSchema).optional(),
  // Per filter value: whether the person's link to it is confirmed or assumed.
  confirmation: z.record(filterName, z.record(text, z.enum(SCOPE_CONFIRMATIONS))).optional(),
}).strict().refine((place) => Object.entries(place.confirmation ?? {}).every(([filter, values]) =>
  Object.keys(values).every((value) => place.filters[filter]?.includes(value))),
'A confirmation status names only the place\'s own filter values')

export const personScopeSchema = z.array(scopePlaceSchema)
  .refine((places) => distinct(places.map((place) => place.label)), 'Place labels must be distinct')

export interface ScopePlace {
  readonly label: string
  readonly filters: Readonly<Record<string, readonly string[]>>
  readonly basis?: string
  readonly reasons?: readonly Readonly<{ text: string; since?: string; until?: string }>[]
  readonly confirmation?: Readonly<Record<string, Readonly<Record<string, ScopeConfirmation>>>>
}
export type PersonScope = readonly ScopePlace[]
