// The coverage comparison, from the command line (data-warehouse #4438):
//
//   npm run compare -- --input fixtures/made-up-org-chart.json [--store 9901 ...] [--date YYYY-MM-DD] [--json]
//   FEATHERBASE_TOKEN=<System Manager token> npm run compare -- --url https://<instance> [--store ...]
//
// --input reads a snapshot file (compare.ts's Snapshot). --url reads a running
// instance over its API: the org chart Tables, the old Store Sections Tables
// (a Table the instance lacks reads as empty, as today's derivation treats
// it), each old employee code's current holders through the identifier
// search, and people's names. Without --store it compares every store either
// set of rows names; without --date, today in India Standard Time.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { compareStore, renderComparison, type Snapshot } from './compare.ts'
import { LEGACY_TABLES, type LegacyTables } from './legacy-derivation.ts'
import { text } from './values.ts'

type Row = Record<string, unknown>
const EMPLOYEE_CODE_SYSTEM = 'stylehr-employee-code'

function options(argv: string[]) {
  const out: { input?: string; url?: string; stores: string[]; date?: string; json: boolean } = { stores: [], json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${arg} needs a value`); return v }
    if (arg === '--input') out.input = value()
    else if (arg === '--url') out.url = value().replace(/\/+$/, '')
    else if (arg === '--store') out.stores.push(value())
    else if (arg === '--date') out.date = value()
    else if (arg === '--json') out.json = true
    else throw new Error(`Unknown argument ${arg}`)
  }
  if (!out.input === !out.url) throw new Error('Name exactly one of --input <file> and --url <instance>')
  if (out.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new Error('--date is a day, YYYY-MM-DD')
  return out
}

const FIELDS = {
  'feather_dash.store_rollout': ['store', 'live_since'],
  'feather_dash.store_floor': ['row_id', 'store', 'floor_name'],
  'feather_dash.department': ['row_id', 'store', 'department_key', 'name'],
  'feather_dash.section': ['row_id', 'store', 'section_name', 'floor', 'department', 'team_leaders_allowed'],
  'feather_dash.section_subcategory': ['row_id', 'store', 'subcategory', 'section', 'starts_on', 'ends_on'],
  'feather_dash.job_assignment': ['row_id', 'person', 'job', 'store', 'floor', 'department', 'section', 'reports_to', 'acting', 'starts_on', 'ends_on'],
  'feather_dash.section_alias': ['row_id', 'store', 'source', 'alias', 'section'],
  [LEGACY_TABLES.assignments]: ['row_id', 'employee', 'plant_code', 'store_label', 'material_group'],
  [LEGACY_TABLES.employeeSections]: ['row_id', 'store_code', 'employee_code', 'subcategory', 'section_name'],
  [LEGACY_TABLES.ownership]: ['row_id', 'store_code', 'section_name', 'tl_employee_code', 'dm_employee_code', 'effective_from'],
  [LEGACY_TABLES.storeManagers]: ['row_id', 'store_code', 'employee_code'],
  [LEGACY_TABLES.merchandise]: ['row_id', 'store_code', 'material_group', 'mch_subcategory', 'section_name'],
  [LEGACY_TABLES.aliases]: ['row_id', 'store_code', 'roster_section_name', 'merch_section_name'],
  Person: ['row_id', 'full_name', 'email'],
} as Record<string, string[]>

/** Reads a running instance as a System Manager, with `token`, over `fetchImpl`. */
export async function fromInstance(base: string, token: string, fetchImpl: typeof fetch = fetch): Promise<Snapshot> {
  const { version } = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }
  const get = async (path: string): Promise<{ status: number; body: any }> => {
    const response = await fetchImpl(`${base}${path}`, { headers: { authorization: `Bearer ${token}`, 'X-Featherbase-App-Version': `feather_dash@${version}` } })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const all = async (table: string, optional = false, fields = FIELDS[table]): Promise<Row[]> => {
    const rows: Row[] = []
    for (;;) {
      const query = new URLSearchParams({ fields: JSON.stringify(fields), order_by: 'row_id asc', limit_start: String(rows.length), limit_page_length: '500' })
      const { status, body } = await get(`/api/table/${encodeURIComponent(table)}?${query}`)
      if (status === 404 && optional) { console.error(`${table}: not on this instance; read as empty`); return [] }
      // Today's derivation reads dm_employee_code only where Section Ownership has it.
      if (status === 417 && table === LEGACY_TABLES.ownership && fields.includes('dm_employee_code') && /dm_employee_code/.test(JSON.stringify(body))) {
        console.error(`${table}: no dm_employee_code column; no Department Manager is derived from it`)
        return all(table, optional, fields.filter(f => f !== 'dm_employee_code'))
      }
      if (status !== 200) throw new Error(`${table}: HTTP ${status} ${JSON.stringify(body?.error ?? body)}`)
      rows.push(...body.data)
      if (body.data.length < 500) return rows
    }
  }
  const legacy = {} as LegacyTables
  for (const [key, table] of Object.entries(LEGACY_TABLES)) legacy[key as keyof LegacyTables] = await all(table, true)
  const snapshot: Snapshot = {
    rollout: await all('feather_dash.store_rollout'),
    chart: {
      floors: await all('feather_dash.store_floor'), departments: await all('feather_dash.department'),
      sections: await all('feather_dash.section'), placements: await all('feather_dash.section_subcategory'),
      jobs: await all('feather_dash.job_assignment'),
    },
    sectionAliases: await all('feather_dash.section_alias'),
    legacy, codeHolders: {}, people: {},
  }
  // Each code the old Tables name, and its current holders.
  const holdersOf = async (code: string): Promise<string[] | string> => {
    if (snapshot.codeHolders[code]) return snapshot.codeHolders[code]
    const { status, body } = await get(`/api/identifiers?${new URLSearchParams({ system: EMPLOYEE_CODE_SYSTEM, value: code })}`)
    if (status !== 200) return `HTTP ${status} ${body?.error?.message ?? ''}`.trim()
    // Holders by person_id, as the original counts them (never the person a holder was merged into).
    return (snapshot.codeHolders[code] = [...new Set((body.people as Row[]).filter(p => p.current === true).map(p => String(p.person_id)))].sort())
  }
  const codes = new Set([...legacy.employeeSections.map(r => r.employee_code), ...legacy.ownership.flatMap(r => [r.tl_employee_code, r.dm_employee_code]),
    ...legacy.storeManagers.map(r => r.employee_code)].filter(v => v != null).map(v => String(v).replace(/^ +| +$/g, '').toUpperCase()).filter(Boolean))
  for (const code of [...codes].sort()) {
    const holders = await holdersOf(code)
    if (typeof holders === 'string') throw new Error(`Employee code search: ${holders}`)
  }
  // Every person either rule could name gets their COMPLETE set of current
  // codes, each with its holders: a shared code the old Tables never mention
  // still gives that person nothing under the old rules (#408 D10). A person
  // whose codes cannot all be read is marked incomplete, never assumed clear.
  const people = new Set([...legacy.assignments.map(r => text(r.employee)), ...snapshot.chart.jobs.map(r => text(r.person)),
    ...Object.values(snapshot.codeHolders).flat()].filter(Boolean))
  const incomplete: Record<string, string> = {}
  const personCodes: Record<string, string[]> = {}
  for (const person of [...people].sort()) {
    const { status, body } = await get(`/api/people/${encodeURIComponent(person)}/identifiers`)
    if (status !== 200) { incomplete[person] = `their employee codes could not be read: HTTP ${status} ${body?.error?.message ?? ''}`.trim(); continue }
    // The person's current codes as stored: `value is not null and value <> ''`, never trimmed or re-cased.
    const rows = (body.identifiers as Row[]).filter(r => r.system === EMPLOYEE_CODE_SYSTEM && r.current === true)
    if (rows.some(r => r.value == null)) { incomplete[person] = 'a current employee code of theirs is not readable'; continue }
    personCodes[person] = [...new Set(rows.map(r => String(r.value)).filter(v => v !== ''))].sort()
    for (const code of personCodes[person]) {
      const holders = await holdersOf(code)
      if (typeof holders === 'string') { incomplete[person] = `the holders of one of their employee codes could not be read: ${holders}`; break }
      // The search and the person's own list must agree.
      if (!holders.includes(person)) snapshot.codeHolders[code] = [...holders, person].sort()
    }
  }
  snapshot.incomplete = incomplete
  snapshot.personCodes = personCodes
  for (const person of await all('Person')) snapshot.people[text(person.row_id)] = text(person.full_name) || text(person.email) || text(person.row_id)
  return snapshot
}

/** Every store either set of rows names. */
function storesOf(s: Snapshot): string[] {
  const { chart, legacy } = s
  return [...new Set([
    ...[s.rollout, chart.floors, chart.departments, chart.sections, chart.placements, chart.jobs, s.sectionAliases].flatMap(rows => rows.map(r => r.store)),
    ...legacy.assignments.map(r => r.plant_code),
    ...[legacy.employeeSections, legacy.ownership, legacy.storeManagers, legacy.merchandise, legacy.aliases].flatMap(rows => rows.map(r => r.store_code)),
  ].map(text).filter(Boolean))].sort()
}

export async function runCompare(argv: string[]): Promise<string> {
  const opts = options(argv)
  const token = process.env.FEATHERBASE_TOKEN
  if (opts.url && !token) throw new Error('Set FEATHERBASE_TOKEN to a System Manager access token')
  const snapshot: Snapshot = opts.input ? JSON.parse(await readFile(opts.input, 'utf8')) : await fromInstance(opts.url!, token!)
  const date = opts.date ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
  const results = (opts.stores.length ? opts.stores : storesOf(snapshot)).map(store => compareStore(store, snapshot, date))
  return opts.json ? JSON.stringify(results, null, 2) + '\n' : results.map(renderComparison).join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCompare(process.argv.slice(2)).then(out => process.stdout.write(out), (error: Error) => {
    console.error(error.message)
    process.exit(2)
  })
}
