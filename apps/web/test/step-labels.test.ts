import { describe, expect, test } from 'vitest'
import type { ListFilter } from 'shared'
import type { TableMeta } from '../src/lib/meta'
import { filterRefs, filterText } from '../src/lib/step-labels'

// #910 checklist 11 and 22: a filter step is named for whoever is looking,
// never by the ids it filters on.

describe('filterText', () => {
  test("while the table's columns load, a value shows as a placeholder, never as itself", () => {
    expect(filterText('Nv Site', undefined, ['region', '=', 'KL'], () => 'Kerala (KL)')).toBe('region: …')
  })
})

// A group linked through a sub-table opens as a relationship filter
// (row-connections.ts): the visits whose lines name one site.
const throughLines: ListFilter = ['row_id', 'related', { via: 'Nv Visit Line', column: 'site', table: 'Nv Site', filters: [['row_id', '=', 'ENK']] }]
const visitMeta = { columns: [] } as unknown as TableMeta

describe('a relationship filter', () => {
  test('names the row it relates to, so its title is looked up', () => {
    expect(filterRefs('Nv Visit', visitMeta, throughLines)).toEqual([{ table: 'Nv Site', row_id: 'ENK' }])
  })

  test('reads as the related table and its row, never the id', () => {
    expect(filterText('Nv Visit', visitMeta, throughLines, () => 'Enchakkal (ENK)')).toBe('Nv Site: Enchakkal (ENK)')
  })
})
