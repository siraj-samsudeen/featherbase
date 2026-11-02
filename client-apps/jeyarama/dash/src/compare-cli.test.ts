import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fromInstance, runCompare } from './compare-cli.ts'
import { compareStore } from './compare.ts'

const fixture = resolve(import.meta.dirname, '../fixtures/made-up-org-chart.json')

describe('npm run compare', () => {
  it('compares every store in a snapshot file', async () => {
    const out = await runCompare(['--input', fixture, '--date', '2026-10-15'])
    expect(out.match(/^Store \d{4} on 2026-10-15/gm)).toEqual(['Store 9901 on 2026-10-15', 'Store 9902 on 2026-10-15'])
  })

  it('compares a store that appears only in departments, and one only in the merchandise map', async () => {
    const snapshot = JSON.parse(await readFile(fixture, 'utf8'))
    snapshot.chart.departments.push({ row_id: 'd-only', store: '9903', department_key: 'dm-P-130', name: null })
    snapshot.legacy.merchandise.push({ store_code: '9904', material_group: '010505001', mch_subcategory: 'Caps', section_name: 'Caps' })
    const file = join(await mkdtemp(join(tmpdir(), 'b6p2-4438-')), 'snapshot.json')
    await writeFile(file, JSON.stringify(snapshot))
    const out = await runCompare(['--input', file, '--date', '2026-10-15'])
    expect(out.match(/^Store \d{4}/gm)).toEqual(['Store 9901', 'Store 9902', 'Store 9903', 'Store 9904'])
  })

  it('compares only the stores it is asked for', async () => {
    const out = await runCompare(['--input', fixture, '--date', '2026-10-15', '--store', '9902'])
    expect(out.match(/^Store \d{4}/gm)).toEqual(['Store 9902'])
  })

  it('answers JSON when asked', async () => {
    const out = JSON.parse(await runCompare(['--input', fixture, '--date', '2026-10-15', '--store', '9901', '--json']))
    expect(out[0]).toMatchObject({ store: '9901', date: '2026-10-15' })
  })

  it('refuses a date that is not a calendar day', async () => {
    await expect(runCompare(['--input', fixture, '--date', '15/10/2026'])).rejects.toThrow(/YYYY-MM-DD/)
  })
})

// --url over a stand-in instance: the HTTP API is the system boundary. Made-up rows.
type Row = Record<string, unknown>
interface FakeInstance {
  tables: Record<string, Row[]>
  /** Each person's identifier rows, as GET /api/people/:id/identifiers answers them. */
  identifiers: Record<string, Row[]>
  refuse?: string[]
  /** People merged into another (the search answers the survivor as resolved_to). */
  mergedInto?: Record<string, string>
  /** Columns a Table lacks: a list naming one is refused, as the platform refuses it. */
  missing?: Record<string, string[]>
}
function fakeFetch(instance: FakeInstance): typeof fetch {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  return (async (input: string | URL) => {
    const url = new URL(String(input))
    const table = /^\/api\/table\/([^/]+)$/.exec(url.pathname)
    if (table) {
      const rows = instance.tables[decodeURIComponent(table[1])]
      if (!rows) return json(404, { error: { type: 'NotFoundError' } })
      const asked = JSON.parse(url.searchParams.get('fields') ?? '[]') as string[]
      const lacking = (instance.missing?.[decodeURIComponent(table[1])] ?? []).find(c => asked.includes(c))
      if (lacking) return json(417, { error: { type: 'ValidationError', message: `Unknown column ${lacking}` } })
      const start = Number(url.searchParams.get('limit_start') ?? 0)
      return json(200, { data: rows.slice(start, start + 500) })
    }
    const person = /^\/api\/people\/([^/]+)\/identifiers$/.exec(url.pathname)
    if (person) {
      if (instance.refuse?.includes(person[1])) return json(403, { error: { type: 'PermissionError', message: 'Not permitted' } })
      return json(200, { identifiers: instance.identifiers[person[1]] ?? [], addable: [] })
    }
    if (url.pathname === '/api/identifiers') {
      const value = url.searchParams.get('value')
      const people = Object.entries(instance.identifiers).flatMap(([id, rows]) =>
        rows.filter(r => r.system === url.searchParams.get('system') && r.value === value && r.current)
          .map(() => ({ person_id: id, resolved_to: instance.mergedInto?.[id] ?? id, current: true })))
      return json(200, { people })
    }
    return json(404, {})
  }) as typeof fetch
}
const code = (value: string) => ({ system: 'stylehr-employee-code', value, current: true })

/** Lakeside (9901) not live; psn_301 leads Sarees on the new chart. */
function lakeside(extra: Partial<FakeInstance> = {}): FakeInstance {
  return {
    tables: {
      'feather_dash.store_rollout': [], 'feather_dash.store_floor': [], 'feather_dash.department': [], 'feather_dash.section_alias': [],
      'feather_dash.section': [{ row_id: 's-sarees', store: '9901', section_name: 'Sarees', team_leaders_allowed: 1 }],
      'feather_dash.section_subcategory': [{ row_id: 'p1', store: '9901', subcategory: '010101001', section: 's-sarees', starts_on: '2026-01-01' }],
      'feather_dash.job_assignment': [{ row_id: 'j1', person: 'psn_301', job: 'Team Leader', store: '9901', section: 's-sarees', starts_on: '2026-07-01' }],
      'Sales Target Assignment': [], 'Employee Section Map': [], 'Section Ownership': [], 'Store Manager': [], 'Section Name Alias': [],
      'Section Merchandise Map': [{ row_id: 'm1', store_code: '9901', material_group: '010101001', mch_subcategory: 'Saree', section_name: 'Sarees' }],
      Person: [{ row_id: 'psn_301', full_name: 'P-301' }, { row_id: 'psn_302', full_name: 'P-302' }],
    },
    identifiers: {},
    ...extra,
  }
}
const ambiguousReason = 'new: Team Leader of Sarees; old: an employee code of theirs is current on someone else too, so the old rules give them nothing'

describe('npm run compare --url', () => {
  it("resolves an assignment-only person's own codes, so a shared code denies their old access", async () => {
    const instance = lakeside({ identifiers: { psn_301: [code('EMP-0300')], psn_302: [code('EMP-0300')] } })
    instance.tables['Sales Target Assignment'] = [{ row_id: 'a1', employee: 'psn_301', plant_code: '9901', material_group: '010101001' }]
    const snapshot = await fromInstance('http://instance.test', 'token', fakeFetch(instance))
    const [person] = compareStore('9901', snapshot, '2026-10-15').people.filter(p => p.person === 'psn_301')
    expect([person.old.subcategories, person.added.map(d => d.reason)]).toEqual([[], [ambiguousReason]])
  })

  it("resolves a mapped person's additional codes, so a shared one denies their old access", async () => {
    const instance = lakeside({ identifiers: { psn_301: [code('EMP-0301'), code('EMP-0399')], psn_302: [code('EMP-0399')] } })
    instance.tables['Section Ownership'] = [{ row_id: 'o1', store_code: '9901', section_name: 'Sarees', tl_employee_code: 'EMP-0301', dm_employee_code: '', effective_from: '' }]
    const snapshot = await fromInstance('http://instance.test', 'token', fakeFetch(instance))
    const [person] = compareStore('9901', snapshot, '2026-10-15').people.filter(p => p.person === 'psn_301')
    expect([person.old.subcategories, person.added.map(d => d.reason)]).toEqual([[], [ambiguousReason]])
  })

  it('marks a person whose identifiers cannot be read as incomplete, and asserts no old coverage for them', async () => {
    const instance = lakeside({ identifiers: { psn_301: [code('EMP-0301')] }, refuse: ['psn_301'] })
    instance.tables['Section Ownership'] = [{ row_id: 'o1', store_code: '9901', section_name: 'Sarees', tl_employee_code: 'EMP-0301', dm_employee_code: '', effective_from: '' }]
    const snapshot = await fromInstance('http://instance.test', 'token', fakeFetch(instance))
    const [person] = compareStore('9901', snapshot, '2026-10-15').people.filter(p => p.person === 'psn_301')
    expect(person).toMatchObject({ incomplete: "their employee codes could not be read: HTTP 403 Not permitted", old: { subcategories: [] }, added: [], removed: [], widened: null })
  })

  it("matches a person's codes as stored: a lower-case identifier never matches an upper-cased table code", async () => {
    const instance = lakeside({ identifiers: { psn_301: [code('emp-0301')] } })
    instance.tables['Section Ownership'] = [{ row_id: 'o1', store_code: '9901', section_name: 'Sarees', tl_employee_code: 'EMP-0301', dm_employee_code: '', effective_from: '' }]
    const snapshot = await fromInstance('http://instance.test', 'token', fakeFetch(instance))
    const [person] = compareStore('9901', snapshot, '2026-10-15').people.filter(p => p.person === 'psn_301')
    expect(person.old.subcategories).toEqual([])
  })

  it('counts the holders of a code by person, as the original does, even when one was merged into the other', async () => {
    const instance = lakeside({ identifiers: { psn_301: [code('EMP-0300')], psn_302: [code('EMP-0300')] }, mergedInto: { psn_302: 'psn_301' } })
    instance.tables['Sales Target Assignment'] = [{ row_id: 'a1', employee: 'psn_301', plant_code: '9901', material_group: '010101001' }]
    const snapshot = await fromInstance('http://instance.test', 'token', fakeFetch(instance))
    const [person] = compareStore('9901', snapshot, '2026-10-15').people.filter(p => p.person === 'psn_301')
    expect([person.old.subcategories, person.added.map(d => d.reason)]).toEqual([[], [ambiguousReason]])
  })

  it('reads Section Ownership without dm_employee_code where the Table lacks it, as the original then derives no manager', async () => {
    const instance = lakeside({ identifiers: { psn_301: [code('EMP-0301')] }, missing: { 'Section Ownership': ['dm_employee_code'] } })
    instance.tables['Section Ownership'] = [{ row_id: 'o1', store_code: '9901', section_name: 'Sarees', tl_employee_code: 'EMP-0301', effective_from: '' }]
    const snapshot = await fromInstance('http://instance.test', 'token', fakeFetch(instance))
    const [person] = compareStore('9901', snapshot, '2026-10-15').people.filter(p => p.person === 'psn_301')
    expect(person.old).toEqual({ subcategories: ['010101001'], basis: ['team_leader'] })
  })
})

