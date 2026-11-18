import { registerCollectionAction } from '../actions'
import { sql } from '../db'
import { AppError } from '../errors'
import { ROW_KEY, getMeta } from '../meta'
import { permissionScope } from '../permissions'
import { permissionRefusal } from '../refusals'
import { scopedWhere } from '../query'
import { ACTOR_LABELS, serviceAccountName } from '../actor-names'
import { storedTable } from '../views'

// #1273 (relational navigation, C6): where each row of a link came from, for
// the record's tick list. A row written by a feed reads "from <its source>":
// a Table bound to a data source, a service account or a platform step that
// made it, or a spreadsheet import that wrote it. Any other row was given by
// hand. Only rows the caller may read are answered (read as the caller); the
// rest are left out, never named.
//
//   GET /api/table/:table:row_sources?ids=["a","b"]
//   → { sources: { a: "HR", b: null } }   (null: given by hand)

const MAX_IDS = 500
const IMPORT_GRACE_MS = 10 * 60_000

/** A source as a reader says it after "from": the name without the words that
 *  only say it is a feed ("HR feed" → "HR"), a file's extension, or the
 *  "Automation (…)" a service account with no given name reads as. */
export function sourceLabel(name: string): string {
  let words = name.trim()
  const automation = /^Automation \((.+)\)$/.exec(words)
  if (automation) words = automation[1]!
  words = words.replace(/\.[A-Za-z0-9]{2,5}$/, '')
  const bare = words.replace(/\s+(feed|sync|import|automation)$/i, '').trim()
  return bare || words
}

function parseIds(raw: unknown): string[] {
  let ids: unknown = raw
  if (typeof raw === 'string') {
    try { ids = JSON.parse(raw) } catch { ids = null }
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))
    throw new AppError('ValidationError', 'Expected ids: a JSON list of row ids', { ids: 'a list of row ids' })
  return [...new Set(ids as string[])].filter(Boolean).slice(0, MAX_IDS)
}

export async function rowSources(viewer: string, name: string, rawIds: unknown): Promise<Record<string, string | null>> {
  const ids = parseIds(rawIds)
  const table = await storedTable(name)
  const meta = await getMeta(table)
  const out: Record<string, string | null> = {}
  // A Table the caller may not read is refused, whatever was asked of it. A source-bound
  // Table's rows live on its source: the scoped read below refuses it (it lists, never ticks).
  if ((await permissionScope(viewer, table, 'read')) === 'none') throw await permissionRefusal(viewer, name, 'read')
  if (!ids.length) return out
  // Read through the name asked for: a view keeps its own filters (Codex review).
  const scoped = await scopedWhere(name, viewer, [[ROW_KEY, 'in', ids]])
  const rows = await sql<{ id: string; created_by: string | null; created_at: Date }[]>`
    select ${sql(meta.row_key)}::text as id, created_by, created_at from ${sql(scoped.table)}
    where ${scoped.where as ReturnType<typeof sql>}`
  const found = rows.map((r) => r.id)
  // Who made each row, when that is no person: a service account or a platform step.
  const makers = [...new Set(rows.map((r) => r.created_by).filter((by): by is string => Boolean(by) && by !== 'Administrator'))]
  const accounts = new Map<string, string>()
  const svc = makers.filter((by) => by.startsWith('svc_'))
  if (svc.length)
    for (const a of await sql`select row_id, label, display_name from featherbase.service_account where row_id = any(${svc})`)
      accounts.set(String(a.row_id), serviceAccountName(a))
  // A row a spreadsheet import wrote (a run not undone), by the file's name; only history
  // since the row itself was made counts, as an id can be used again (Codex review).
  const born = new Map(rows.map((r) => [r.id, new Date(r.created_at).getTime()]))
  const imported = new Map<string, string>()
  // An import's own records are stamped when its transaction began, which can be before the
  // rows it made: ten minutes of grace keep those, and still pass over an older run.
  const since = (id: string, at: unknown) => new Date(at as string).getTime() >= (born.get(id) ?? 0) - IMPORT_GRACE_MS
  if (found.length)
    for (const r of await sql`
      select distinct on (s.ref_name) s.ref_name, l.file_name, s.created_at from featherbase.import_source s
      join featherbase.import_log l on l.ref_table = s.ref_table and l.run_id = s.run_id and l.reverted_at is null
      where s.ref_table = ${table} and s.ref_name = any(${found}) and l.file_name is not null
      order by s.ref_name, s.created_at desc`)
      if (since(String(r.ref_name), r.created_at)) imported.set(String(r.ref_name), String(r.file_name))
  // A Table that keeps no import observations still lists each run's rows in its log (Codex review).
  const unnamed = found.filter((id) => !imported.has(id))
  if (unnamed.length)
    for (const r of await sql`
      select distinct on (t.row_id) t.row_id, l.file_name, l.created_at from featherbase.import_log l
      cross join lateral jsonb_to_recordset(case when jsonb_typeof(l.touched) = 'array' then l.touched else '[]'::jsonb end) as t(row_id text)
      where l.ref_table = ${table} and l.reverted_at is null and l.file_name is not null and t.row_id = any(${unnamed})
      order by t.row_id, l.created_at desc`)
      if (since(String(r.row_id), r.created_at)) imported.set(String(r.row_id), String(r.file_name))
  for (const r of rows) {
    const by = r.created_by ?? ''
    const maker = accounts.get(by) ?? (by !== 'Administrator' ? ACTOR_LABELS[by] : undefined)
    const source = maker ?? imported.get(r.id)
    out[r.id] = source ? sourceLabel(source) : null
  }
  return out
}

registerCollectionAction('row_sources', {
  effect: 'read',
  description: 'Where each of these rows came from: a feed by its name, or given by hand (null).',
  handler: async ({ table, args, user }) => ({ sources: await rowSources(user.row_id, table, args.ids) }),
})
