// LOCAL PROTOTYPE ONLY (featherbase #1223). On a made-up instance already filled by seed-made-up.mts,
// gives three made-up managers Featherbase admin access limited to their own slice, the way designs
// A and C would. No platform code: Role, Permission and Data Scope rows, all existing machinery.
//
//   MANAGER_DESIGN=edit  (A, the default)  the roles read, create and update their Tables
//   MANAGER_DESIGN=read  (C)               the same Tables, read only; changes go through Dash
//
// Each manager's Data Scope is DERIVED from their own Job or Merchandise Assignment, as Dash's reach
// is, never typed: a store manager → their Site; a floor manager → Site + Store Floor + that floor's
// Sections; a category head → Category + its Subcategories. Rerunning replaces what it made.
// Refuses a database not stamped development.
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(appDir, '../../..')
if (!process.env.DATABASE_URL || !process.env.FEATHERBASE_API_URL)
  throw new Error('Set DATABASE_URL and FEATHERBASE_API_URL to the same made-up instance')
const api = process.env.FEATHERBASE_API_URL
const { sql } = await import(pathToFileURL(resolve(checkout, 'apps/server/src/db.ts')).href)
const [stamp] = await sql`select value from featherbase.internal_metadata where key = 'environment'`.catch(() => [])
if (stamp?.value !== 'development') throw new Error('Refusing: this database is not stamped development')

const design = process.env.MANAGER_DESIGN === 'read' ? 'read' : 'edit'
const login = await (await fetch(`${api}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ usr: 'Administrator', pwd: 'admin' }) })).json() as { token: string }
async function call<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${api}${path}`, { ...init, headers: { authorization: `Bearer ${login.token}`, 'content-type': 'application/json', ...init.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`)
  return body as T
}
const save = (table: string, row: Record<string, unknown>) => call('/api/save_row', { method: 'POST', body: JSON.stringify({ table, row }) })

/** The three roles, each with the Tables it edits and the Tables it only looks things up in. */
export const MANAGER_ROLES = {
  'Store Master Data Editor': {
    edits: ['Store Floor', 'Section', 'Section Subcategory', 'Department', 'Department Section', 'Job Assignment'],
    looksUp: ['Site', 'Subcategory', 'Employee'],
  },
  'Floor Master Data Editor': {
    edits: ['Section', 'Section Subcategory', 'Job Assignment'],
    looksUp: ['Site', 'Store Floor', 'Subcategory', 'Employee'],
  },
  'Category Master Data Editor': {
    edits: ['Merchandise Assignment'],
    looksUp: ['Category', 'Subcategory', 'Employee', 'Operating Region'],
  },
} as const
type ManagerRole = keyof typeof MANAGER_ROLES

// The roles and their grants. In design C every grant is read; A adds create and update on `edits`.
const PREFIX = 'Prototype 1223'
await sql`delete from featherbase.permission where role in ${sql(Object.keys(MANAGER_ROLES))}`
for (const [role, { edits, looksUp }] of Object.entries(MANAGER_ROLES)) {
  const exists = await call(`/api/table/Role/${encodeURIComponent(role)}`).then(() => true, () => false)
  if (!exists) await save('Role', { row_id: role })
  for (const table of [...edits, ...looksUp]) {
    const operations = design === 'edit' && (edits as readonly string[]).includes(table) ? ['read', 'create', 'update'] : ['read']
    for (const operation of operations) await save('Permission', { ref_table: table, role, operation, scope_mode: 'all', column_rule: 'every' })
  }
}

const personOf = async (email: string) => String((await sql`select row_id from person where lower(email) = ${email}`)[0]?.row_id ?? '')
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

/** The person's in-force jobs, through their current Employee rows: what Dash's reach starts from. */
async function jobsOf(person: string) {
  return sql`select j.job, j.site, j.floor, j.section, j.starts_on, j.ends_on from featherbase.job_assignment j
    join featherbase.employee e on e.row_id = j.employee where e.person = ${person} and e.status = 'Current'
      and (j.starts_on is null or j.starts_on <= ${today}::date) and (j.ends_on is null or j.ends_on >= ${today}::date)`
}
async function merchandiseOf(person: string) {
  return sql`select m.responsibility, m.category, m.starts_on, m.ends_on from featherbase.merchandise_assignment m
    join featherbase.employee e on e.row_id = m.employee where e.person = ${person} and e.status = 'Current'
      and (m.starts_on is null or m.starts_on <= ${today}::date) and (m.ends_on is null or m.ends_on >= ${today}::date)`
}

/** Data Scope rows from the person's own assignments: [Table, value]. */
async function scopeOf(person: string, role: ManagerRole): Promise<[string, string][]> {
  if (role === 'Store Master Data Editor')
    return (await jobsOf(person)).filter(j => j.job === 'Store Manager').map(j => ['Site', String(j.site)])
  if (role === 'Floor Master Data Editor') {
    const floors = (await jobsOf(person)).filter(j => j.job === 'Floor Manager' && j.floor)
    const out: [string, string][] = []
    for (const f of floors) {
      out.push(['Site', String(f.site)], ['Store Floor', String(f.floor)])
      for (const s of await sql`select row_id from featherbase.section where floor = ${f.floor}`) out.push(['Section', String(s.row_id)])
    }
    return out
  }
  const categories = (await merchandiseOf(person)).filter(m => m.category).map(m => String(m.category))
  const out: [string, string][] = categories.map(c => ['Category', c])
  for (const c of categories) for (const s of await sql`select row_id from featherbase.subcategory where category = ${c}`) out.push(['Subcategory', String(s.row_id)])
  return out
}

/** Who gets which role: one made-up person per kind of manager. */
const MANAGERS: [string, ManagerRole][] = [
  ['reader-sm@example.test', 'Store Master Data Editor'],
  ['reader-fm@example.test', 'Floor Master Data Editor'],
  ['reader-buyer@example.test', 'Category Master Data Editor'],
]
for (const [email, role] of MANAGERS) {
  const person = await personOf(email)
  if (!person) throw new Error(`No made-up ${email}: run seed-made-up.mts first`)
  await sql`delete from featherbase.has_role where parent = ${person} and role in ${sql(Object.keys(MANAGER_ROLES))}`
  await sql`delete from featherbase.data_scope where person = ${person}`
  const [{ n }] = await sql`select coalesce(max(position), 0) + 1 as n from featherbase.has_role where parent = ${person}`
  await sql`insert into featherbase.has_role (row_id, parent, parenttype, parentfield, position, role)
    values (${`${PREFIX}-${person}-${role}`}, ${person}, 'Person', 'roles', ${n}, ${role})`
  const rows = await scopeOf(person, role)
  for (const [allow_table, for_value] of rows) await save('Data Scope', { person, allow_table, for_value })
  console.log(`${email.padEnd(28)} ${role} (${design}); Data Scope: ${rows.map(r => r.join(' = ')).join(', ') || 'none'}`)
}
await sql.end()
process.exit(0)
