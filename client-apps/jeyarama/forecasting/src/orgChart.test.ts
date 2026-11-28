import { describe, expect, it } from 'vitest'
import { orgChart } from './orgChart'

type Row = Record<string, unknown>
// a made-up store, Lakeside (LKS), in the region North
const TABLES: Record<string, Row[]> = {
  Site: [{ row_id: 'LKS', name: 'Lakeside', operating_region: 'North' }, { row_id: 'HLT', name: 'Hilltop', operating_region: 'North' }, { row_id: 'FAR', name: 'Faraway', operating_region: 'South' }],
  Section: [
    { row_id: 'LKS-1F-Girls', name: 'Girls', site: 'LKS', floor: 'LKS-1F', status: 'Active' },
    { row_id: 'LKS-GF-Saree', name: 'Saree', site: 'LKS', floor: 'LKS-GF', status: 'Active' },
    { row_id: 'LKS-GF-Old', name: 'Old', site: 'LKS', floor: 'LKS-GF', status: 'Closed' },
  ],
  'Store Floor': [{ row_id: 'LKS-1F', name: 'First Floor', site: 'LKS', floor_order: 1 }, { row_id: 'LKS-GF', name: 'Ground Floor', site: 'LKS', floor_order: 0 }],
  'Section Subcategory': [
    { store: 'LKS', subcategory: 'S1', section: 'LKS-1F-Girls', starts_on: '2026-11-06', ends_on: null },
    // S2 moved: its old row ended yesterday, its new row started today
    { store: 'LKS', subcategory: 'S2', section: 'LKS-GF-Saree', starts_on: '2026-11-06', ends_on: '2026-11-27' },
    { store: 'LKS', subcategory: 'S2', section: 'LKS-1F-Girls', starts_on: '2026-11-28', ends_on: null },
    // S3's row has not started yet
    { store: 'LKS', subcategory: 'S3', section: 'LKS-1F-Girls', starts_on: '2026-12-01', ends_on: null },
  ],
  Subcategory: [{ row_id: 'S1', category: 'Girls Bottom' }, { row_id: 'S2', category: 'Girls Bottom' }],
  'Job Assignment': [
    { employee: 'E1', job: 'Team Leader', site: 'LKS', section: 'LKS-1F-Girls', starts_on: '2026-01-01', ends_on: null },
    { employee: 'E2', job: 'Team Leader', site: 'LKS', section: 'LKS-1F-Girls', starts_on: '2026-01-01', ends_on: '2026-11-27' },
    { employee: 'E3', job: 'Store Manager', site: 'LKS', section: null, starts_on: '2026-01-01', ends_on: '2026-11-28' },
  ],
  Employee: [{ row_id: 'E1', name: 'Asha' }, { row_id: 'E2', name: 'Bina' }, { row_id: 'E3', name: 'Omar' }, { row_id: 'E4', name: 'Kavya' }, { row_id: 'E5', name: 'Ravi' }, { row_id: 'E6', name: 'Lena' }],
  'Merchandise Assignment': [
    { employee: 'E4', responsibility: 'Buyer', category: 'Girls Bottom', subcategory: 'S1', operating_region: 'North', starts_on: '2026-11-10', ends_on: null },
    { employee: 'E5', responsibility: 'Category head', category: 'Girls Bottom', subcategory: null, operating_region: 'North', starts_on: '2026-11-10', ends_on: null },
    { employee: 'E6', responsibility: 'Category head', category: 'Girls Bottom', subcategory: 'S2', operating_region: 'North', starts_on: '2026-11-10', ends_on: null },
    // ended today: its Ends On is the first day it no longer applies
    { employee: 'E6', responsibility: 'Buyer', category: 'Girls Bottom', subcategory: 'S2', operating_region: 'North', starts_on: '2026-11-10', ends_on: '2026-11-28' },
  ],
}
// like the platform's helper, it refuses a read while another is still running (reads are awaited one at a time)
let running = 0
const base = {
  // and, like it, serves at most 500 rows a page
  list: async (table: string, args: { filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number }) => {
    if (running++) throw new Error('Base Table and proposal helpers must be awaited one at a time inside the handler')
    await new Promise(r => setTimeout(r, 0))
    running--
    const start = args.limit_start ?? 0, size = Math.min(args.limit_page_length ?? 20, 500)
    return (TABLES[table] ?? []).filter(r => (args.filters ?? []).every(([c, op, v]) => (op === 'in' ? (v as unknown[]).includes(r[c]) : r[c] === v))).slice(start, start + size)
  },
}

describe('the live org chart (#1419)', () => {
  it("gives each subcategory today's section: the latest row that applies, none before its row starts", async () => {
    const org = await orgChart(base, 'LKS', '2026-11-28')
    expect(org.subcategories.S1.section).toBe('LKS-1F-Girls')
    expect(org.subcategories.S2.section).toBe('LKS-1F-Girls')
    expect(org.subcategories.S3).toBeUndefined()
  })

  it("puts each open section on its floor with today's Team Leaders; a job's Ends On is its last day", async () => {
    const org = await orgChart(base, 'LKS', '2026-11-28')
    expect(org.sections.map(s => [s.name, s.floor, s.floorOrder, s.teamLeaders])).toEqual([['Girls', 'First Floor', 1, ['Asha']], ['Saree', 'Ground Floor', 0, []]])
    expect(org.storeManagers).toEqual(['Omar'])
    expect(org.stores).toEqual({ LKS: 'Lakeside', HLT: 'Hilltop' })
    expect(org.people).toMatchObject({ Asha: 'E1', Omar: 'E3' })
    expect((await orgChart(base, 'LKS', '2026-11-27')).sections[0].teamLeaders).toEqual(['Asha', 'Bina'])
  })

  it("names the buyer and category head, the subcategory's own head over its category's; a merchandise row's Ends On is the first day it no longer applies", async () => {
    const org = await orgChart(base, 'LKS', '2026-11-28')
    expect(org.subcategories.S1).toMatchObject({ buyer: 'Kavya', categoryHead: 'Ravi' })
    expect(org.subcategories.S2).toMatchObject({ buyer: null, categoryHead: 'Lena' })
    expect((await orgChart(base, 'LKS', '2026-11-27')).subcategories.S2.buyer).toBe('Lena')
  })

  it('reads every page (the platform serves 500 rows a page) and takes dates as the database gives them, Date objects at UTC midnight', async () => {
    const saved = TABLES['Section Subcategory']
    // 600 earlier rows that ended, then S1's row today, its dates as Date objects
    TABLES['Section Subcategory'] = [
      ...Array.from({ length: 600 }, (_, i) => ({ store: 'LKS', subcategory: `OLD${i}`, section: 'LKS-GF-Saree', starts_on: new Date('2026-01-01T00:00:00Z'), ends_on: new Date('2026-02-01T00:00:00Z') })),
      { store: 'LKS', subcategory: 'S1', section: 'LKS-1F-Girls', starts_on: new Date('2026-11-06T00:00:00Z'), ends_on: null },
    ]
    try {
      const org = await orgChart(base, 'LKS', '2026-11-28')
      expect(org.subcategories.S1.section).toBe('LKS-1F-Girls')
      expect(org.subcategories.OLD0).toBeUndefined()
    } finally { TABLES['Section Subcategory'] = saved }
  })
})
