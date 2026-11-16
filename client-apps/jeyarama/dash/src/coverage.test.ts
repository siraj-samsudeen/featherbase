// The edges of "what someone covers" (#1223), on the in-memory stand-in: each kind of job, the gaps it
// names, who may see it, and which of a page's records Dash opens. Main paths run on the real
// platform. Made-up stores and people only.
import { describe, expect, it } from 'vitest'
import { coverageReads } from './coverage.ts'
import { FALLBACK_ROLE } from './my-sections.ts'
import { assignment, context, job, sub, world, type Row } from './fake-context.test-support.ts'

const MDE = [FALLBACK_ROLE]
const run = (fn: (ctx: any) => Promise<unknown>, user: string, payload?: unknown, roles: string[] = [], tables = world()) =>
  fn(context(tables, { user, payload, roles }).ctx) as Promise<any>
const cover = (user: string, payload?: unknown, roles: string[] = [], tables = world()) => run(coverageReads.coverage, user, payload, roles, tables)

/** The store, with a second store, a cluster, more departments and jobs of every kind. */
function wide(): Record<string, Row[]> {
  const base = world()
  return {
    ...base,
    Site: [{ row_id: 'LKS', name: 'Lakeside', cluster: null }, { row_id: 'HIL', name: 'Hilltop', cluster: 'K1' }, { row_id: 'HOF', name: 'Head office', cluster: null }],
    Section: [...base.Section, { row_id: 'S5', name: 'Annex', site: 'LKS', floor: null, status: 'Active' }, { row_id: 'H1', name: 'Hill', site: 'HIL', floor: null, status: 'Active' }, { row_id: 'H2', name: 'Hill top', site: 'HIL', floor: null, status: 'Active' }],
    Cluster: [{ row_id: 'K2', cluster_manager: 'E-CL2' }],
    Department: [...base.Department,
      { row_id: 'D2', department_id: 'D2', store: 'LKS', name: '', manager: 'E-ST2', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'D3', department_id: 'D3', store: 'LKS', name: 'Mixed', manager: 'E-DM2', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'D4', department_id: 'D4', store: 'GONE', name: 'Gone', manager: null, starts_on: '2020-01-01', ends_on: '2020-12-31' }],
    'Department Section': [...base['Department Section'],
      { row_id: 'L3', store: 'LKS', department: 'D3', section: 'S3', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'L4', store: 'LKS', department: 'D3', section: 'S5', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'L5', store: 'LKS', department: 'D3', section: 'S4', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'L6', store: 'LKS', department: 'D3', section: 'H1', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'L7', store: 'LKS', department: 'D2', section: 'H1', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'L8', store: 'LKS', department: 'D2', section: 'H2', starts_on: '2026-01-01', ends_on: null }],
    Employee: [...base.Employee, ...['CL', 'CL2', 'CL3', 'DIR', 'HO', 'FM2', 'DM2', 'DM3'].map(code => ({ row_id: `E-${code}`, name: code === 'HO' ? '' : code, status: 'Current', person: code.toLowerCase() })),
      { row_id: 'E-NOSTAT', name: 'Nostat', status: '', person: 'nostat' }],
    'Job Assignment': [...base['Job Assignment'],
      job('J-CL', 'E-CL', 'Cluster Manager', { site: 'HIL', reports_to: 'E-DIR' }), job('J-CL2', 'E-CL2', 'Cluster Manager', { reports_to: 'E-DIR' }),
      job('J-CL3', 'E-CL3', 'Cluster Manager', { reports_to: 'E-DIR' }), job('J-DIR', 'E-DIR', 'Director', { site: 'HOF', reports_to: null }),
      job('J-HO', 'E-HO', 'Head office staff', { site: 'HOF', reports_to: 'E-DIR' }), job('J-FM2', 'E-FM2', 'Floor Manager', { reports_to: 'E-SM' }),
      job('J-FM3', 'E-FM2', 'Floor Manager', { floor: 'F9', reports_to: 'E-SM' }), job('J-DM2', 'E-DM2', 'Department Manager'), job('J-DM3', 'E-DM3', 'Department Manager'),
      job('J-STH', 'E-ST', 'Staff', { site: 'HIL', section: 'H1', reports_to: 'E-SM' })],
    'Store Floor': [...base['Store Floor'], { row_id: 'F9', name: 'Empty', site: 'LKS' }],
    'Section Subcategory': [...base['Section Subcategory'],
      { row_id: 'P6', store: 'LKS', section: 'S2', subcategory: 'C2', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'P7', store: 'LKS', section: 'S5', subcategory: 'C3', starts_on: '2026-01-01', ends_on: null }],
    Subcategory: [...base.Subcategory, ...Array.from({ length: 14 }, (_, n) => sub(`X${n}`, `Extra ${String(n).padStart(2, '0')}`, { category: 'CAT9' }))],
    'Merchandise Assignment': [...base['Merchandise Assignment'],
      assignment('M-X1', 'E-DIR', 'Category head', { category: 'CAT9' }), assignment('M-X2', 'E-DIR', 'Buyer'),
      assignment('M-X3', 'E-DIR', 'Buyer', { category: 'EMPTY' }), assignment('M-X4', 'E-DIR', 'Buyer', { subcategory: 'C1' }), assignment('M-X5', 'E-DIR', 'Buyer', { subcategory: 'C-GONE' })],
  }
}

describe('one section', () => {
  it('is not found, not allowed, or shown with its gaps', async () => {
    expect(await cover('sm', { section: 'S9' })).toEqual({ state: 'not_found' })
    expect(await cover('st', { section: 'S1' })).toEqual({ state: 'not_allowed' })
    const closed = await cover('sm', { section: 'S4' })
    expect(closed.section).toMatchObject({ active: false, floor: 'Ground', gaps: ['Closed', 'No subcategories'] })
    const counter = await cover('x', { section: 'S3' }, MDE)
    expect(counter.section).toMatchObject({ floor: null, floor_id: null, gaps: ['No Team Leader', 'No subcategories'] })
    const tables = world({ 'Section Subcategory': [...world()['Section Subcategory'], { row_id: 'P9', store: 'LKS', section: 'S1', subcategory: 'C9', starts_on: '2026-01-01', ends_on: null }],
      'Job Assignment': [...world()['Job Assignment'], job('J-ST5', 'E-ST2', 'Staff', { section: 'S1' })] })
    const ladies = await cover('sm', { section: 'S1' }, [], tables)
    expect(ladies.section.subcategories.map((s: { name: string }) => s.name)).toEqual(['Sarees', 'Unnamed subcategory'])
    expect(ladies.section.staff.map((s: { name: string; job: string }) => [s.job, s.name])).toEqual([['Staff', 'Sam'], ['Staff', 'Unnamed'], ['Team Leader', 'Tara']])
    expect(ladies.section.gaps).toEqual([])
  })
})

describe('one department', () => {
  it('is not found, not allowed, or shown with its sections and gaps', async () => {
    expect(await cover('sm', { department: 'D9' })).toEqual({ state: 'not_found' })
    expect(await cover('st', { department: 'D1' })).toEqual({ state: 'not_allowed' })
    const own = await cover('dm', { department: 'D1' })
    expect(own.department).toMatchObject({ name: 'Womens', manager: 'Devi', ended: false, gaps: [] })
    expect((await cover('x', { department: 'D1' }, MDE)).department.gaps).toEqual([])
    const t = wide()
    const unnamed = await cover('sm', { department: 'D2' }, [], t)
    expect(JSON.parse(JSON.stringify(unnamed.department))).toMatchObject({ name: 'Unnamed department', manager: null, manager_code: 'E-ST2', sections: [], gaps: ['2 linked sections belong to another store'] })
    const mixed = await cover('sm', { department: 'D3' }, [], t)
    expect(mixed.department.sections.map((s: { name: string }) => s.name)).toEqual(['Annex', 'Counter', 'Closed'])
    expect(mixed.department.gaps).toEqual(['Counter · no subcategories', 'Closed is closed', 'Closed · no subcategories', '1 linked section belongs to another store'])
    const gone = await cover('x', { department: 'D4' }, MDE, t)
    expect(gone.department).toMatchObject({ store: '', ended: true, gaps: ['No sections are linked to this department'] })
  })
})

describe("one person's coverage", () => {
  it('is not found without a person, or for a code nobody holds; someone outside your area is not allowed', async () => {
    expect(await cover('stranger', 'not an object')).toEqual({ state: 'not_found' })
    expect(await cover('sm', { employee: 'E-NONE' })).toEqual({ state: 'not_found' })
    expect(await cover('st', { employee: 'E-TL' })).toEqual({ state: 'not_allowed' })
  })

  it("your own, in full; a manager sees their staff's jobs inside their area only", async () => {
    const own = await cover('st')
    expect(own).toMatchObject({ own: true, area_only: false, employee: { code: 'E-ST' } })
    const t = wide()
    const seen = await cover('sm', { employee: 'E-ST' }, [], t)
    expect(seen.jobs.map((j: { job_id: string }) => j.job_id)).toEqual(['J-ST'])
    expect(seen).toMatchObject({ own: false, area_only: true })
  })

  it('names the gap each kind of job leaves', async () => {
    const t = wide()
    const gaps = async (code: string) => (await cover('x', { employee: code }, MDE, t)).jobs.map((j: { job: string; whole_store: boolean; gaps: string[] }) => [j.job, j.whole_store, j.gaps])
    expect(await gaps('E-ST2')).toEqual([['Staff', false, ['No section is set against this job']]])
    expect(await gaps('E-FM2')).toEqual([['Floor Manager', false, ['No floor is set against this job']], ['Floor Manager', false, ['No sections on this floor']]])
    expect(await gaps('E-DM3')).toEqual([['Department Manager', false, ['No department at this store names them as its manager']]])
    expect(await gaps('E-CL')).toEqual([['Cluster Manager', true, []]])
    expect(await gaps('E-CL2')).toEqual([['Cluster Manager', true, []], ['Named head of cluster K2', true, []]])
    expect(await gaps('E-CL3')).toEqual([['Cluster Manager', false, ['This site belongs to no cluster, and no cluster names them as its head']]])
    expect(await gaps('E-SM')).toEqual([['Store Manager', true, []]])
    expect((await gaps('E-HO'))[0]).toEqual(['Head office staff', false, ['A head-office job: it covers no section']])
    const fm = await cover('x', { employee: 'E-FM' }, MDE, t)
    expect(fm.jobs[0].sections.map((s: { name: string }) => s.name)).toEqual(['Closed', 'Ladies'])
    const staff = await cover('x', { employee: 'E-ST' }, MDE, t)
    expect(staff.section_ids).toMatchObject({ Ladies: 'S1', Hill: 'H1' })
  })

  it("a head's and buyer's merchandise: by the deepest level, at most twelve names, and the gaps", async () => {
    const director = await cover('x', { employee: 'E-DIR' }, MDE, wide())
    const lines = Object.fromEntries(director.merchandise.map((m: { assignment: string }) => [m.assignment, m]))
    expect(lines['M-X1']).toMatchObject({ level: 'category', named: 'CAT9', more: 2, gaps: [] })
    expect(lines['M-X1'].subcategories).toHaveLength(12)
    expect(lines['M-X2']).toMatchObject({ level: 'nothing', named: '', gaps: ['Names no division, category or subcategory'] })
    expect(lines['M-X3']).toMatchObject({ gaps: ['EMPTY · no subcategories'] })
    expect(lines['M-X4']).toMatchObject({ level: 'subcategory', named: 'Sarees' })
    expect(lines['M-X5']).toMatchObject({ level: 'subcategory', named: 'C-GONE', subcategories: [] })
    expect(director.gaps).toContain('Names no division, category or subcategory')
  })

  it("#1246: a buyer's Buyer Sections, each with its subcategories by name, and the gap of one that buys nothing", async () => {
    const desk = (row_id: string, operating_region: string | null) => ({ row_id, name: row_id, operating_region, buyer: 'E-BUY', category_head: 'E-CH', starts_on: '2026-01-01', ends_on: null })
    const tables = world({ 'Buyer Section': [desk('BS-E', 'East'), desk('BS-NONE', null)],
      'Buyer Section Subcategory': [{ row_id: 'L1', buyer_section: 'BS-E', subcategory: 'C2', starts_on: '2026-01-01', ends_on: null },
        { row_id: 'L2', buyer_section: 'BS-E', subcategory: 'C1', starts_on: '2026-01-01', ends_on: null }] })
    const lines = (await cover('x', { employee: 'E-BUY' }, MDE, tables)).merchandise.filter((m: { level: string }) => m.level === 'buyer_section')
    expect(lines).toEqual([
      expect.objectContaining({ named: 'BS-E', region: 'East', subcategories: [{ code: 'C1', name: 'Sarees' }, { code: 'C2', name: 'Silk' }], gaps: [] }),
      expect.objectContaining({ named: 'BS-NONE', region: null, subcategories: [], gaps: ['BS-NONE · no subcategories'] })])
  })

  it('someone who has left covers nothing, and says so, with or without a status', async () => {
    const left = await cover('x', { employee: 'E-GONE' }, MDE)
    expect(left).toMatchObject({ nothing: true, gaps: ['No longer on the staff list (Left): covers nothing'] })
    const nostat = await cover('x', { employee: 'E-NOSTAT' }, MDE, wide())
    expect(nostat.gaps).toEqual(['No longer on the staff list (no status): covers nothing'])
  })
})

describe('finding people to look up', () => {
  it('needs two letters; the master data team finds anyone current by name or code', async () => {
    expect(await run(coverageReads.coverage_people, 'sm')).toEqual([])
    const found = await run(coverageReads.coverage_people, 'x', { q: 'e-s' }, MDE)
    expect(found.map((p: { code: string }) => p.code)).toEqual(['E-SM', 'E-ST', 'E-ST2'])
    expect(found[0].line).toBe('E-SM · Store Manager · Lakeside')
    expect((await run(coverageReads.coverage_people, 'x', { q: 'nila' }, MDE))[0].line).toBe('E-NOJOB')
  })

  it("a manager finds themselves and their area's staff, each line naming only the jobs they may see; others find no one", async () => {
    const found = await run(coverageReads.coverage_people, 'sm', { q: 'sa' }, [], wide())
    expect(found).toEqual([{ code: 'E-ST', name: 'Sam', line: 'E-ST · Staff · Lakeside' }])
    expect((await run(coverageReads.coverage_people, 'sm', { q: 'e-' }, [], wide())).length).toBeGreaterThan(1)
    expect(await run(coverageReads.coverage_people, 'st2', { q: 'sa' })).toEqual([])
  })
})

describe("which of a page's records Dash opens", () => {
  it('none for a missing or oversized list; all for the master data team', async () => {
    expect(await run(coverageReads.dash_pages_open, 'sm')).toEqual([])
    expect(await run(coverageReads.dash_pages_open, 'sm', { refs: 'nonsense' })).toEqual([])
    expect(await run(coverageReads.dash_pages_open, 'sm', { refs: Array.from({ length: 201 }, () => ({ table: 'Section', id: 'S1' })) })).toEqual([])
    expect(await run(coverageReads.dash_pages_open, 'x', { refs: [{ table: 'Section', id: 'S1' }] }, MDE)).toEqual([true])
  })

  it("a manager opens their own staff, departments and sections; nothing else, and no other kind of record", async () => {
    const refs = [{ table: 'Employee', id: 'E-ST' }, { table: 'Employee', id: 'E-GONE' }, { table: 'Employee', id: 'E-SM' }, { table: 'Department', id: 'D1' }, { table: 'Department', id: 'D9' },
      { table: 'Department', id: 'D4' }, { table: 'Section', id: 'S2' }, { table: 'Section', id: 'H1' }, { table: 'Site', id: 'LKS' }]
    expect(await run(coverageReads.dash_pages_open, 'sm', { refs }, [], wide())).toEqual([true, false, true, true, false, false, true, false, false])
    expect(await run(coverageReads.dash_pages_open, 'st', { refs: [{ table: 'Section', id: 'S1' }] })).toEqual([false])
  })
})
