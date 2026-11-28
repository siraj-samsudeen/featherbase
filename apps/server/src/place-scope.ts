// #1454: a Table whose rows are about places (stores, sections, subcategories) is read only within each person's
// places, as the instance's org-chart scope provider gives them, on every read path: lists, counts, charts, search
// and exports (scopedWhere), a single row and every write (assertUserPermissions), and realtime (through getDoc).
// The app declares the mapping, scope filter → column: a read-only copy by its dataset's `filters`, one of its own
// Tables by `scopedTables`. A place adds rows only when the Table maps every filter it names, and no place adds
// none (fail closed, as a dataset read). A row the person wrote is always theirs. A System Manager is not narrowed,
// as Data Scope does not narrow them.
import { placeGroups, rowWithinPlaces, type PersonScope } from 'shared'
import { sql } from './db'
import { AsyncLocalStorage } from 'node:async_hooks'
import { NoPersonScope, resolvePersonScope } from './person-scope'
import { getMeta } from './meta'
import { declaredCopy } from './read-only-copy'

// runtime-packages is loaded when first needed: query.ts and document.ts import this module, and a static import
// would close a cycle through runtime-packages at start-up (as view-as.ts does).
const packages = () => import('./runtime-packages')

/** A Table's scope filter → column mapping, or null when it is not narrowed by places. An app's Table whose app is
 *  not loaded now (its artifact refused, say) cannot say, so it maps nothing: every place then adds no row (fail
 *  closed), rather than reading as unscoped. */
export async function placeScopeOf(table: string): Promise<Readonly<Record<string, string>> | null> {
  const loaded = await packages()
  const mapping = loaded.tablePlaceScope(table)
  if (mapping) return mapping
  const owner = (await getMeta(table).catch(() => null))?.owner_app
  return owner && !loaded.isAppLoaded(owner) ? {} : null
}

// One answer per person per request (an HTTP request, MCP's included, or one live update's delivery): a page's many
// reads, a save's several checks, ask the provider once. Only the places: nothing else is remembered here, and a
// request never outlives a change to the org chart by more than its own run.
const memo = new AsyncLocalStorage<Map<string, Promise<PersonScope>>>()
export function withPlacesMemo<T>(work: () => Promise<T>): Promise<T> {
  return memo.getStore() ? work() : memo.run(new Map(), work)
}

/** The person's places now, once per request: none when the instance has no scope provider, the provider fails or
 *  gives them nothing, so every scoped Table then answers only their own rows. */
export function placesOf(user: string): Promise<PersonScope> {
  const remembered = memo.getStore()
  const hit = remembered?.get(user)
  if (hit) return hit
  const read = resolvePlaces(user)
  remembered?.set(user, read)
  // a failed read is not remembered: the next check asks again
  read.catch(() => remembered?.delete(user))
  return read
}
async function resolvePlaces(user: string): Promise<PersonScope> {
  try {
    return await resolvePersonScope(user, await (await packages()).findScopeProvider())
  } catch (error) {
    if (error instanceof NoPersonScope) return []
    // a provider "not set up yet" (a missing identifier system) gives no one places either
    if ((error as { type?: string }).type === 'NotSetUpError') return []
    throw error
  }
}

/** The SQL condition a list adds for `user` on a place-scoped Table (`tbl` its relation), boxed (a fragment is a
 *  thenable: awaiting it would run it), or null when the Table is not scoped. Values compare as text, as a dataset read's. */
export async function placeCondition(table: string, user: string, tbl: string): Promise<{ frag: ReturnType<typeof sql> } | null> {
  const mapping = await placeScopeOf(table)
  if (!mapping) return null
  const any: ReturnType<typeof sql>[] = placeGroups(mapping, await placesOf(user)).map((group) => group
    .map(({ column, values }): ReturnType<typeof sql> => sql`${sql(tbl)}.${sql(column)}::text in ${sql(values)}`)
    .reduce((all, condition) => sql`${all} and ${condition}`))
  // a read-only copy's rows are the platform's own (its loads), so no reader wrote one: no own-rows branch, which
  // would also keep the planner from the copy's store index
  const own: ReturnType<typeof sql> | null = declaredCopy(table) ? null : sql`${sql(tbl)}.created_by = ${user}`
  const either = [...(own ? [own] : []), ...any.map((g) => sql`(${g})`)]
  return { frag: either.length ? sql`(${either.reduce((all, g) => sql`${all} or ${g}`)})` : sql`false` }
}

/** Whether one row is within `user`'s places on a place-scoped Table, or theirs; true for a Table that is not scoped. */
export async function rowInPlaces(table: string, user: string, row: Record<string, unknown>): Promise<boolean> {
  const mapping = await placeScopeOf(table)
  if (!mapping) return true
  if (row.created_by != null && row.created_by === user) return true
  return rowWithinPlaces(mapping, await placesOf(user), row)
}
