// #1282 A4: a Table's default view, layered between the Table's list columns and a person's own choices, and
// named in words in the confirm before a System Manager saves it. Made-up names.
import { describe, expect, test } from 'vitest'
import type { TableMeta } from '../src/lib/meta'
import { describeView, listDefaultsWith, viewAsDefault } from '../src/lib/table-view-default'

const meta = {
  name: 'Tvd Section', title_column: 'section_name', id_pattern: 'hash', sort_column: 'updated_at', sort_order: 'desc',
  columns: [
    { column_name: 'section_name', label: 'Name', column_type: 'Data', in_list_view: true },
    { column_name: 'site', label: 'Site', column_type: 'Data', in_list_view: true },
    { column_name: 'status', label: 'Status', column_type: 'Data', in_list_view: false },
    { column_name: 'opened_on', label: 'Age', column_type: 'Date', in_list_view: false },
    { column_name: 'floor', label: 'Floor', column_type: 'Int', in_list_view: false },
  ],
} as unknown as TableMeta

describe("#1282 A4: a Table's default view", () => {
  test("the Table's default switches columns on and off on top of its list columns", () => {
    expect([...listDefaultsWith(meta, { shownCols: ['status'], hiddenCols: ['site'] })].sort()).toEqual(['section_name', 'status'])
    expect([...listDefaultsWith(meta, {})].sort()).toEqual(['section_name', 'site'])
  })

  test("a manager's view is saved as columns switched on and off against the Table's own list columns", () => {
    // Their view shows Status and hides Site, made over a default that had already hidden Site.
    const saved = viewAsDefault(meta, { shownCols: ['status'], hiddenCols: [] }, { hiddenCols: ['site'] },
      { layout: 'split', sort: { field: 'opened_on', dir: 'asc' }, compact: true, links: { as: 'sections', fields: true } })
    expect(saved).toEqual({ layout: 'split', shownCols: ['status'], hiddenCols: ['site'], sort: { field: 'opened_on', dir: 'asc' }, compact: true, links: { as: 'sections', fields: true } })
  })

  test('the confirm names each setting in words', () => {
    expect(describeView(meta, { layout: 'split', shownCols: ['status'], hiddenCols: [], sort: { field: 'opened_on', dir: 'asc' }, compact: true, links: { as: 'sections', fields: true } }))
      .toEqual(['List And Record', 'Columns: Name, Site, Status', 'Sorted by Age, oldest first', 'Compact rows', 'Links: Sections', 'Fields beside links'])
    expect(describeView(meta, { layout: 'panel', sort: { field: 'floor', dir: 'desc' }, compact: false, links: { as: 'tree', fields: false } }))
      .toEqual(['Table With Panel', 'Columns: Name, Site', 'Sorted by Floor, largest first', 'Full rows', 'Links: Tree', 'No fields beside links'])
    expect(describeView(meta, { layout: 'table', sort: { field: 'section_name', dir: 'asc' } })[2]).toBe('Sorted by Name, A to Z')
    // No sort of their own: the Table's own order.
    expect(describeView(meta, { layout: 'table', sort: null })[2]).toBe('Sorted as the Table is')
  })
})
