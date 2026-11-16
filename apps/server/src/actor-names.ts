// #1224: who did something, by name — the one place an actor id becomes words.
// An actor is whoever is recorded as doing a thing the viewer is already
// allowed to see: who gave a role, set a limit, shared a row, wrote a version
// or comment. Who did it is not secret from the people who see it done, so a
// person's DISPLAY NAME is returned without the viewer's Person read
// permission. Nothing else about them is: never an address, never another
// column. Callers pass only ids taken from rows the viewer may already read;
// this is not a directory lookup (the generic /api/people/names stays read as
// the viewer, people-directory.ts).
import { SYSTEM_ACTOR_LABELS } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import { scopedWhere } from './query'
import { canRetire } from './table-engine'
import { displayName } from './people-directory'
import { ROSTER_LINK_ACTOR } from './roster-link-actor'

/** System steps, as a reader says them. Not people, not service accounts. */
export const ACTOR_LABELS: Readonly<Record<string, string>> = {
  ...SYSTEM_ACTOR_LABELS,
  [ROSTER_LINK_ACTOR]: 'Staff roster sync',
  Administrator: 'Administrator',
}

export { serviceAccountName } from './service-account-name'
import { serviceAccountName } from './service-account-name'

/** Names for actor ids: people (display name), service accounts, system
 *  steps. An id that names nobody is absent from the map; the caller decides
 *  what to show (never the opaque id). */
export async function actorNames(ids: Iterable<unknown>): Promise<Map<string, string>> {
  const wanted = [...new Set([...ids].filter((id): id is string => typeof id === 'string' && id !== ''))]
  const out = new Map<string, string>()
  if (!wanted.length) return out
  for (const id of wanted) if (ACTOR_LABELS[id]) out.set(id, ACTOR_LABELS[id])
  const rows = await sql`
    select row_id, full_name, username, null::text as label, null::text as display_name, 'person' as kind
    from person where row_id = any(${wanted})
    union all
    select row_id, null, null, label, display_name, 'service_account' from service_account where row_id = any(${wanted})`
  for (const r of rows)
    out.set(String(r.row_id), r.kind === 'person' ? displayName(r) : serviceAccountName(r))
  return out
}

/** #1224 (Codex adversarial round 1): an app names only ids that ACTED on its
 *  own data — who created or last changed one of its Tables' rows, or made,
 *  changed or decided one of its change proposals. Any other id maps to null,
 *  so an app forwarding arbitrary ids is not a name lookup. System steps are
 *  names, not people, and always read as their phrase. */
export async function appActorNames(app: string, ids: unknown): Promise<Record<string, string | null>> {
  const wanted = Array.isArray(ids)
    ? [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))].slice(0, 500) : []
  const out: Record<string, string | null> = Object.fromEntries(wanted.map((id) => [id, null]))
  if (!wanted.length) return out
  const acted = new Set(wanted.filter((id) => ACTOR_LABELS[id]))
  const tables = await sql`
    select physical_schema, physical_relation from table_def
    where owner_app = ${app} and physical_schema is not null and physical_relation is not null`
  // Its change proposals, then each of its own Tables: who made, changed or decided them.
  const sources = [
    sql`select unnest(array[created_by, updated_by, maker, decided_by]) as id from change_proposal where app = ${app}
        and (created_by = any(${wanted}) or updated_by = any(${wanted}) or maker = any(${wanted}) or decided_by = any(${wanted}))`,
    ...tables.map((t) => {
      const relation = sql`${sql(String(t.physical_schema))}.${sql(String(t.physical_relation))}`
      return sql`select created_by as id from ${relation} where created_by = any(${wanted})
        union select updated_by from ${relation} where updated_by = any(${wanted})`
    }),
  ]
  // One after the other: inside a request they share its transaction.
  for (const query of sources) for (const r of await query) acted.add(String(r.id))
  const named = await actorNames(wanted.filter((id) => acted.has(id)))
  for (const id of wanted) if (acted.has(id)) out[id] = named.get(id) ?? null
  return out
}

/** #1224: names for the people who acted on rows of `table` that the viewer
 *  may read — who made, last changed or retired one of those rows, or
 *  archived the Table — even when the viewer may not read Person ("you can
 *  see who did what you can see"). The rows are read AS THE VIEWER (row rules,
 *  Data Scope, mandatory privacy); any other id maps to null, so this is no
 *  name lookup. */
export async function actorNamesOn(viewer: string, table: unknown, ids: unknown): Promise<Record<string, string | null>> {
  if (typeof table !== 'string' || !table || !Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))
    throw new AppError('ValidationError', 'Expected { table, ids: [...] }', { table: 'a Table name', ids: 'a list of ids' })
  const wanted = [...new Set(ids as string[])].filter(Boolean).slice(0, 500)
  const out: Record<string, string | null> = Object.fromEntries(wanted.map((id) => [id, null]))
  if (!wanted.length) return out
  // A Table the viewer may not read here, or one that cannot be read this way
  // (source-bound, a settings Table), names nobody.
  const scoped = await scopedWhere(table, viewer, []).catch((error: unknown) => (error instanceof AppError ? null : Promise.reject(error)))
  if (!scoped) return out
  const acted = new Set(wanted.filter((id) => ACTOR_LABELS[id]))
  const relation = sql(scoped.table)
  const columns = ['created_by', 'updated_by', ...(canRetire(scoped.meta) ? ['retired_by'] : [])]
  for (const column of columns)
    for (const r of await sql`select distinct ${sql(column)} as id from ${relation}
      where ${scoped.where as ReturnType<typeof sql>} and ${sql(column)} = any(${wanted})`)
      acted.add(String(r.id))
  const [archive] = await sql`select archived_by from table_def where name = ${scoped.meta.name} and archived_by = any(${wanted})`
  if (archive) acted.add(String(archive.archived_by))
  const named = await actorNames([...acted])
  for (const id of acted) out[id] = named.get(id) ?? null
  return out
}
