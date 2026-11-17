// The edges of what a manager's area holds (#1223), on the in-memory stand-in. The main paths run
// through Your store and Your sections on the real platform.
import { describe, expect, it } from 'vitest'
import { areasFor, authorityRows, inArea, jobInArea, mayMove, movableIn, sectionAreaOf, type Area } from './areas.ts'
import { context, today } from './fake-context.test-support.ts'

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
