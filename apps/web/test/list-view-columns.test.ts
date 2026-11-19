// #738 (list-columns-from-the-table, Decision 1): a person's view of a list
// is two sets on top of the Table's list columns —
//   Row ID + (list columns ∪ shownCols) − hiddenCols, in the Table's column order.
import { describe, expect, it } from 'vitest'
import type { ColumnDef, TableMeta } from '../src/lib/meta'
import { dataColumns, listFields, switchColumn, viewColumns } from '../src/lib/list-view-columns'
import { listDefaultsWith, viewAsDefault } from '../src/lib/table-view-default'

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
  // #792 (Decision 1): a titled Table leads with its title, not Row ID.
  it('leads with the title column and leaves Row ID out', () => {
    const view = viewColumns(sectionMapping({ title_column: 'floor' }), {})
    expect(names(view)).toEqual(['floor', 'section', 'mch'])
  })

  it('leads with the title column even when it is not a list column', () => {
    const view = viewColumns(sectionMapping({ title_column: 'notes' }), {})
    expect(names(view)).toEqual(['notes', 'section', 'mch', 'floor'])
  })

  it('keeps the title leading when an arrangement hid it', () => {
    const view = viewColumns(sectionMapping({ title_column: 'section' }), { hiddenCols: ['section', 'mch', 'floor'] })
    expect(names(view)).toEqual(['section'])
  })

  it('leads with Row ID when the title column is row_id, or one the caller may not read', () => {
    expect(names(viewColumns(sectionMapping({ title_column: 'row_id' }), {}))[0]).toBe('row_id')
    const restricted = sectionMapping({
      title_column: 'notes',
      readable_columns: ['section', 'mch', 'floor'],
      columns: [...sectionMapping().columns.filter((c) => c.column_name !== 'notes'), column('notes', { tier: 'restricted' } as Partial<ColumnDef>)],
    } as Partial<TableMeta>)
    expect(names(viewColumns(restricted, {}))).toEqual(['row_id', 'section', 'mch', 'floor'])
  })

  it('always fetches the row id, once', () => {
    expect(listFields(viewColumns(sectionMapping({ title_column: 'floor' }), {}))).toEqual(['row_id', 'floor', 'section', 'mch'])
    expect(listFields(viewColumns(sectionMapping(), {}))).toEqual(['row_id', 'section', 'mch', 'floor'])
  })

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

  it('uses the database name for an unlabelled column and keeps its reference target', () => {
    const view = viewColumns(sectionMapping({ columns: [
      column('supplier', { label: null, column_type: 'Reference', reference_table: 'Supplier', in_list_view: true }),
    ] }), {})
    expect(view).toEqual([
      { column_name: 'row_id', label: 'Row ID', column_type: 'Data' },
      { column_name: 'supplier', label: 'supplier', column_type: 'Reference', reference_table: 'Supplier' },
    ])
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

describe('a caller with an explicit readable Column selection', () => {
  const withRestrictedNotes = () =>
    sectionMapping({
      readable_columns: ['section', 'mch', 'floor', 'remarks'],
      columns: [...sectionMapping().columns.slice(0, 4), column('notes', { tier: 'basic' })],
    })

  it('never sees an ungranted column, even one switched on', () => {
    const view = viewColumns(withRestrictedNotes(), { shownCols: ['notes'], hiddenCols: [] })
    expect(names(view)).not.toContain('notes')
  })

  it('is not offered an ungranted column', () => {
    expect(names(dataColumns(withRestrictedNotes()))).toEqual(['section', 'mch', 'floor', 'remarks'])
  })
})

// #738 (Decision 1): a colleague's own sets apply on top of a changed default.
describe("a colleague's choices on a changed default", () => {
  const colleague = { shownCols: ['notes'], hiddenCols: ['floor'] }
  const newDefault = () =>
    sectionMapping({
      columns: sectionMapping().columns.map((c) =>
        c.column_name === 'notes' ? { ...c, in_list_view: false } : c.column_name === 'floor' ? { ...c, in_list_view: true } : c,
      ),
    })

  it('still shows a column they switched on that the default leaves out', () => {
    expect(names(viewColumns(newDefault(), colleague))).toContain('notes')
  })

  it('still hides a column they switched off that the default includes', () => {
    expect(names(viewColumns(newDefault(), colleague))).not.toContain('floor')
  })
})

// admin-lists 4 (one-app-chrome, 17-Nov): a Table whose title is its own id
// ("LKS-Bags & Silk-2026-11-16") leads its list with its first readable link.
describe('a Table whose title is its id', () => {
  // As the client's base Tables are: no column flagged for the list.
  const departmentSection = (columns = [
    column('department_section_id'),
    column('store', { column_type: 'Reference', reference_table: 'Site' }),
    column('section', { column_type: 'Reference', reference_table: 'Section' }),
  ]) => ({ name: 'Department Section', id_pattern: 'field:department_section_id', title_column: 'department_section_id', columns }) as unknown as TableMeta

  it('leads with its first readable link, and the id waits in Show Columns', () => {
    expect(names(viewColumns(departmentSection(), {}))).toEqual(['store', 'section'])
    expect(names(viewColumns(departmentSection(), { shownCols: ['department_section_id'] }))).toEqual(['store', 'department_section_id', 'section'])
  })

  it('keeps the id where the Table has no readable link: never the only identifier hidden', () => {
    const lone = departmentSection([column('department_section_id'), column('note')])
    expect(names(viewColumns(lone, {}))).toEqual(['department_section_id', 'note'])
  })

  // Codex review: a Table's default keeps an id someone chose to show (#1282 A4: the whole view, from the View menu).
  it('an id someone made a list column for everyone stays one', () => {
    const meta = departmentSection([
      column('department_section_id'),
      column('store', { column_type: 'Reference', reference_table: 'Site' }),
      column('section', { column_type: 'Reference', reference_table: 'Section' }),
    ])
    expect(names(viewColumns(meta, {}))).toEqual(['store', 'section'])
    const td = viewAsDefault(meta, switchColumn(meta, {}, 'department_section_id', true), {}, { layout: 'panel', sort: null, compact: false, links: {} })
    expect(names(viewColumns(meta, {}, listDefaultsWith(meta, td)))).toEqual(['store', 'department_section_id', 'section'])
  })

  it('a title that is not the id is unchanged', () => {
    expect(names(viewColumns(sectionMapping({ title_column: 'floor', id_pattern: 'field:section' } as Partial<TableMeta>), {}))).toEqual(['floor', 'section', 'mch'])
  })
})
