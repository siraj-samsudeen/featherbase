// The edges of what a manager's area holds (#1223), on the in-memory stand-in. The main paths run
// through Your store and Your sections on the real platform.
import { describe, expect, it } from 'vitest'
import { areasFor, authorityRows, inArea, jobInArea, mayEditOwnSection, mayMove, movableIn, sectionAreaOf, sectionEditingAreas, type Area } from './areas.ts'
import { context, today } from './fake-context.test-support.ts'
import { ensureStartingRoles } from './switch-over.ts'

const sectionArea: Area = { kind: 'section', job: 'J1', site: 'LKS', floor: null, sections: new Set(['S1']), department: null }

describe('an area', () => {
  it('holds no section that is missing or at another store', () => {
    expect(inArea(sectionArea, undefined)).toBe(false)
    expect(inArea(sectionArea, { row_id: 'S1', site: 'HIL' })).toBe(false)
  })

  it('holds no job at another store', () => {
    expect(jobInArea(sectionArea, { site: 'HIL', section: 'S1' }, { row_id: 'S1', site: 'HIL' })).toBe(false)
  })

  it('a Department Manager whose departments have all ended has no department area', async () => {
    const { ctx } = context({
      'Job Assignment': [{ row_id: 'J1', employee: 'E1', job: 'Department Manager', site: 'LKS', starts_on: '2026-01-01', ends_on: null }],
      Department: [{ row_id: 'D1', store: 'LKS', name: 'Old', manager: 'E1', starts_on: '2020-01-01', ends_on: '2020-12-31' }],
    })
    expect(await areasFor(ctx, [{ row_id: 'E1' }], today)).toEqual([])
  })

  it("a Team Leader's area moves Staff only", () => {
    expect([movableIn(sectionArea, { job: 'Staff' }), movableIn(sectionArea, { job: 'Team Leader' })]).toEqual([true, false])
  })

  it('someone with no staff rows has no areas and no authority', async () => {
    const { ctx } = context({})
    expect(await areasFor(ctx, [], today)).toEqual([])
    expect(await authorityRows(ctx, 'nobody', 'LKS')).toEqual({ jobs: [], employees: [], departments: [], links: [] })
  })

  it('no one moves their own job, and no section means no area', async () => {
    const { ctx } = context({ Employee: [{ row_id: 'E1', person: 'sm', status: 'Current' }] })
    expect(await mayMove(ctx, 'sm', { row_id: 'J1', employee: 'E1' }, { row_id: 'S1', site: 'LKS' }, today)).toBe(false)
    expect(await sectionAreaOf(ctx, 'sm', undefined, today)).toBeUndefined()
  })
})

// #1277 (owner, 18-Nov-2026): under business roles, a manager edits a section's name and subcategories only where a
// role of theirs holding Edit Section names and subcategories comes from that very job.
describe('who may edit sections when business roles decide', () => {
  async function store(source: 'business_roles' | 'legacy' | null, hand: Record<string, unknown>[] = []) {
    const tables: Record<string, Record<string, unknown>[]> = {
      Employee: [{ row_id: 'E1', person: 'sm', status: 'Current' }],
      Section: [{ row_id: 'S1', site: 'LKS', floor: 'F1', name: 'Sarees' }, { row_id: 'S2', site: 'LKS', floor: 'F2', name: 'Silk' }],
      'Job Assignment': [{ row_id: 'J1', employee: 'E1', job: 'Store Manager', site: 'LKS', starts_on: '2026-01-01', ends_on: null }],
      'dash.business_role': [], 'dash.business_role_permission': [], 'dash.title_map': [], 'dash.role_assignment': hand,
      'dash.access_source': source ? [{ row_id: 'x', source }] : [],
    }
    let n = 0
    await ensureStartingRoles(context(tables).ctx.baseTables as never, { create: async (table: string, row: Record<string, unknown>) => { const saved = { row_id: `${table}-${++n}`, ...row }; tables[table].push(saved); return saved } })
    return { tables, ctx: context(tables).ctx, roleId: (name: string) => String(tables['dash.business_role'].find(r => r.role_name === name)!.row_id) }
  }
  const section = { row_id: 'S1', site: 'LKS', floor: 'F1' }

  it('lets a Store Manager by title edit their store\'s sections, under either rules', async () => {
    for (const source of ['business_roles', 'legacy', null] as const) expect((await sectionAreaOf((await store(source)).ctx, 'sm', section, today))?.kind).toBe('store')
  })

  it('takes it away when their role is corrected to one without the permission, only once business roles decide', async () => {
    const { tables, ctx, roleId } = await store('business_roles')
    tables['dash.role_assignment'].push({ row_id: 'h1', person: 'sm', change: 'Correct', business_role: roleId('Staff') })
    expect(await sectionAreaOf(ctx, 'sm', section, today)).toBeUndefined()
    tables['dash.access_source'][0].source = 'legacy'
    expect((await sectionAreaOf(ctx, 'sm', section, today))?.kind).toBe('store')
  })

  it('gives nothing at their own store when the role is corrected to apply at another store', async () => {
    const { tables, ctx, roleId } = await store('business_roles')
    tables['dash.role_assignment'].push({ row_id: 'h1', person: 'sm', change: 'Correct', business_role: roleId('Store Manager'), site: 'HIL' })
    expect(await sectionAreaOf(ctx, 'sm', section, today)).toBeUndefined()
  })

  // Codex standard round 2: the area is narrowed to the corrected role's reach, not kept whole.
  it('keeps no store-wide area for a Store Manager corrected to Floor Manager', async () => {
    const { tables, ctx, roleId } = await store('business_roles')
    tables['dash.role_assignment'].push({ row_id: 'h1', person: 'sm', change: 'Correct', business_role: roleId('Floor Manager') })
    expect(await sectionAreaOf(ctx, 'sm', section, today)).toBeUndefined()
  })

  // Codex round 2: Your sections' own changes ask the same permission.
  it('lets a job change its own section\'s subcategories only with a role that may edit sections, once business roles decide', async () => {
    const { tables, ctx, roleId } = await store('business_roles')
    tables['Job Assignment'][0] = { ...tables['Job Assignment'][0], job: 'Team Leader', section: 'S1' }
    const job = tables['Job Assignment'][0]
    expect(await mayEditOwnSection(ctx, 'sm', job, today)).toBe(true)
    tables['dash.role_assignment'].push({ row_id: 'h1', person: 'sm', change: 'Correct', business_role: roleId('Staff') })
    expect(await mayEditOwnSection(ctx, 'sm', job, today)).toBe(false)
    tables['dash.access_source'][0].source = 'legacy'
    expect(await mayEditOwnSection(ctx, 'sm', job, today)).toBe(true)
  })

  // Codex round 3: a role on the other axis keeps nothing; moves still follow the job.
  it('keeps no floor area for a Floor Manager corrected to Department Manager, and still lets them move staff', async () => {
    const { tables, ctx, roleId } = await store('business_roles')
    tables['Job Assignment'][0] = { ...tables['Job Assignment'][0], job: 'Floor Manager', floor: 'F1' }
    tables['dash.role_assignment'].push({ row_id: 'h1', person: 'sm', change: 'Correct', business_role: roleId('Department Manager') })
    expect(await sectionAreaOf(ctx, 'sm', section, today)).toBeUndefined()
    expect((await areasFor(ctx, tables.Employee, today)).map(a => a.kind)).toEqual(['floor'])
  })

  it('keeps of a Team Leader\'s sections only those whose job may edit sections', async () => {
    const { tables, ctx, roleId } = await store('business_roles')
    tables['Job Assignment'] = [
      { row_id: 'J1', employee: 'E1', job: 'Team Leader', site: 'LKS', section: 'S1', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'J2', employee: 'E1', job: 'Team Leader', site: 'LKS', section: 'S2', starts_on: '2026-01-01', ends_on: null },
    ]
    tables['dash.role_assignment'].push({ row_id: 'h1', person: 'sm', change: 'Correct', business_role: roleId('Staff'), site: null })
    // A Correct naming no place applies at each job: both now Staff, so neither section is theirs to edit.
    expect(await mayEditOwnSection(ctx, 'sm', tables['Job Assignment'][1], today)).toBe(false)
    tables['dash.role_assignment'].length = 0
    expect([await mayEditOwnSection(ctx, 'sm', tables['Job Assignment'][0], today), await mayEditOwnSection(ctx, 'sm', tables['Job Assignment'][1], today)]).toEqual([true, true])
  })

  it('narrows a Team Leader\'s grouped area to the sections of jobs whose title maps to a role that may edit', async () => {
    const { tables, ctx } = await store('business_roles')
    tables.Designation = [{ row_id: 'D-ST', designation: 'Staff' }]
    tables['Job Assignment'] = [
      { row_id: 'J1', employee: 'E1', job: 'Team Leader', site: 'LKS', section: 'S1', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'J2', employee: 'E1', job: 'Team Leader', designation: 'D-ST', site: 'LKS', section: 'S2', starts_on: '2026-01-01', ends_on: null },
    ]
    const areas = await sectionEditingAreas(ctx, tables.Employee, today)
    expect(areas.map(a => [a.kind, [...a.sections!]])).toEqual([['section', ['S1']]])
  })

  // Codex round 7: the role's own resolved area decides, not only its kind.
  it('gives a Team Leader corrected to Floor Manager, whose job names no floor, no section to edit', async () => {
    const { tables, ctx, roleId } = await store('business_roles')
    tables['Job Assignment'][0] = { ...tables['Job Assignment'][0], job: 'Team Leader', section: 'S1' }
    tables['dash.role_assignment'].push({ row_id: 'h1', person: 'sm', change: 'Correct', business_role: roleId('Floor Manager') })
    expect(await mayEditOwnSection(ctx, 'sm', tables['Job Assignment'][0], today)).toBe(false)
  })

  it('gives a Store Manager corrected to Department Manager, managing no department, no section', async () => {
    const { tables, ctx, roleId } = await store('business_roles')
    tables['dash.role_assignment'].push({ row_id: 'h1', person: 'sm', change: 'Correct', business_role: roleId('Department Manager') })
    expect(await sectionAreaOf(ctx, 'sm', section, today)).toBeUndefined()
  })

  it('narrows a Store Manager corrected to Floor Manager, whose job names floor F1, to that floor', async () => {
    const { tables, ctx, roleId } = await store('business_roles')
    tables['Job Assignment'][0] = { ...tables['Job Assignment'][0], floor: 'F1' }
    tables['dash.role_assignment'].push({ row_id: 'h1', person: 'sm', change: 'Correct', business_role: roleId('Floor Manager') })
    expect([(await sectionAreaOf(ctx, 'sm', section, today))?.kind, await sectionAreaOf(ctx, 'sm', { row_id: 'S2', site: 'LKS', floor: 'F2' }, today)]).toEqual(['floor', undefined])
  })
})

