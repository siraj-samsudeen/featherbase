// Relational navigation slice 1 (#1218): a row in a group of rows that point at
// a record reads by its far side, the first readable link that is neither the
// link back to the record nor a link holding one of the record's own values.
import { describe, expect, it } from 'vitest'
import type { ColumnDef, TableMeta } from '../src/lib/meta'
import { farSideCode, farSideTable, farSides, groupBoxWords, groupFacts, groupRowFields } from '../src/lib/far-side'

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

// A link table: its title is its own id (the same test listLeader uses).
const jobAssignment = {
  name: 'dash.job_assignment', id_pattern: 'field:assignment_id', title_column: 'assignment_id',
  columns: [
    column('assignment_id'),
    link('section', 'dash.section'),
    link('employee', 'dash.employee'),
    link('reports_to', 'dash.employee', { label: 'Reports to' }),
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
// Identities are a Table and an id: an id alone may repeat across Tables.
const section = {
  record: { table: 'dash.section', row_id: 'KL-RR-S13039' },
  own: [{ table: 'dash.site', row_id: 'S13039' }, { table: 'dash.store_floor', row_id: 'F1' }],
}

const cols = (sides: { column: string }[]) => sides.map((f) => f.column)

describe('farSides', () => {
  it("names a section's job assignment by its employee, not also by whom they report to (the same Table)", () => {
    const row = { row_id: 'ja1', section: 'KL-RR-S13039', employee: 'E1001', reports_to: 'E2000' }
    expect(farSides(jobAssignment, row, { backLink: 'section', record: section.record, own: section.own }))
      .toEqual([{ column: 'employee', label: 'Employee', table: 'dash.employee', row_id: 'E1001' }])
  })

  it("skips a section subcategory's store, the section's own site, and names it by its subcategory", () => {
    const row = { row_id: 'p1', placement_key: 'S13039-KL-RR-SC4', store: 'S13039', section: 'KL-RR-S13039', subcategory: 'SC4' }
    expect(farSides(sectionSubcategory, row, { backLink: 'section', record: section.record, own: section.own }))
      .toMatchObject([{ column: 'subcategory', table: 'dash.subcategory', row_id: 'SC4' }])
  })

  // Verifier round 2: from a site, a placement has two far sides left.
  it("names a site's section subcategory by both its section and its subcategory, in column order", () => {
    const row = { row_id: 'p1', placement_key: 'LKS-010101001', store: 'LKS', section: 'LKS-S1', subcategory: '010101001' }
    expect(farSides(sectionSubcategory, row, { backLink: 'store', record: { table: 'dash.site', row_id: 'LKS' }, own: [] }))
      .toMatchObject([{ column: 'section', row_id: 'LKS-S1' }, { column: 'subcategory', row_id: '010101001' }])
  })

  it("names a site's department section by its department, then its section", () => {
    const departmentSection = { name: 'dash.department_section', id_pattern: 'field:department_section_id', title_column: 'department_section_id',
      columns: [column('department_section_id'), link('store', 'dash.site'), link('department', 'dash.department'), link('section', 'dash.section')] } as unknown as TableMeta
    const row = { row_id: 'LKS-Kids-S1', department_section_id: 'LKS-Kids-S1', store: 'LKS', department: 'LKS-Kids', section: 'LKS-S1' }
    expect(cols(farSides(departmentSection, row, { backLink: 'store', record: { table: 'dash.site', row_id: 'LKS' }, own: [] })))
      .toEqual(['department', 'section'])
  })

  it('names a row by at most two far sides', () => {
    const three = { name: 'Triple', id_pattern: 'field:k', title_column: 'k',
      columns: [column('k'), link('a', 'A'), link('b', 'B'), link('c', 'C')] } as unknown as TableMeta
    expect(cols(farSides(three, { row_id: 'k1', k: 'k1', a: '1', b: '2', c: '3' }, { record: { table: 'X', row_id: 'x' }, own: [] })))
      .toEqual(['a', 'b'])
  })

  it('skips a link holding the record itself when the back-link is not known (a group through a sub-table)', () => {
    const row = { row_id: 'ja1', section: 'KL-RR-S13039', employee: 'E1001' }
    expect(cols(farSides(jobAssignment, row, { record: section.record, own: section.own }))).toEqual(['employee'])
  })

  // Codex round 1: the same id in two Tables is two different records.
  it("keeps a far side whose id equals the record's, or one of its links', in another Table", () => {
    const one = { table: 'dash.section', row_id: '1' }
    expect(farSides(jobAssignment, { row_id: 'ja9', section: '1', employee: '1' }, { backLink: 'section', record: one, own: [] }))
      .toMatchObject([{ column: 'employee', table: 'dash.employee', row_id: '1' }])
    // The section's site is S13039; this subcategory S13039 is no site.
    const row = { row_id: 'p9', placement_key: 'p9', store: 'X9', section: 'KL-RR-S13039', subcategory: 'S13039' }
    expect(cols(farSides(sectionSubcategory, row, { backLink: 'section', record: section.record, own: section.own }))).toEqual(['store', 'subcategory'])
  })

  it('passes over an empty link to the next readable one', () => {
    const row = { row_id: 'ja2', section: 'KL-RR-S13039', employee: null, reports_to: 'E2000' }
    expect(cols(farSides(jobAssignment, row, { backLink: 'section', record: section.record, own: [] }))).toEqual(['reports_to'])
  })

  it('leaves a link table with no other readable link to keep its own name', () => {
    const tag = { name: 'Tag', id_pattern: 'field:tag_id', title_column: 'tag_id',
      columns: [column('tag_id'), link('site', 'Site'), column('format')] } as unknown as TableMeta
    expect(farSides(tag, { row_id: 'T1', tag_id: 'T1', site: 'ENK' }, { backLink: 'site', record: { table: 'Site', row_id: 'ENK' }, own: [{ table: 'Region', row_id: 'KL' }] }))
      .toEqual([])
  })

  // Verifier, 17-Nov: on Site Lakeside, sections read as their floors and
  // departments as their managers. A Table with a readable title is not a link table.
  it("keeps a Site's sections by their own names, never their floors", () => {
    const sectionMeta = { name: 'Section', id_pattern: 'field:section_id', title_column: 'name',
      columns: [column('section_id'), column('name'), link('site', 'Site'), link('floor', 'Store Floor')] } as unknown as TableMeta
    expect(farSides(sectionMeta, { row_id: 'LKS-S1', name: 'Sarees', site: 'LKS', floor: 'LKS-F1' }, { backLink: 'site', record: { table: 'Site', row_id: 'LKS' }, own: [] }))
      .toEqual([])
  })

  it("keeps a Site's departments by their own names, never their managers", () => {
    const department = { name: 'Department', id_pattern: 'field:department_id', title_column: 'name',
      columns: [column('department_id'), link('store', 'Site'), column('name'), link('manager', 'Employee')] } as unknown as TableMeta
    expect(farSides(department, { row_id: 'D1', department_id: 'D1', store: 'LKS', name: 'Ladies', manager: '2001' }, { backLink: 'store', record: { table: 'Site', row_id: 'LKS' }, own: [] }))
      .toEqual([])
  })

  it('keeps a Table with no title by its own name', () => {
    const posting = { ...jobAssignment, id_pattern: 'hash', title_column: null } as unknown as TableMeta
    expect(farSides(posting, { row_id: 'ja1', section: 'KL-RR-S13039', employee: 'E1001' }, { backLink: 'section', record: section.record, own: [] }))
      .toEqual([])
  })

  it('never names a row by a link the viewer may not read', () => {
    const scoped = { ...jobAssignment, readable_columns: ['assignment_id', 'section', 'reports_to', 'starts_on'] } as TableMeta
    const row = { row_id: 'ja1', section: 'KL-RR-S13039', employee: 'E1001', reports_to: 'E2000' }
    expect(cols(farSides(scoped, row, { backLink: 'section', record: section.record, own: [] }))).toEqual(['reports_to'])
  })
})

describe('farSideTable', () => {
  const far = (table: string) => ({ column: 'x', label: 'X', table, row_id: '1' })
  it('is the one Table every row points to, each row by one far side', () => {
    expect(farSideTable([[far('dash.employee')], [far('dash.employee')]])).toBe('dash.employee')
  })
  it('is none when the rows point to different Tables, when a row has none or two, or when there are no rows', () => {
    expect(farSideTable([[far('dash.employee')], [far('dash.designation')]])).toBeUndefined()
    expect(farSideTable([[far('dash.employee')], []])).toBeUndefined()
    expect(farSideTable([[far('dash.section'), far('dash.subcategory')]])).toBeUndefined()
    expect(farSideTable([])).toBeUndefined()
  })
})

describe('farSideCode', () => {
  it("keeps the far-side record's own code people use", () => {
    expect(farSideCode('Asha Leader', '2001')).toBe('2001')
  })
  it('drops a code that only spells the name again, a composed key', () => {
    expect(farSideCode('Bags & Silk', 'LKS-Bags & Silk-2026-11-17')).toBeUndefined()
    expect(farSideCode('Asha', undefined)).toBeUndefined()
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
