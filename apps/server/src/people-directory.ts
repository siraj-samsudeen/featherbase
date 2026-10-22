// How people are shown and found (person-rename): a person's id is opaque
// (`psn_…`), so wherever a human reads it, the name is shown instead, and the
// Person picker searches what people know someone by — never the id. Both
// read Person as the viewer: the Person permission (own-rows grants
// included) and Data Scope apply, exactly as a list read does.
import { sql } from './db'
import { AppError } from './errors'
import { scopedWhere } from './query'

const MAX_NAMES = 500
export const UNNAMED = 'Unnamed person'

/** A person's display name: full name, else @username — never an address
 *  (an address is personal data the name surfaces travel to), else
 *  "Unnamed person". */
function displayName(r: Record<string, unknown>): string {
  return String(r.full_name ?? '').trim() || (r.username ? `@${String(r.username)}` : UNNAMED)
}

/** Display names for principal ids, as `viewer` may see them. A person the
 *  viewer may not read, or an id that names nobody, maps to null — the
 *  caller shows a neutral placeholder, never the opaque id. A service
 *  account is shown by its name. */
export async function principalNames(ids: unknown, viewer: string): Promise<Record<string, string | null>> {
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string'))
    throw new AppError('ValidationError', 'Expected { ids: [...] }', { ids: 'a list of ids' })
  const wanted = [...new Set(ids as string[])].slice(0, MAX_NAMES)
  const out: Record<string, string | null> = Object.fromEntries(wanted.map((id) => [id, null]))
  if (!wanted.length) return out
  let readable: { table: string; where: unknown; cols: Set<string> } | null = null
  try {
    readable = await scopedWhere('Person', viewer, [['row_id', 'in', wanted]])
  } catch (err) {
    if (!(err instanceof AppError && err.type === 'PermissionError')) throw err
  }
  if (readable) {
    const { table, where, cols } = readable
    const rows = await sql`
      select row_id, ${cols.has('full_name') ? sql`full_name` : sql`null::text`} as full_name,
        ${cols.has('username') ? sql`username` : sql`null::text`} as username
      from ${sql(table)} where ${where as ReturnType<typeof sql>}`
    for (const r of rows) out[String(r.row_id)] = displayName(r)
  }
  for (const r of await sql`select row_id, label from service_account where row_id in ${sql(wanted)}`)
    out[String(r.row_id)] = String(r.label)
  return out
}

export interface PickedPerson {
  row_id: string
  label: string
}

/** The Person picker: search name, username, address and employee code
 *  (ignoring case); never offer a built-in account (nor, once records can
 *  be merged, a replaced one). The label reads "Full Name · @username" — or
 *  the address, or the code, when there is no username. Reads Person as the
 *  viewer (scopedWhere), so a person found is a person they may read. */
export async function pickPeople(q: string, viewer: string, limit = 10): Promise<PickedPerson[]> {
  const { table, where, cols } = await scopedWhere('Person', viewer, [['built_in', '=', false]])
  // Only the columns this viewer may read are shown or searched.
  const col = (c: string) => (cols.has(c) ? sql`${sql(c)}` : sql`null::text`)
  const like = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const rows = await sql`
    select row_id, ${col('full_name')} as full_name, ${col('username')} as username, ${col('email')} as email,
      ${col('employee_code')} as code
    from ${sql(table)}
    where ${where}
      ${cols.has('replaced_by') ? sql`and replaced_by is null` : sql``}
      and (${q.trim() === ''}::boolean or ${col('full_name')} ilike ${like} or ${col('username')} ilike ${like}
        or ${col('email')} ilike ${like} or ${col('employee_code')} ilike ${like})
    order by lower(coalesce(${col('full_name')}, ${col('username')}, ${col('email')}, row_id))
    limit ${Math.min(Math.max(limit, 1), 50)}`
  return rows.map((r) => {
    const name = String(r.full_name ?? '').trim()
    const detail = r.username ? `@${String(r.username)}` : (r.email as string | null) || (r.code as string | null) || ''
    return { row_id: String(r.row_id), label: [name, detail].filter(Boolean).join(' · ') || '(no name)' }
  })
}
