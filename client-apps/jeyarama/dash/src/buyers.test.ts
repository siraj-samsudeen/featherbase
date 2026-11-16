// #1246: the transition rule for who buys a subcategory. Made-up rows.
import { describe, expect, it } from 'vitest'
import { NO_BUYER_SECTIONS, buyerSources, openBuyerSections, rowAnswers, type BuyerSections } from './buyers'

const ma = (id: string, subcategory: string, region: string | null, employee = 'E-MA') => ({ row_id: id, employee, responsibility: 'Buyer', subcategory, operating_region: region })
const covers = (code: string) => (row: Record<string, unknown>) => row.subcategory === code
const open = (sections: [string, string, string | null][], links: [string, string][]): BuyerSections => ({
  sections: new Map(sections.map(([id, region, buyer]) => [id, { row_id: id, name: id, operating_region: region, buyer }])),
  links: links.map(([section, subcategory], i) => ({ row_id: `L${i}`, buyer_section: section, subcategory })),
})

describe('who buys a subcategory, while Buyer Sections are filled in', () => {
  it('with no Buyer Sections, answers exactly as Merchandise Assignment does today', () => {
    const rows = [ma('MA1', '010505003', 'Kerala'), ma('MA2', '010505003', 'Tamil Nadu'), ma('MA3', '010505001', 'Kerala')]
    expect(buyerSources('010505003', 'Kerala', NO_BUYER_SECTIONS, rows, covers('010505003'))).toEqual({ sections: [], assignments: [rows[0]] })
    expect(buyerSources('010505003', null, NO_BUYER_SECTIONS, rows, covers('010505003')).assignments).toEqual([rows[0], rows[1]])
  })

  it('takes the buyer from the Buyer Section that covers it, and no Merchandise Assignment row for that region', () => {
    const bs = open([['BS-KURTI', 'Kerala', 'E-5010']], [['BS-KURTI', '010505003']])
    const rows = [ma('MA1', '010505003', 'Kerala'), ma('MA2', '010505003', 'Tamil Nadu')]
    const kerala = buyerSources('010505003', 'Kerala', bs, rows, covers('010505003'))
    expect(kerala.sections.map(s => s.section.row_id)).toEqual(['BS-KURTI'])
    expect(kerala.assignments).toEqual([])
    // The other region has no Buyer Section yet: today's row still answers there.
    expect(buyerSources('010505003', 'Tamil Nadu', bs, rows, covers('010505003'))).toEqual({ sections: [], assignments: [rows[1]] })
    expect(buyerSources('010505003', null, bs, rows, covers('010505003')).assignments).toEqual([rows[1]])
  })

  it('a desk with no buyer yet still covers the subcategory: a vacancy, not a fallback', () => {
    const bs = open([['BS-EMPTY', 'Kerala', null]], [['BS-EMPTY', '010505003']])
    const result = buyerSources('010505003', 'Kerala', bs, [ma('MA1', '010505003', 'Kerala')], covers('010505003'))
    expect([result.sections.length, result.assignments]).toEqual([1, []])
  })

  it('a Merchandise Assignment row for both regions stops answering only in the regions a Buyer Section covers', () => {
    const both = ma('MA-BOTH', '010505003', null)
    const regions = ['Kerala', 'Tamil Nadu']
    expect(buyerSources('010505003', 'Kerala', NO_BUYER_SECTIONS, [both], covers('010505003'), regions).assignments).toEqual([both])
    const bs = open([['BS-KURTI', 'Kerala', 'E-5010']], [['BS-KURTI', '010505003']])
    expect(buyerSources('010505003', 'Kerala', bs, [both], covers('010505003'), regions).assignments).toEqual([])
    // Tamil Nadu has no desk: the row still answers there, and so for a head of every region.
    expect(buyerSources('010505003', 'Tamil Nadu', bs, [both], covers('010505003'), regions).assignments).toEqual([both])
    expect(buyerSources('010505003', null, bs, [both], covers('010505003'), regions).assignments).toEqual([both])
    // With a desk in each region, it answers nowhere.
    const each = open([['BS-K', 'Kerala', 'E1'], ['BS-T', 'Tamil Nadu', 'E2']], [['BS-K', '010505003'], ['BS-T', '010505003']])
    expect(rowAnswers(both, '010505003', null, each, regions)).toBe(false)
  })

  it('reads no Buyer Section while the instance lacks the Tables', async () => {
    const asked: string[] = []
    const ctx = { user: 'u', settings: {}, baseTables: { available: async () => false, list: async (table: string) => { asked.push(table); return [] } } }
    expect(await openBuyerSections(ctx as never, '2026-11-17')).toBe(NO_BUYER_SECTIONS)
    expect(asked).toEqual([])
    const old = { user: 'u', settings: {}, baseTables: { list: async (table: string) => { asked.push(table); return [] } } }
    expect(await openBuyerSections(old as never, '2026-11-17')).toBe(NO_BUYER_SECTIONS)
    expect(asked).toEqual([])
  })

  it('keeps only the desks and links open on the day (both ends inclusive)', async () => {
    const tables: Record<string, Record<string, unknown>[]> = {
      'Buyer Section': [{ row_id: 'A', starts_on: '2026-11-01', ends_on: null }, { row_id: 'B', starts_on: '2026-11-01', ends_on: '2026-11-16' }, { row_id: 'C', starts_on: '2026-11-17', ends_on: '2026-11-17' }],
      'Buyer Section Subcategory': [{ row_id: 'L1', buyer_section: 'A', subcategory: 'S1', starts_on: '2026-11-01' }, { row_id: 'L2', buyer_section: 'A', subcategory: 'S2', starts_on: '2026-11-18' },
        { row_id: 'L3', buyer_section: 'C', subcategory: 'S3', starts_on: '2026-11-17', ends_on: '2026-11-17' }],
    }
    const ctx = { user: 'u', settings: {}, baseTables: { available: async () => true, list: async (table: string, args: { limit_start?: number }) => (args.limit_start ? [] : tables[table]) } }
    const got = await openBuyerSections(ctx as never, '2026-11-17')
    expect([[...got.sections.keys()], got.links.map(l => l.row_id)]).toEqual([['A', 'C'], ['L1', 'L3']])
  })
})
