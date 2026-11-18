// #1273: a relationship the viewer may change reads as a tick list (C5–C9, C12).
import { describe, expect, it } from 'vitest'
import type { ColumnDef, TableMeta } from '../src/lib/meta'
import {
  correctionHref, formColumns, gridOffered, isUntil, mayTick, newLinkRow, tickColumn, tickCount, tickLines,
} from '../src/lib/link-ticks'

function column(column_name: string, extra: Partial<ColumnDef> = {}): ColumnDef {
  return {
    column_name, label: column_name[0].toUpperCase() + column_name.slice(1).replace(/_/g, ' '), column_type: 'Data',
    reference_table: null, in_list_view: false, hidden: false, read_only: false, tier: 'basic', ...extra,
  } as ColumnDef
}
const link = (name: string, table: string, extra: Partial<ColumnDef> = {}) => column(name, { column_type: 'Reference', reference_table: table, ...extra })

// A role given to a person: no title of its own, two links and an area.
const roleGiven = {
  name: 'Rg Role Given', kind: 'table', id_pattern: 'hash', title_column: null,
  columns: [
    link('person', 'Person'),
    link('site', 'Rg Site', { label: 'Area' }),
    link('role', 'Rg Business Role'),
    column('ends_on', { column_type: 'Date', label: 'Ends' }),
    column('reason', { column_type: 'Text', label: 'Reason' }),
    column('given_by_name', { read_only: true }),
    column('note', { hidden: true }),
    column('created_on', { column_type: 'Date' }),
  ],
} as unknown as TableMeta

const site = { name: 'Rg Site', kind: 'table', id_pattern: 'prompt', title_column: 'site_name', columns: [column('site_name'), link('region', 'Rg Region')] } as unknown as TableMeta

describe('tickColumn', () => {
  it("ticks the first link that is not the link back, passing over a Table the record itself links to", () => {
    expect(tickColumn(roleGiven, { column: 'person', via: null }, { table: 'Person', own: ['Rg Site'] })?.column_name).toBe('role')
  })

  it('ticks the area when the record links to nothing', () => {
    expect(tickColumn(roleGiven, { column: 'person', via: null }, { table: 'Person', own: [] })?.column_name).toBe('site')
  })

  it('never ticks through a sub-table, a Table whose rows have names, or a link back that is not a link', () => {
    expect(tickColumn(roleGiven, { column: 'person', via: 'Rg Lines' }, { table: 'Person', own: [] })).toBeUndefined()
    expect(tickColumn(site, { column: 'region', via: null }, { table: 'Rg Region', own: [] })).toBeUndefined()
    expect(tickColumn(roleGiven, { column: 'reason', via: null }, { table: 'Person', own: [] })).toBeUndefined()
  })

  it('never ticks through a link that takes no value: a read-only link back or far side', () => {
    const lockedBack = { ...roleGiven, columns: roleGiven.columns.map((c) => (c.column_name === 'person' ? { ...c, read_only: true } : c)) } as TableMeta
    expect(tickColumn(lockedBack, { column: 'person', via: null }, { table: 'Person', own: ['Rg Site'] })).toBeUndefined()
    const lockedFar = { ...roleGiven, columns: roleGiven.columns.map((c) => (c.column_name === 'role' ? { ...c, read_only: true } : c)) } as TableMeta
    expect(tickColumn(lockedFar, { column: 'person', via: null }, { table: 'Person', own: ['Rg Site'] })).toBeUndefined()
  })

  it('never ticks through a link to a row of any Table, which names its Table too', () => {
    const any = { ...roleGiven, columns: roleGiven.columns.map((c) => (c.column_name === 'person' ? { ...c, reference_table: null, table_column: 'person_table' } : c)) } as TableMeta
    expect(tickColumn(any, { column: 'person', via: null }, { table: 'Person', own: ['Rg Site'] })).toBeUndefined()
  })

  it('never ticks back into the record\'s own Table', () => {
    const reports = { ...roleGiven, columns: [link('person', 'Person'), link('reports_to', 'Person')] } as unknown as TableMeta
    expect(tickColumn(reports, { column: 'person', via: null }, { table: 'Person', own: [] })).toBeUndefined()
  })
})

describe('formColumns', () => {
  it("asks for the link Table's own editable columns beyond its two links: areas first, then dates, then a reason", () => {
    expect(formColumns(roleGiven, ['person', 'role']).map((c) => c.column_name)).toEqual(['site', 'ends_on', 'reason'])
  })
})

describe('isUntil', () => {
  it('reads a date that ends something as "until"', () => {
    expect(isUntil(column('ends_on', { label: 'Ends' }))).toBe(true)
    expect(isUntil(column('valid_to', { label: 'Valid to' }))).toBe(true)
    expect(isUntil(column('starts_on', { label: 'Starts on' }))).toBe(false)
  })
})

describe('tickLines', () => {
  const choices = [{ id: 'fm', title: 'Floor Manager' }, { id: 'b', title: 'Buyer' }, { id: 'tl', title: 'Team Leader' }, { id: 'sm', title: 'Store Manager' }]
  it('lists ticked choices first, in the choices order, then the rest', () => {
    const rows = [{ row_id: 'g2', role: 'b' }, { row_id: 'g1', role: 'fm' }]
    const lines = tickLines(choices, rows, 'role')
    expect(lines.ticked.map((l) => l.choice.title)).toEqual(['Floor Manager', 'Buyer'])
    expect(lines.unticked.map((c) => c.title)).toEqual(['Team Leader', 'Store Manager'])
    expect(tickCount(lines, choices)).toBe('2 of 4')
  })

  it('keeps a row whose choice is not listed among the ticked, last, and counts a choice ticked twice once', () => {
    const rows = [{ row_id: 'g9', role: 'hidden' }, { row_id: 'g1', role: 'fm' }, { row_id: 'g3', role: 'fm' }]
    const lines = tickLines(choices, rows, 'role')
    expect(lines.ticked.map((l) => l.row.row_id)).toEqual(['g1', 'g3', 'g9'])
    expect(tickCount(lines, choices)).toBe('1 of 4')
  })
})

describe('mayTick', () => {
  const caps = (creatable: string[], deletable: string[]) => ({ manage: false, creatable, deletable })
  it('needs both adding and deleting rows of the link Table', () => {
    expect(mayTick(caps(['Rg Role Given'], ['Rg Role Given']), roleGiven)).toBe(true)
    expect(mayTick(caps(['Rg Role Given'], []), roleGiven)).toBe(false)
    expect(mayTick(caps([], ['Rg Role Given']), roleGiven)).toBe(false)
    expect(mayTick({ manage: true, creatable: [] }, roleGiven)).toBe(true)
    expect(mayTick(undefined, roleGiven)).toBe(false)
  })

  it('never on a Table that takes no writes', () => {
    const manage = { manage: true, creatable: [] }
    expect(mayTick(manage, { ...roleGiven, system_written: true })).toBe(false)
    expect(mayTick(manage, { ...roleGiven, archived_at: '2026-11-01' })).toBe(false)
    expect(mayTick(manage, { ...roleGiven, data_source: 'Payroll', source_writable: false })).toBe(false)
    expect(mayTick(manage, { ...roleGiven, data_source: 'Payroll', source_writable: true })).toBe(false)
    // A Table whose row ids are typed by hand: the inline form has no box for one.
    expect(mayTick(manage, { ...roleGiven, id_pattern: 'prompt' })).toBe(false)
  })
})

describe('gridOffered', () => {
  it('only for small pairs, both counted', () => {
    expect(gridOffered(7, 40)).toBe(true)
    expect(gridOffered(41, 7)).toBe(false)
    expect(gridOffered(7, undefined)).toBe(false)
  })
})

describe('correctionHref', () => {
  it("fills each {column} from the row, encoded; none without a path", () => {
    expect(correctionHref('/dash?view=explain&person={person}', { person: 'psn a&b' })).toBe('/dash?view=explain&person=psn%20a%26b')
    expect(correctionHref(null, { person: 'x' })).toBeUndefined()
  })
})

describe('newLinkRow', () => {
  it('saves the link back, the choice and the filled fields only', () => {
    expect(newLinkRow('person', 'psn_1', 'role', 'tl', { site: 'S1', ends_on: '', reason: null })).toEqual({ person: 'psn_1', role: 'tl', site: 'S1' })
  })
})
