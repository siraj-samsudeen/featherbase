// How people are shown and found (person-rename): a person's id is opaque
// (`psn_…`), so wherever a human reads it, the name is shown instead, and the
// Person picker searches what people know someone by — never the id. Both
// read Person as the viewer: the Person permission (own-rows grants
// included) and Data Scope apply, exactly as a list read does.
import { sql } from './db'
import { AppError } from './errors'
import { hideRetired, scopedWhere } from './query'
import { getMeta } from './meta'
import { assertPermission, getRoles } from './permissions'

const MAX_NAMES = 500
const UNNAMED = 'Unnamed person'

/** A person's display name: full name, else @username — never an address
 *  (an address is personal data the name surfaces travel to), else
 *  "Unnamed person". */
export function displayName(r: Record<string, unknown>): string {
  return String(r.full_name ?? '').trim() || (r.username ? `@${String(r.username)}` : UNNAMED)
}

/** #912: the caller's own name, which their session already shows them
 *  (whoami), so no Person read permission is involved. */
export async function ownDisplayName(user: string): Promise<string> {
  const [person] = await sql`select * from person where row_id = ${user}`
  const [account] = await sql`select label from service_account where row_id = ${user}`
  return person ? displayName(person) : String(account?.label ?? UNNAMED)
}

/** Person, read as `viewer` with these filters; null when the viewer may not
 *  read Person at all. Any other failure is the caller's. */
async function readablePeople(viewer: string, filters: Parameters<typeof scopedWhere>[2]) {
  try {
    return await scopedWhere('Person', viewer, filters)
  } catch (error) {
    if (error instanceof AppError && error.type === 'PermissionError') return null
    throw error
  }
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
  const readable = await readablePeople(viewer, [['row_id', 'in', wanted]])
  if (readable) {
    const { table, where, cols, readExpression } = readable
    const rows = await sql`
      select row_id, ${cols.has('full_name') ? readExpression('full_name') : sql`null::text`} as full_name,
        ${cols.has('username') ? readExpression('username') : sql`null::text`} as username
      from ${sql(table)} where ${where as ReturnType<typeof sql>}`
    for (const r of rows) out[String(r.row_id)] = displayName(r)
  }
  for (const r of await sql`select row_id, label from service_account where row_id in ${sql(wanted)}`)
    out[String(r.row_id)] = String(r.label)
  return out
}

/** #1097: names for people an app's own settings name (support lists, assignees,
 *  approvers). The administrator chose them for this app, so its users see them
 *  by name even without the Person permission; every other id is read as the
 *  viewer, as in `principalNames`. */
export async function namesForApp(ids: unknown, viewer: string, settings: Readonly<Record<string, string>>) {
  const out = await principalNames(ids, viewer)
  const named = new Set(Object.values(settings).join(' ').match(/\bpsn_[A-Za-z0-9]+\b/g) ?? [])
  const missing = Object.keys(out).filter((id) => out[id] === null && named.has(id))
  if (missing.length) for (const r of await sql`select row_id, full_name, username from person
    where row_id in ${sql(missing)} and replaced_by is null and retired_at is null and not coalesce(built_in, false)`)
    out[String(r.row_id)] = displayName(r)
  return out
}

/** #963: which of these ids are enabled people, read as the viewer: never a
 *  built-in or merged-away account, and a service account is not a Person. */
export async function enabledPeople(ids: string[], viewer: string): Promise<string[]> {
  const wanted = [...new Set(ids)].slice(0, MAX_NAMES)
  if (!wanted.length) return []
  const scoped = await readablePeople(viewer, [['row_id', 'in', wanted], ['enabled', '=', true], ['built_in', '=', false]])
  if (!scoped) return []
  const rows = await sql`select row_id from ${sql(scoped.table)} where ${scoped.where} and replaced_by is null order by row_id`
  return rows.map((row) => String(row.row_id))
}

/** The person an email address belongs to, read as the viewer (like the
 *  picker): never a built-in or merged-away account, and nobody when the
 *  viewer may not read Person or its email (so an address can't be probed
 *  past what the viewer could already look up). Any letter case. */
export async function personByEmail(address: string, viewer: string): Promise<string | null> {
  const scoped = await readablePeople(viewer, [])
  if (!scoped) return null
  if (!scoped.cols.has('email')) return null
  const [row] = await sql`
    select p.row_id from (
      select row_id, replaced_by, ${scoped.readExpression('email')} as email
      from ${sql(scoped.table)} where ${scoped.where} and not coalesce(built_in, false)
    ) p
    where p.replaced_by is null and lower(trim(p.email)) = lower(${address.trim()})
    order by p.row_id
    limit 1`
  return row ? String(row.row_id) : null
}

interface PickedPerson {
  row_id: string
  label: string
}

/** The Person picker: search name, username, address and employee code
 *  (ignoring case); never offer a built-in account or a replaced
 *  (merged-away) one. The employee code is the person's CURRENT
 *  employee-record identifier rows (person-resolution) — the rows the joiner
 *  and correction procedures write — not the `employee_code` Custom Field.
 *  The label reads "Full Name · @username" — or the address, or the code,
 *  when there is no username. Reads Person as the viewer (scopedWhere), so a
 *  person found is a person they may read. */
export async function pickPeople(q: string, viewer: string, limit = 10): Promise<PickedPerson[]> {
  // #859: a retired person is not offered either (names of people already
  // chosen resolve through the names lookup, which is unaffected).
  const { table, where, cols, readExpression } = await scopedWhere('Person', viewer, hideRetired(await getMeta('Person'), []))
  // Only the columns this viewer may read are shown or searched.
  const col = (c: string) => (cols.has(c) ? sql`p.${sql(c)}` : sql`null::text`)
  const selected = (c: string) => cols.has(c) ? readExpression(c) : sql`null::text`
  const like = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const rows = await sql`
    select p.row_id, ${col('full_name')} as full_name, ${col('username')} as username, ${col('email')} as email,
      (select min(i.value) from person_identifier i join identifier_system s on s.row_id = i.system and s.kind = 'employee-record'
       where i.person_id = p.row_id and upper_inf(i.valid)) as code
    from (select row_id, replaced_by, ${selected('full_name')} as full_name,
      ${selected('username')} as username, ${selected('email')} as email
      from ${sql(table)} where ${where} and not coalesce(built_in, false)) p
    where p.replaced_by is null
      and (${q.trim() === ''}::boolean or ${col('full_name')} ilike ${like} or ${col('username')} ilike ${like}
        or ${col('email')} ilike ${like}
        or exists (
          select 1 from person_identifier i join identifier_system s on s.row_id = i.system and s.kind = 'employee-record'
          where i.person_id = p.row_id and upper_inf(i.valid) and i.value ilike ${like}))
    order by lower(coalesce(${col('full_name')}, ${col('username')}, ${col('email')}, p.row_id))
    limit ${Math.min(Math.max(limit, 1), 50)}`
  return rows.map((r) => {
    const name = String(r.full_name ?? '').trim()
    const detail = r.username ? `@${String(r.username)}` : (r.email as string | null) || (r.code as string | null) || ''
    return { row_id: String(r.row_id), label: [name, detail].filter(Boolean).join(' · ') || '(no name)' }
  })
}

/** A protected workspace exposes only its admitted people's display names.
 * This never grants access to Person records or their contact information. */
export async function tableMembers(table: string, viewer: string) {
  const meta = await getMeta(table)
  if (!meta.access_policy) throw new AppError('PermissionError', 'This Table has no member directory')
  await assertPermission(viewer, table, 'read')
  const people = await sql`select row_id, full_name, username from person where enabled and replaced_by is null`
  const members: { row_id: string; full_name: string }[] = []
  for (const person of people) {
    const roles = await getRoles(String(person.row_id))
    if (meta.access_policy.roles.some(role => roles.includes(role)))
      members.push({ row_id: String(person.row_id), full_name: displayName(person) })
  }
  return members.sort((a, b) => a.full_name.localeCompare(b.full_name) || a.row_id.localeCompare(b.row_id))
}
