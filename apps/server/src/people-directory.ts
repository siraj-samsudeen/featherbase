// How people are shown and found (person-rename): a person's id is opaque
// (`psn_…`), so wherever a human reads it, the name is shown instead, and the
// Person picker searches what people know someone by — name, username,
// address, employee code — never the id.
import { sql } from './db'
import { AppError } from './errors'
import { assertPermission, getScopeMap, isPrivileged } from './permissions'
import { PLATFORM_SCHEMA } from './platform-schema'

const MAX_NAMES = 500

async function personColumn(column: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from information_schema.columns
    where table_schema = ${PLATFORM_SCHEMA} and table_name = 'person' and column_name = ${column}`
  return Boolean(row)
}

/** Display names for principal ids: a person's full name (else @username,
 *  else address), a service account's name. An id that names nobody, or a
 *  person with none of these, maps to null — the caller shows a neutral
 *  placeholder, never the opaque id. */
export async function principalNames(ids: unknown): Promise<Record<string, string | null>> {
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string'))
    throw new AppError('ValidationError', 'Expected { ids: [...] }', { ids: 'a list of ids' })
  const wanted = [...new Set(ids as string[])].slice(0, MAX_NAMES)
  const out: Record<string, string | null> = Object.fromEntries(wanted.map((id) => [id, null]))
  if (!wanted.length) return out
  const rows = await sql`
    select row_id, coalesce(nullif(trim(full_name), ''), '@' || nullif(username, ''), nullif(email, '')) as name
    from person where row_id in ${sql(wanted)}
    union all
    select row_id, label from service_account where row_id in ${sql(wanted)}`
  for (const r of rows) out[String(r.row_id)] = (r.name as string | null) ?? null
  return out
}

export interface PickedPerson {
  row_id: string
  label: string
}

/** The Person picker: search name, username, address and employee code
 *  (ignoring case); never offer a built-in account (nor, once records can
 *  be merged, a replaced one). The label reads "Full Name · @username" — or
 *  the address, or the code, when there is no username. Person read
 *  permission and the viewer's Data Scope on Person apply. */
export async function pickPeople(q: string, viewer: string, limit = 10): Promise<PickedPerson[]> {
  await assertPermission(viewer, 'Person', 'read')
  const scoped = (await isPrivileged(viewer)) ? null : ((await getScopeMap(viewer)).get('Person') ?? null)
  const hasCode = await personColumn('employee_code')
  const hasReplaced = await personColumn('replaced_by')
  const like = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const rows = await sql`
    select row_id, full_name, username, email, ${hasCode ? sql`employee_code` : sql`null::text`} as code
    from person
    where not built_in
      ${hasReplaced ? sql`and replaced_by is null` : sql``}
      ${scoped ? sql`and row_id = any(${[...scoped]}::text[])` : sql``}
      and (${q.trim() === ''}::boolean or full_name ilike ${like} or username ilike ${like} or email ilike ${like}
        ${hasCode ? sql`or employee_code ilike ${like}` : sql``})
    order by lower(coalesce(full_name, username, email, row_id))
    limit ${Math.min(Math.max(limit, 1), 50)}`
  return rows.map((r) => {
    const name = String(r.full_name ?? '').trim()
    const detail = r.username ? `@${String(r.username)}` : (r.email as string | null) || (r.code as string | null) || ''
    return { row_id: String(r.row_id), label: [name, detail].filter(Boolean).join(' · ') || '(no name)' }
  })
}
