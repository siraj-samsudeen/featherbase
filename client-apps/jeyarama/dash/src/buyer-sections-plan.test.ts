// #1246: planning the first Buyer Sections from today's Buyer rows. Made-up rows in production's shape.
import { describe, expect, it } from 'vitest'
import { planBuyerSections, toCsv } from './buyer-sections-plan'

const TODAY = '2026-11-17'
const sub = (row_id: string, subcategory: string, category: string, subdivision = 'Womenswear', type = 'Merchandise') => ({ row_id, subcategory, category, subdivision, subcategory_type: type })
const buyer = (subcategory: string, employee: string | null, region = 'Kerala', extra: object = {}) =>
  ({ row_id: `KL-Buyer-${subcategory}`, responsibility: 'Buyer', employee, subcategory, operating_region: region, starts_on: '2026-11-10', ...extra })
const head = (category: string, employee: string, extra: object = {}) =>
  ({ row_id: `KL-Head-${category}`, responsibility: 'Category head', employee, category, operating_region: 'Kerala', starts_on: '2026-11-10', ...extra })
const SUBS = [sub('010505003', 'Women Kurti', 'Women Ethnic Wear'), sub('010505001', 'Churidar', 'Women Ethnic Wear'), sub('010503001', 'Women Top', 'Women Top'),
  sub('010505002', 'Women Dupatta', 'Women Ethnic Wear'), sub('990000001', 'Carry bag', 'Packing', 'Other', 'Consumable')]
const PEOPLE = [{ row_id: 'KL-1', name: 'Kurti Buyer' }, { row_id: 'KL-2', name: 'Salwar Buyer' }, { row_id: 'KL-H', name: 'Ethnic Head' }]

describe('planning Buyer Sections from Buyer rows', () => {
  it('makes one Buyer Section per region, buyer and category head, named for what it buys', () => {
    const { lines, summary } = planBuyerSections({ subcategories: SUBS, employees: PEOPLE, assignments: [
      head('Women Ethnic Wear', 'KL-H'), head('Women Top', 'KL-H'),
      buyer('010505003', 'KL-1'), buyer('010505001', 'KL-2'), buyer('010503001', 'KL-2')] }, TODAY)
    expect(lines.map(l => [l.buyer_section_id, l.buyer_name, l.category_head_name, l.subcategory_name])).toEqual([
      ['KL-Women Ethnic Wear', 'Kurti Buyer', 'Ethnic Head', 'Women Kurti'],
      ['KL-Women Ethnic Wear and Women Top', 'Salwar Buyer', 'Ethnic Head', 'Churidar'],
      ['KL-Women Ethnic Wear and Women Top', 'Salwar Buyer', 'Ethnic Head', 'Women Top']])
    expect(summary).toMatchObject({ sections: 2, vacant_sections: 0, subcategories_placed: 3, no_buyer: { Kerala: 1 } })
  })

  it('keeps a vacancy per category, and names a clashing Buyer Section name by its buyer', () => {
    const { lines, summary } = planBuyerSections({ subcategories: SUBS, employees: PEOPLE, assignments: [
      buyer('010505003', 'KL-1'), buyer('010505002', null), buyer('010505001', 'KL-2')] }, TODAY)
    expect([...new Set(lines.map(l => l.buyer_section))]).toEqual(['Women Ethnic Wear', 'Women Ethnic Wear (Salwar Buyer)', 'Women Ethnic Wear (no buyer yet)'])
    expect(summary).toMatchObject({ sections: 3, vacant_sections: 1 })
  })

  it('leaves out ended rows, lists wider rows and second buyers, and guesses no head between two', () => {
    const { lines, summary } = planBuyerSections({ subcategories: SUBS, employees: PEOPLE, assignments: [
      buyer('010505003', 'KL-1', 'Kerala', { ends_on: '2026-11-16' }),
      buyer('010505001', 'KL-2'), { ...buyer('010505001', 'KL-1'), row_id: 'KL-Buyer-010505001-b' },
      { row_id: 'KL-Buyer-Ethnic', responsibility: 'Buyer', employee: 'KL-2', category: 'Women Ethnic Wear', operating_region: 'Kerala', starts_on: '2026-11-10' },
      head('Women Ethnic Wear', 'KL-H'), { ...head('Women Ethnic Wear', 'KL-1'), row_id: 'KL-Head-2' }] }, TODAY)
    expect(lines.map(l => [l.subcategory_code, l.buyer_code, l.category_head_code])).toEqual([['010505001', 'KL-2', '']])
    expect(summary.wider_buyer_rows).toEqual(['KL-Buyer-Ethnic'])
    expect(summary.two_buyers).toEqual(['010505001 in Kerala: KL-Buyer-010505001 and KL-Buyer-010505001-b'])
    expect(summary.two_heads).toEqual(['010505001 in Kerala'])
  })

  it('writes a CSV a spreadsheet opens, quoting what needs it', () => {
    const { lines } = planBuyerSections({ subcategories: [sub('1', 'Lehanga, Gowns', 'Women "Lehanga"')], employees: [], assignments: [buyer('1', '')] }, TODAY)
    expect(toCsv(lines).split('\n')[1]).toBe('"KL-Women ""Lehanga""","Women ""Lehanga""",Kerala,,,,,1,"Lehanga, Gowns","Women ""Lehanga""",KL-Buyer-1')
  })

  it('expands a Buyer row for every region into a Buyer Section per region, with each region\'s head (Codex)', () => {
    const { lines, summary } = planBuyerSections({ subcategories: SUBS, employees: PEOPLE, regions: ['Kerala', 'Tamil Nadu'], assignments: [
      head('Women Ethnic Wear', 'KL-H'), buyer('010505003', 'KL-1', null as never)] }, TODAY)
    expect(lines.map(l => [l.buyer_section_id, l.region, l.category_head_code, l.subcategory_code])).toEqual([
      ['KL-Women Ethnic Wear', 'Kerala', 'KL-H', '010505003'], ['TN-Women Ethnic Wear', 'Tamil Nadu', '', '010505003']])
    expect(summary.no_buyer).toEqual({ Kerala: 3, 'Tamil Nadu': 3 })
  })

  it('leaves a Buyer row for every region unplanned when the instance names no region', () => {
    const { lines, summary } = planBuyerSections({ subcategories: SUBS, employees: PEOPLE, assignments: [buyer('010505003', 'KL-1', null as never)] }, TODAY)
    expect(lines).toEqual([])
    expect(summary.wider_buyer_rows).toEqual(['KL-Buyer-010505003'])
  })

  it('gives two buyers with the same name distinct Buyer Sections, by their codes (Codex)', () => {
    const people = [{ row_id: 'KL-A', name: 'Anu' }, { row_id: 'KL-R1', name: 'Ravi' }, { row_id: 'KL-R2', name: 'Ravi' }]
    const { lines, summary } = planBuyerSections({ subcategories: SUBS, employees: people, assignments: [
      buyer('010505003', 'KL-A'), buyer('010505001', 'KL-R1'), buyer('010505002', 'KL-R2')] }, TODAY)
    const ids = [...new Set(lines.map(l => l.buyer_section_id))]
    expect(ids).toHaveLength(3)
    expect(summary.sections).toBe(3)
    expect(Object.fromEntries(lines.map(l => [l.buyer_code, l.buyer_section_id]))).toEqual({
      'KL-A': 'KL-Women Ethnic Wear', 'KL-R1': 'KL-Women Ethnic Wear (Ravi, KL-R1)', 'KL-R2': 'KL-Women Ethnic Wear (Ravi, KL-R2)' })
  })
})

