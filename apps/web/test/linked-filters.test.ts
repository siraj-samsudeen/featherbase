import { describe, expect, test } from 'vitest'
import {
  chainFilter,
  choiceCountQuery,
  exploreToList,
  fitsDepth,
  linkOptions,
  parseChain,
  type ChainStep,
} from '../src/lib/linked-filters'
import type { TableMeta } from '../src/lib/meta'

// #1276: Linked to… filters. A made-up merchandise world: Section → Subcategory
// → Division, Employee ← Job Assignment → Role, Order ▸ Order Line → Item.

type Col = Partial<TableMeta['columns'][number]> & { column_name: string; column_type: string }
const table = (name: string, columns: Col[], over: Partial<TableMeta> = {}): TableMeta => ({
  name, module: 'Test', kind: 'table', is_submittable: false, id_pattern: 'prompt', title_column: 'title',
  sort_column: 'updated_at', sort_order: 'desc', track_changes: false, description: null, custom: true, system: false,
  columns: [{ column_name: 'title', column_type: 'Data' }, ...columns].map((c) => ({ label: null, hidden: false, ...c })),
  ...over,
} as unknown as TableMeta)

const ref = (column_name: string, reference_table: string, label?: string): Col => ({ column_name, column_type: 'Reference', reference_table, label })
const DIVISION = table('Division', [])
const SUBCATEGORY = table('Subcategory', [ref('division', 'Division')])
const SECTION = table('Section', [ref('subcategory', 'Subcategory')])
const EMPLOYEE = table('Employee', [ref('manager', 'Employee', 'Manager')])
// A link table: its title is its own id.
const ASSIGNMENT = table('Job Assignment', [ref('employee', 'Employee'), ref('role', 'Role')], { id_pattern: 'field:title' })
const ROLE = table('Role', [])
const LINE = table('Order Line', [ref('item', 'Item')], { kind: 'sub_table', title_column: null })
const ORDER = table('Order', [{ column_name: 'lines', column_type: 'Sub-table', row_table: 'Order Line' }])
const ITEM = table('Item', [])
const metas = Object.fromEntries([DIVISION, SUBCATEGORY, SECTION, EMPLOYEE, ASSIGNMENT, ROLE, LINE, ORDER, ITEM].map((m) => [m.name, m]))
const metaOf = (t: string) => metas[t]

describe('linkOptions', () => {
  test('a Table links forward by its links and back from Tables linking to it', () => {
    expect(linkOptions(SUBCATEGORY, [{ table: 'Section', column: 'subcategory', via: null }], metaOf).map((o) => [o.label, o.link]))
      .toEqual([
        ['Division', { kind: 'forward', column: 'division' }],
        ['Section', { kind: 'back', column: 'subcategory' }],
      ])
  })

  test('a link Table pointing here also offers its far side, through it', () => {
    const options = linkOptions(EMPLOYEE, [
      { table: 'Employee', column: 'manager', via: null },
      { table: 'Job Assignment', column: 'employee', via: null },
    ], metaOf)
    expect(options.map((o) => o.label)).toEqual(['Employee · Manager', 'Employee · by their Manager', 'Job Assignment', 'Role · through Job Assignment'])
    expect(options[3]).toMatchObject({ table: 'Role', link: { kind: 'through', link: 'Job Assignment', back: 'employee', column: 'role' } })
  })

  test('a link Table names which link when two point into one Table, and skips a Table this one links to itself', () => {
    const job = table('Job', [ref('site', 'Site'), ref('employee', 'Employee'), ref('reports_to', 'Employee', 'Reports To'), ref('section', 'Section')], { id_pattern: 'field:title' })
    const section = table('Section', [ref('site', 'Site')])
    const of = (t: string) => (t === 'Job' ? job : t === 'Section' ? section : metaOf(t))
    expect(linkOptions(section, [{ table: 'Job', column: 'section', via: null }], of).map((o) => o.label)).toEqual([
      'Site', 'Job', 'Employee (employee) · through Job', 'Employee (Reports To) · through Job',
    ])
  })

  test('a Table holding sub-table rows offers them and what they point at', () => {
    expect(linkOptions(ORDER, [], metaOf).map((o) => [o.label, o.table, o.link])).toEqual([
      ['Order Line · rows of this Order', 'Order Line', { kind: 'back', column: 'parent' }],
      ['Item · via Order Line', 'Item', { kind: 'via', via: 'Order Line', column: 'item' }],
    ])
  })

  test('a sub-table offers the Tables holding its rows, by parent', () => {
    expect(linkOptions(LINE, [], metaOf, ['Order']).map((o) => [o.label, o.link])).toEqual([
      ['Item', { kind: 'forward', column: 'item' }],
      ['Order', { kind: 'forward', column: 'parent' }],
    ])
    const steps: ChainStep[] = [{ table: 'Order', link: { kind: 'forward', column: 'parent' }, picked: ['O-1'] }]
    expect(parseChain(chainFilter(steps))).toEqual({ negate: false, steps })
  })

  test('a Table pointed at by sub-table rows offers the Tables holding them', () => {
    expect(linkOptions(ITEM, [{ table: 'Order', column: 'item', via: 'Order Line' }], metaOf)[0])
      .toMatchObject({ label: 'Order · via Order Line', table: 'Order', link: { kind: 'through', link: 'Order Line', back: 'item', column: 'parent' } })
  })

  test('a connected Table offers only its links within the same source', () => {
    const store = table('Store', [], { data_source: 'Shop DB' } as Partial<TableMeta>)
    const floor = table('Floor', [ref('store', 'Store'), ref('division', 'Division')], { data_source: 'Shop DB' } as Partial<TableMeta>)
    expect(linkOptions(floor, [{ table: 'Section', column: 'x', via: null }], (t) => (t === 'Store' ? store : metaOf(t))).map((o) => o.label))
      .toEqual(['Store'])
  })
})

describe('chain filters', () => {
  const sarees: ChainStep[] = [
    { table: 'Subcategory', link: { kind: 'forward', column: 'subcategory' }, picked: [] },
    { table: 'Division', link: { kind: 'forward', column: 'division' }, picked: ['DIV-SAREES'] },
  ]

  test('a chain nests each step in the one before', () => {
    expect(chainFilter(sarees)).toEqual(['subcategory', 'related', {
      table: 'Subcategory',
      filters: [['division', 'related', { table: 'Division', filters: [['row_id', 'in', ['DIV-SAREES']]] }]],
    }])
    expect(chainFilter(sarees, true)[1]).toBe('not related')
  })

  test.each([
    ['forward', [{ table: 'Division', link: { kind: 'forward', column: 'division' }, picked: ['D1', 'D2'] }]],
    ['back', [{ table: 'Section', link: { kind: 'back', column: 'subcategory' }, picked: ['S1'] }]],
    ['through', [{ table: 'Role', link: { kind: 'through', link: 'Job Assignment', back: 'employee', column: 'role' }, picked: ['R1'] }]],
    ['via', [{ table: 'Item', link: { kind: 'via', via: 'Order Line', column: 'item' }, picked: [] }]],
    ['two steps', sarees],
  ] as [string, ChainStep[]][])('%s reads back as the chain it was built from', (_, steps) => {
    expect(parseChain(chainFilter(steps))).toEqual({ negate: false, steps })
    expect(parseChain(chainFilter(steps, true))).toEqual({ negate: true, steps })
  })

  test('a filter that is not a chain reads as none', () => {
    expect(parseChain(['status', '=', 'Open'])).toBeNull()
    expect(parseChain(['x', 'related', 'nope'])).toBeNull()
    expect(parseChain(['x', 'related', { table: 'T', filters: [['title', 'like', '%a%']] }])).toBeNull()
    expect(parseChain(['x', 'related', { table: 'T', column: 'y' }])).toBeNull() // a back-link reads from row_id
  })

  test('a link Table step uses two of the three levels the server allows', () => {
    const through = { link: { kind: 'through', link: 'Job Assignment', back: 'employee', column: 'role' } } as const
    expect(fitsDepth([through])).toBe(true)
    expect(fitsDepth([through, { link: { kind: 'forward', column: 'x' } }])).toBe(true)
    expect(fitsDepth([through, through])).toBe(false)
  })

  test('each choice is counted by the rows linked to it, over the list’s own filters', () => {
    const open: [string, string, unknown][] = [['status', '=', 'Open']]
    expect(choiceCountQuery('Section', open, sarees[0])).toEqual({ table: 'Section', group_by: 'subcategory', filters: open })
    expect(choiceCountQuery('Employee', [], { table: 'Role', link: { kind: 'through', link: 'Job Assignment', back: 'employee', column: 'role' } }))
      .toEqual({ table: 'Job Assignment', group_by: 'role', filters: [['employee', 'related', { table: 'Employee', filters: [] }]] })
  })
})

describe('old Explore addresses', () => {
  test('a chain opens the last pane’s list, linked back to the first pane’s picks', () => {
    expect(exploreToList({
      root: 'Supplier',
      chain: JSON.stringify([{ mode: 'backlink', table: 'Purchase Order', column: 'supplier' }, { mode: 'child', table: 'PO Line', column: 'lines' }]),
      select: JSON.stringify(['S-1']),
    })).toEqual({
      table: 'PO Line',
      filters: [['parent', 'related', { table: 'Purchase Order', filters: [['supplier', 'related', { table: 'Supplier', filters: [['row_id', 'in', ['S-1']]] }]] }]],
    })
  })

  test('a via step and no picks follow every related row', () => {
    expect(exploreToList({ root: 'Item', chain: JSON.stringify([{ mode: 'viabacklink', table: 'Order', column: 'item', via: 'Order Line' }]) }))
      .toEqual({ table: 'Order', filters: [['row_id', 'related', { via: 'Order Line', column: 'item', table: 'Item', filters: [] }]] })
  })

  test('a malformed address keeps what reads, and no root is no list', () => {
    expect(exploreToList({ root: 'Supplier', chain: '{oops', select: '[1]' })).toEqual({ table: 'Supplier', filters: [] })
    expect(exploreToList({ root: 'Supplier', chain: JSON.stringify([{ mode: 'nope' }]) })).toEqual({ table: 'Supplier', filters: [] })
    expect(exploreToList({})).toBeNull()
  })
})
