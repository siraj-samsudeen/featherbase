import { describe, expect, it } from 'vitest'
import { assignPrefill, newRowId } from './UnassignedPage'

describe("Assign section prefills the org chart's new row (#1419)", () => {
  it('takes the first free id: <store>-<code>-<starts on>, then -2, -3', () => {
    expect(newRowId('LKS', 'MS-101', '2026-11-27')).toBe('LKS-MS-101-2026-11-27')
    expect(newRowId('LKS', 'MS-101', '2026-11-27', ['LKS-MS-101-2026-11-27', 'LKS-MS-101-2026-11-27-2'])).toBe('LKS-MS-101-2026-11-27-3')
  })
  it('fills store, subcategory, id, the suggested section, starts on and source', () => {
    expect(assignPrefill('LKS', { code: 'MS-101', suggestedSection: 'LKS-2F-Casual Shirt', sectionRowIds: ['LKS-MS-101-2026-11-27'] }, '2026-11-27')).toEqual({
      store: 'LKS', subcategory: 'MS-101', section_subcategory_id: 'LKS-MS-101-2026-11-27-2', section: 'LKS-2F-Casual Shirt',
      starts_on: '2026-11-27', source_key: 'Forecasting No Section page, 27-Nov-2026' })
  })
  it('leaves Section blank when nothing suggests one', () => {
    expect(assignPrefill('LKS', { code: 'MS-102' }, '2026-11-27')).not.toHaveProperty('section')
  })
})
