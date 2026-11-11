import { describe, expect, test } from 'vitest'
import type { ListFilter } from 'shared'
import type { TableMeta } from '../src/lib/meta'
import { filterRefs, filterText } from '../src/lib/step-labels'

// #910 checklist 11 and 22: a filter step is named for whoever is looking,
// never by the ids it filters on.

describe('filterText', () => {
  test("while the table's columns load, a value shows as a placeholder, never as itself", () => {
    expect(filterText('Nv Site', undefined, ['region', '=', 'KL'], () => 'Kerala · KL')).toBe('region: …')
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
    expect(filterText('Nv Visit', visitMeta, throughLines, () => 'Enchakkal · ENK')).toBe('Nv Site: Enchakkal · ENK')
  })
})

const siteMeta = {
  columns: [
    { column_name: 'region', column_type: 'Data', label: 'Region' },
    { column_name: 'parent', column_type: 'Reference', reference_table: 'Nv Site', label: 'Parent' },
  ],
} as unknown as TableMeta

describe('a filter on an object value', () => {
  test('reads as the Table the object names', () => {
    expect(filterText('Nv Site', siteMeta, ['region', '!=', { table: 'Nv Zone' }], () => 'never')).toBe('Region != Nv Zone')
  })

  test('reads as nothing when the object names no Table', () => {
    expect(filterText('Nv Site', siteMeta, ['region', '!=', {}], () => 'never')).toBe('Region != ')
  })
})

describe('a filter step', () => {
  test('a relationship filter with no rows of its own reads as the related table alone', () => {
    expect(filterText('Nv Visit', visitMeta, ['row_id', 'related', { table: 'Nv Site' }], () => 'never')).toBe('Nv Site')
  })

  test('a negated relationship filter reads as not the related rows', () => {
    expect(filterText('Nv Visit', visitMeta, ['row_id', 'not related', { table: 'Nv Site', filters: [['row_id', '=', 'ENK']] }], () => 'Enchakkal · ENK'))
      .toBe('not Nv Site: Enchakkal · ENK')
  })

  test('a row id given as a number is still looked up by name', () => {
    expect(filterRefs('Nv Site', siteMeta, ['row_id', '=', 7])).toEqual([{ table: 'Nv Site', row_id: '7' }])
  })

  test('a comparison on a link column names no row and reads as written', () => {
    expect(filterText('Nv Site', siteMeta, ['parent', '>', 'ENK'], () => 'never')).toBe('Parent > ENK')
  })

  test('a list of plain values reads as the list', () => {
    expect(filterText('Nv Site', siteMeta, ['region', 'in', ['Kerala', 'Goa']], () => 'never')).toBe('Region in Kerala, Goa')
  })
})
