// #738 (list-columns-from-the-table, Decision 1): a person's view of a list
// is two sets on top of the Table's list columns —
//   Row ID + (list columns ∪ shownCols) − hiddenCols, in the Table's column order.
import { describe, expect, it } from 'vitest'
import type { ColumnDef, TableMeta } from '../src/lib/meta'
import { switchColumn, viewColumns } from '../src/lib/list-view-columns'

function column(column_name: string, extra: Partial<ColumnDef> = {}): ColumnDef {
  return {
    column_name,
    label: column_name[0].toUpperCase() + column_name.slice(1),
    column_type: 'Data',
    in_list_view: false,
    hidden: false,
    tier: 'basic',
    ...extra,
  } as ColumnDef
}

/** Section, MCH and Floor in the list; Remarks and Notes not. */
function sectionMapping(extra: Partial<TableMeta> = {}): TableMeta {
  return {
    name: 'Section Mapping',
    columns: [
      column('section', { in_list_view: true }),
      column('mch', { in_list_view: true }),
      column('floor', { in_list_view: true }),
      column('remarks'),
      column('notes'),
    ],
    ...extra,
  } as TableMeta
}

const names = (cols: { column_name: string }[]) => cols.map((c) => c.column_name)

describe('viewColumns', () => {
  it('shows a column switched on in the Table\'s column order, not at the end', () => {
    const view = viewColumns(sectionMapping({
      columns: [column('remarks'), ...sectionMapping().columns.filter((c) => c.column_name !== 'remarks')],
    }), { shownCols: ['remarks'], hiddenCols: [] })
    expect(names(view)).toEqual(['row_id', 'remarks', 'section', 'mch', 'floor'])
  })

  it('leaves out a list column switched off', () => {
    const view = viewColumns(sectionMapping(), { shownCols: [], hiddenCols: ['mch'] })
    expect(names(view)).toEqual(['row_id', 'section', 'floor'])
  })

  it('keeps Row ID first even when an arrangement hid it', () => {
    const view = viewColumns(sectionMapping(), { shownCols: [], hiddenCols: ['row_id', 'section', 'mch', 'floor'] })
    expect(names(view)).toEqual(['row_id'])
  })

  it('ignores a column the Table no longer has', () => {
    const view = viewColumns(sectionMapping(), { shownCols: ['gone'], hiddenCols: [] })
    expect(names(view)).toEqual(['row_id', 'section', 'mch', 'floor'])
  })

  it('reads an arrangement saved before shown columns existed as it read then', () => {
    const view = viewColumns(sectionMapping(), { hiddenCols: ['floor'] })
    expect(names(view)).toEqual(['row_id', 'section', 'mch'])
  })
})

describe('switchColumn', () => {
  it('switching on a column not in the list adds it to shown', () => {
    expect(switchColumn(sectionMapping(), { shownCols: [], hiddenCols: [] }, 'remarks', true))
      .toEqual({ shownCols: ['remarks'], hiddenCols: [] })
  })

  it('switching on a hidden list column only takes it out of hidden', () => {
    expect(switchColumn(sectionMapping(), { shownCols: [], hiddenCols: ['floor'] }, 'floor', true))
      .toEqual({ shownCols: [], hiddenCols: [] })
  })

  it('switching off a list column adds it to hidden', () => {
    expect(switchColumn(sectionMapping(), { hiddenCols: [] }, 'floor', false))
      .toEqual({ shownCols: [], hiddenCols: ['floor'] })
  })

  it('switching off a column switched on only takes it out of shown', () => {
    expect(switchColumn(sectionMapping(), { shownCols: ['remarks'], hiddenCols: [] }, 'remarks', false))
      .toEqual({ shownCols: [], hiddenCols: [] })
  })
})
