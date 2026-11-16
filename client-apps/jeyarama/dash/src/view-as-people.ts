// View as (#1222): who a View As Tester can pick, and who each of them is. The platform runs this
// read as the tester, for its picker and its Recent and Frequently used lists; it keeps the state
// and refuses every write while viewing. Each person comes with #1216's identity line: employee
// code, and each job held today with its site.
import { EMPLOYEE_STATUS, exact, text } from './values.ts'
import { istToday } from './report.ts'
import { all, personNames, whoIs, type AccessContext } from './report-access-server.ts'

/** The Dash role whose holders may view as someone else (featherbase.json `viewAs.role`). */
export const VIEW_AS_TESTER = 'View As Tester'

/** The platform keeps the first 20 it may show, after its own checks; this leaves it room. */
const LIMIT = 100
const MAX_WORDS = 5
const MAX_DESCRIBED = 50

type Person = { person: string; name: string; code: string | null; jobs: string[] }

/** People for View as: `{ persons }` describes those, in order; `{ q }` finds current staff whose name, code, or job and site hold every word typed. */
export async function viewAsPeople(ctx: AccessContext, on: string = istToday()): Promise<Person[]> {
  if (!(ctx.roles ?? []).includes(VIEW_AS_TESTER)) ctx.reject!('Only a View As Tester can look people up for View as')
  const payload = ctx.payload as { q?: unknown; persons?: unknown } | undefined
  if (Array.isArray(payload?.persons)) return describe(ctx, payload.persons.filter((p): p is string => typeof p === 'string' && !!p).slice(0, MAX_DESCRIBED), on)
  const typed = text(payload?.q)
  if (typed.length < 2) return []
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS)
  const base = ctx.baseTables!
  // Every candidate, page by page: a limit here would drop people before they are checked.
  const list = (table: string, fields: string[], filters: [string, string, unknown][]) => all(base, table, fields, filters)
  // Candidates: anyone a word finds by name, code, job or site; then every word must match.
  const employees = new Map<string, Record<string, unknown>>()
  const keep = (rows: Record<string, unknown>[]) => { for (const row of rows) if (exact(row.person) && text(row[EMPLOYEE_STATUS]) === 'Current') employees.set(exact(row.row_id), row) }
  const fields = ['name', 'person', 'employee_code', EMPLOYEE_STATUS]
  // Words of two letters or more find candidates; every word must still match.
  for (const word of words.filter(w => w.length >= 2)) {
    keep(await list('Employee', fields, [['name', 'like', `%${word}%`]]))
    keep(await list('Employee', fields, [['employee_code', 'like', `%${word}%`]]))
    const sites = (await list('Site', ['name'], [['name', 'like', `%${word}%`]])).map(row => exact(row.row_id))
    const held = [...await list('Job Assignment', ['employee'], [['job', 'like', `%${word}%`]]),
      ...(sites.length ? await list('Job Assignment', ['employee'], [['site', 'in', sites]]) : [])]
    const ids = [...new Set(held.map(row => exact(row.employee)).filter(id => id && !employees.has(id)))]
    if (ids.length) keep(await all(base, 'Employee', fields, [['row_id', 'in', ids]]))
  }
  const names = new Map<string, string>()
  for (const row of employees.values()) if (!names.has(exact(row.person))) names.set(exact(row.person), text(row.name))
  const who = await whoIs(base, [...names.keys()], on)
  return [...names].map(([person, name]) => ({ person, name, code: who.get(person)?.code ?? null, jobs: who.get(person)?.jobs ?? [] }))
    .filter(entry => { const hay = [entry.name, entry.code ?? '', ...entry.jobs].join(' ').toLowerCase(); return words.every(word => hay.includes(word)) })
    .sort((a, b) => a.name.localeCompare(b.name) || (a.code ?? '').localeCompare(b.code ?? ''))
    .slice(0, LIMIT)
}

async function describe(ctx: AccessContext, persons: string[], on: string): Promise<Person[]> {
  const names = await personNames(ctx, persons)
  const who = await whoIs(ctx.baseTables!, persons, on)
  // A name the tester can't read here is left blank: the platform, which knows every name, fills it in.
  return persons.map(person => ({ person, name: names.get(person) ?? '', code: who.get(person)?.code ?? null, jobs: who.get(person)?.jobs ?? [] }))
}
