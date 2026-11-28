// #1454: a Table whose rows are about places (stores, sections, subcategories) is read only within each person's
// places, as the instance's org-chart scope provider gives them, on every read path: lists, counts, charts, search
// and exports (scopedWhere), a single row and every write (assertUserPermissions), and realtime (through getDoc).
// The app declares the mapping, scope filter → column: a read-only copy by its dataset's `filters`, one of its own
// Tables by `scopedTables`. A place adds rows only when the Table maps every filter it names, and no place adds
// none (fail closed, as a dataset read). A row the person wrote is always theirs. A System Manager is not narrowed,
// as Data Scope does not narrow them.
import type { PersonScope } from 'shared'
import { sql } from './db'
import { readOnce } from './permission-reads'
import { NoPersonScope, resolvePersonScope } from './person-scope'

// runtime-packages is loaded when first needed: query.ts and document.ts import this module, and a static import
// would close a cycle through runtime-packages at start-up (as view-as.ts does).
const packages = () => import('./runtime-packages')

/** A Table's scope filter → column mapping, or null when it is not narrowed by places. */
export async function placeScopeOf(table: string): Promise<Readonly<Record<string, string>> | null> {
  return (await packages()).tablePlaceScope(table)
}

/** The person's places now, once per request: none when the instance has no scope provider, the provider fails or
 *  gives them nothing, so every scoped Table then answers only their own rows. */
export function placesOf(user: string): Promise<PersonScope> {
  return readOnce(JSON.stringify(['places', user]), async () => {
    try {
      return await resolvePersonScope(user, await (await packages()).findScopeProvider())
    } catch (error) {
      if (error instanceof NoPersonScope) return []
      // a provider "not set up yet" (a missing identifier system) gives no one places either
      if ((error as { type?: string }).type === 'NotSetUpError') return []
      throw error
    }
  })
}

/** The groups a row may match: one per place the Table can apply, each a list of column → allowed values. */
function groups(mapping: Readonly<Record<string, string>>, places: PersonScope): { column: string; values: string[] }[][] {
  return places.flatMap((place) => {
    const keys = Object.keys(place.filters)
    if (!keys.length || keys.some((key) => !Object.hasOwn(mapping, key))) return []
    return [keys.map((key) => ({ column: mapping[key], values: [...place.filters[key]] }))]
  })
}

/** The SQL condition a list adds for `user` on a place-scoped Table (`tbl` its relation), boxed (a fragment is a
 *  thenable: awaiting it would run it), or null when the Table is not scoped. Values compare as text, as a dataset read's. */
export async function placeCondition(table: string, user: string, tbl: string): Promise<{ frag: ReturnType<typeof sql> } | null> {
  const mapping = await placeScopeOf(table)
  if (!mapping) return null
  const any: ReturnType<typeof sql>[] = groups(mapping, await placesOf(user)).map((group) => group
    .map(({ column, values }): ReturnType<typeof sql> => sql`${sql(tbl)}.${sql(column)}::text in ${sql(values)}`)
    .reduce((all, condition) => sql`${all} and ${condition}`))
  const own: ReturnType<typeof sql> = sql`${sql(tbl)}.created_by = ${user}`
  return { frag: any.length ? sql`(${own} or ${any.map((g) => sql`(${g})`).reduce((all, g) => sql`${all} or ${g}`)})` : own }
}

/** Whether one row is within `user`'s places on a place-scoped Table, or theirs; true for a Table that is not scoped. */
export async function rowInPlaces(table: string, user: string, row: Record<string, unknown>): Promise<boolean> {
  const mapping = await placeScopeOf(table)
  if (!mapping) return true
  if (row.created_by != null && row.created_by === user) return true
  return groups(mapping, await placesOf(user)).some((group) =>
    group.every(({ column, values }) => row[column] != null && values.includes(String(row[column]))))
}
