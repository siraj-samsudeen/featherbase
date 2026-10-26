import { expect, test } from 'vitest'
import { adminPathTitle, rowDisplayTitle } from '../src/index'

// Home cleanup: what a person reads for a row and for a fixed admin page.

const merchMap = {
  name: 'Section Merchandise Map',
  title_column: null,
  columns: [
    { column_name: 'store_code', column_type: 'Data' },
    { column_name: 'material_group', column_type: 'Data' },
    { column_name: 'mch_subcategory', column_type: 'Data' },
    { column_name: 'section_name', column_type: 'Data' },
  ],
}

test('a Table with a title column shows that column', () => {
  const meta = { ...merchMap, title_column: 'section_name' }
  expect(rowDisplayTitle(meta, { section_name: 'Kurti' }, '1517|040802006')).toBe('Kurti')
})

test('with no title column, a leading code is paired with the first name-like value', () => {
  const row = { store_code: '1517', material_group: '040802006', mch_subcategory: 'Kurti Z', section_name: 'Kurti' }
  expect(rowDisplayTitle(merchMap, row, '1517|040802006')).toBe('1517 · Kurti Z')
})

test('with no title column, a name-like first value stands alone', () => {
  const meta = { name: 'Customer', title_column: null, columns: [
    { column_name: 'customer_name', column_type: 'Data' },
    { column_name: 'city', column_type: 'Data' },
  ] }
  expect(rowDisplayTitle(meta, { customer_name: 'Acme Traders', city: 'Chennai' }, 'h4sh')).toBe('Acme Traders')
})

test('a row id shown as the title counts as no title column', () => {
  const row = { store_code: '1517', material_group: '040802006', mch_subcategory: 'Kurti Z' }
  expect(rowDisplayTitle({ ...merchMap, title_column: 'row_id' }, row, '1517|040802006')).toBe('1517 · Kurti Z')
})

test('hidden, layout and opaque-id values are skipped', () => {
  const meta = { name: 'Visit', title_column: null, columns: [
    { column_name: 'owner', column_type: 'Reference' },
    { column_name: 'notes_break', column_type: 'Section Break' },
    { column_name: 'secret', column_type: 'Data', hidden: true },
    { column_name: 'place', column_type: 'Data' },
  ] }
  const row = { owner: 'psn_abcdefghijklmnopqrst', secret: 'Hidden', place: 'Madurai' }
  expect(rowDisplayTitle(meta, row, 'V-1')).toBe('Madurai')
})

test('only codes: the first two are joined', () => {
  const row = { store_code: '1517', material_group: '040802006' }
  expect(rowDisplayTitle(merchMap, row, '1517|040802006')).toBe('1517 · 040802006')
})

test('nothing readable at all: the Table name and the key parts', () => {
  expect(rowDisplayTitle(merchMap, {}, '1517|040802006')).toBe('Section Merchandise Map · 1517 · 040802006')
})

test('a fixed admin page path reads as its title, whatever the query or slash', () => {
  expect(adminPathTitle('/featherbase/admin/explore')).toBe('Explore')
  expect(adminPathTitle('/featherbase/admin/explore/?root=Task')).toBe('Explore')
  expect(adminPathTitle('/featherbase/admin/access-tokens#top')).toBe('Access tokens')
  expect(adminPathTitle('/featherbase/admin/Task')).toBeUndefined()
  expect(adminPathTitle('/featherbase/admin/explore/extra')).toBeUndefined()
  expect(adminPathTitle(null)).toBeUndefined()
})
