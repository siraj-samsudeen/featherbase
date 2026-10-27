import { z } from 'zod'
import { personScopeSchema, type AppScopeProvider, type AppScopeProviderContext, type PersonScope, type ScopePlace } from 'shared'
import { sql } from './db'
import { getMeta } from './meta'
import { getDoc } from './document'
import { getList } from './query'
import { withAppIdentity } from './app-lifecycle'

/** The instance's one scope-providing app, bound by runtime-packages. */
export interface ScopeProviderBinding {
  app: string
  /** The provider app's installed version, verified against its artifact. */
  version: string
  tables: readonly string[]
  provide: AppScopeProvider
}

/** Why a person has no usable scope. Every reason means no access. */
export class NoPersonScope extends Error {
  constructor(readonly reason: 'configuration' | 'provider' | 'scope') { super('No person scope') }
}

/** Ask the provider for `user`'s places and hold the answer to the scope
 *  shape. No provider, a provider that throws or reads outside what it
 *  declared, an invalid shape and an empty scope all throw NoPersonScope:
 *  an empty scope is never read as everything, for an administrator too. */
export async function resolvePersonScope(user: string, binding: ScopeProviderBinding | undefined): Promise<PersonScope> {
  if (!binding) throw new NoPersonScope('configuration')
  const [person] = await sql`select row_id, email from person where row_id = ${user}`
  let answer: unknown
  try {
    answer = await withAppIdentity(binding.app, binding.version, () => withScopeReads(binding, async documents =>
      binding.provide(Object.freeze({ person: Object.freeze({ id: user, email: (person?.email as string | null) ?? null }), documents }))))
  } catch { throw new NoPersonScope('provider') }
  const parsed = personScopeSchema.safeParse(answer)
  if (!parsed.success) throw new NoPersonScope('provider')
  if (!parsed.data.length) throw new NoPersonScope('scope')
  return parsed.data
}

// The provider reads as the platform, not as the person (a manager needs no
// grant on the roster), so its reach is the declaration: only the Tables it
// named, and only those marked as deciding scope. Reads are awaited one at a
// time and end when the provider returns; any failure fails the whole scope.
async function withScopeReads<T>(binding: ScopeProviderBinding, fn: (documents: AppScopeProviderContext['documents']) => Promise<T>): Promise<T> {
  let open = true
  let pending: Promise<unknown> | undefined
  let failed = false
  async function read<R>(table: string, work: () => Promise<R>): Promise<R> {
    if (!open || pending) { failed = true; throw new Error('Scope provider reads must be awaited one at a time') }
    const run = (async () => {
      if (!binding.tables.includes(table)) throw new Error('Scope provider read an undeclared Table')
      const meta = await getMeta(table)
      if (!meta.decides_scope || meta.system || meta.data_source || meta.kind !== 'table') throw new Error('Scope provider read a Table not marked as deciding scope')
      // A row read loads its Sub-table rows, from a Table never declared or
      // marked; refused, as action documents refuse them.
      if (meta.columns.some((column) => column.column_type === 'Sub-table')) throw new Error('Scope provider read a Table with Sub-tables')
      return JSON.parse(JSON.stringify(await work())) as R
    })()
    pending = run
    try { return await run } catch (error) { failed = true; throw error } finally { pending = undefined }
  }
  const documents: AppScopeProviderContext['documents'] = Object.freeze({
    get: (table, rowId) => read(table, () => {
      if (typeof rowId !== 'string' || !rowId) throw new Error('A row ID is required')
      return getDoc(table, rowId)
    }),
    list: (table, args = {}) => read(table, async () => {
      if (args.filters?.some(([, operator]) => operator === 'related')) throw new Error('Scope provider lists do not support related filters')
      return (await getList(table, args)).data
    }),
  })
  try { return await fn(documents) } finally {
    open = false
    if (pending) { failed = true; await pending.catch(() => {}) }
    if (failed) throw new Error('A scope provider read failed')
  }
}

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

/** Does `fresh` still cover everything `stored` covered? Each stored place
 *  must be allowed whole by some fresh place: every filter the fresh place
 *  constrains, the stored place constrained too, to a subset of its values.
 *  A filter the stored place left open but the fresh one restricts is not
 *  covered. A replay answers from its stored result, so it is admitted only
 *  when this holds. */
export function coversPersonScope(stored: PersonScope, fresh: PersonScope): boolean {
  return stored.every((place) => fresh.some((current) =>
    Object.entries(current.filters).every(([name, allowed]) => {
      const values = place.filters[name]
      return !!values && values.every((value) => allowed.includes(value))
    })))
}

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
