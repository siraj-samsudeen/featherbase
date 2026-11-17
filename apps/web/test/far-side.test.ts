// Relational navigation slice 1 (#1218): a row in a group of rows that point at
// a record reads by its far side, the first readable link that is neither the
// link back to the record nor a link holding one of the record's own values.
import { describe, expect, it } from 'vitest'
import type { ColumnDef, TableMeta } from '../src/lib/meta'
import { farSide, farSideTable, groupBoxWords, groupFacts, groupRowFields } from '../src/lib/far-side'

function column(column_name: string, extra: Partial<ColumnDef> = {}): ColumnDef {
  return {
    column_name,
    label: column_name[0].toUpperCase() + column_name.slice(1),
    column_type: 'Data',
    reference_table: null,
    in_list_view: false,
    hidden: false,
    tier: 'basic',
    ...extra,
  } as ColumnDef
}
const link = (name: string, table: string, extra: Partial<ColumnDef> = {}) =>
  column(name, { column_type: 'Reference', reference_table: table, ...extra })

const jobAssignment = {
  name: 'dash.job_assignment', id_pattern: 'hash', title_column: null,
  columns: [
    link('section', 'dash.section'),
    link('employee', 'dash.employee'),
    link('designation', 'dash.designation'),
    column('starts_on', { column_type: 'Date', label: 'Starts on' }),
    column('status', { column_type: 'Choice', label: 'Status' }),
    column('ends_on', { column_type: 'Date', label: 'Ends on' }),
  ],
} as unknown as TableMeta

const sectionSubcategory = {
  name: 'dash.section_subcategory', id_pattern: 'field:placement_key', title_column: 'placement_key',
  columns: [
    column('placement_key'),
    link('store', 'dash.site'),
    link('section', 'dash.section'),
    link('subcategory', 'dash.subcategory'),
  ],
} as unknown as TableMeta

// The section KL-RR-S13039 sits at site S13039 on floor F1.
const section = { record: 'KL-RR-S13039', own: ['S13039', 'F1'] }

describe('farSide', () => {
  it("names a section's job assignment by its employee", () => {
    const row = { row_id: 'ja1', section: 'KL-RR-S13039', employee: 'E1001', designation: 'D7' }
    expect(farSide(jobAssignment, row, { backLink: 'section', record: section.record, own: section.own }))
      .toEqual({ column: 'employee', label: 'Employee', table: 'dash.employee', row_id: 'E1001' })
  })

  it("skips a section subcategory's store, the section's own site, and names it by its subcategory", () => {
    const row = { row_id: 'p1', placement_key: 'S13039-KL-RR-SC4', store: 'S13039', section: 'KL-RR-S13039', subcategory: 'SC4' }
    expect(farSide(sectionSubcategory, row, { backLink: 'section', record: section.record, own: section.own }))
      .toMatchObject({ column: 'subcategory', table: 'dash.subcategory', row_id: 'SC4' })
  })

  it('skips a link holding the record itself when the back-link is not known (a group through a sub-table)', () => {
    const row = { row_id: 'ja1', section: 'KL-RR-S13039', employee: 'E1001' }
    expect(farSide(jobAssignment, row, { record: section.record, own: section.own })).toMatchObject({ column: 'employee' })
  })

  it('passes over an empty link to the next readable one', () => {
    const row = { row_id: 'ja2', section: 'KL-RR-S13039', employee: null, designation: 'D7' }
    expect(farSide(jobAssignment, row, { backLink: 'section', record: section.record, own: [] })).toMatchObject({ column: 'designation' })
  })

  it('leaves a row with no other readable link to keep its own name', () => {
    const plant = { name: 'Plant', id_pattern: 'prompt', title_column: 'plant_name',
      columns: [column('plant_name'), link('site', 'Site'), column('format')] } as unknown as TableMeta
    expect(farSide(plant, { row_id: '1503', plant_name: 'Enchakkal Supermarket', site: 'ENK' }, { backLink: 'site', record: 'ENK', own: ['KL'] }))
      .toBeUndefined()
  })

  it('never names a row by a link the viewer may not read', () => {
    const scoped = { ...jobAssignment, readable_columns: ['section', 'designation', 'starts_on'] } as TableMeta
    const row = { row_id: 'ja1', section: 'KL-RR-S13039', employee: 'E1001', designation: 'D7' }
    expect(farSide(scoped, row, { backLink: 'section', record: section.record, own: [] })).toMatchObject({ column: 'designation' })
  })
})

describe('farSideTable', () => {
  const far = (table: string) => ({ column: 'x', label: 'X', table, row_id: '1' })
  it('is the one Table every row points to', () => {
    expect(farSideTable([far('dash.employee'), far('dash.employee')])).toBe('dash.employee')
  })
  it('is none when the rows point to different Tables, when one row has no far side, or when there are no rows', () => {
    expect(farSideTable([far('dash.employee'), far('dash.designation')])).toBeUndefined()
    expect(farSideTable([far('dash.employee'), undefined])).toBeUndefined()
    expect(farSideTable([])).toBeUndefined()
  })
})

describe('groupFacts', () => {
  it("gives at most two of the row's own dates and statuses that have values", () => {
    const row = { row_id: 'ja1', starts_on: '2026-04-01', status: 'Active', ends_on: '2027-03-31' }
    expect(groupFacts(jobAssignment, row).map((c) => c.column_name)).toEqual(['starts_on', 'status'])
    expect(groupFacts(jobAssignment, { row_id: 'ja2', status: 'Active' }).map((c) => c.column_name)).toEqual(['status'])
  })
  it('never offers a code or a link as a fact', () => {
    expect(groupFacts(sectionSubcategory, { row_id: 'p1', placement_key: 'S13039-KL-RR-SC4', store: 'S13039' })).toEqual([])
  })
})

describe('groupRowFields', () => {
  it("reads the row's title, its readable links and its facts", () => {
    expect(groupRowFields(sectionSubcategory)).toEqual(expect.arrayContaining(['row_id', 'placement_key', 'store', 'section', 'subcategory']))
    expect(groupRowFields(jobAssignment)).toEqual(expect.arrayContaining(['employee', 'starts_on', 'status', 'ends_on']))
  })
})

describe('groupBoxWords', () => {
  it('reads as the far-side Table, through the group', () => {
    expect(groupBoxWords({ group: 'Job Assignment', farSide: 'Employee' })).toEqual({ title: 'Employee', detail: 'through Job Assignment' })
  })
  it('names the link only when the group points at the record by more than one link', () => {
    expect(groupBoxWords({ group: 'Job Assignment', farSide: 'Employee', via: 'Reports To' }))
      .toEqual({ title: 'Employee', detail: 'through Job Assignment · via Reports To' })
    expect(groupBoxWords({ group: 'Plant' })).toEqual({ title: 'Plant' })
    expect(groupBoxWords({ group: 'Order', via: 'Customer' })).toEqual({ title: 'Order', detail: 'via Customer' })
  })
})
