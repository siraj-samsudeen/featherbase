import { describe, expect, test } from 'vitest'
import {
  chainFilter,
  chainText,
  choiceCountQuery,
  exploreTables,
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
const SITE = table('Site', [])
const metas = Object.fromEntries([DIVISION, SUBCATEGORY, SECTION, EMPLOYEE, ASSIGNMENT, ROLE, LINE, ORDER, ITEM, SITE].map((m) => [m.name, m]))
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

  test('a Table the viewer may not read is never offered (its metadata is refused)', () => {
    const readable = (t: string) => (t === 'Division' ? undefined : metaOf(t))
    expect(linkOptions(SUBCATEGORY, [{ table: 'Section', column: 'subcategory', via: null }], readable).map((o) => o.label)).toEqual(['Section'])
  })

  test('a chain reads in the same words everywhere', () => {
    const chain = { negate: false, steps: [
      { table: 'Role', link: { kind: 'through', link: 'Job Assignment', back: 'employee', column: 'role' }, picked: [] },
      { table: 'Division', link: { kind: 'forward', column: 'division' }, picked: ['D1'] },
    ] as ChainStep[] }
    expect(chainText(chain, (t) => t, (r) => `${r.row_id} name`, metaOf)).toBe('Linked to Role › Division: D1 name')
    const twice = table('Job', [ref('section', 'Section'), ref('employee', 'Employee'), ref('reports_to', 'Employee', 'Reports To')], { id_pattern: 'field:title' })
    const through = { negate: true, steps: [{ table: 'Employee', link: { kind: 'through', link: 'Job', back: 'section', column: 'reports_to' }, picked: [], search: { column: 'title', text: 'Ram' } }] as ChainStep[] }
    expect(chainText(through, (t) => t, () => '', (t) => (t === 'Job' ? twice : metaOf(t)))).toBe('Not linked to Employee (Reports To) matching "Ram"')
  })

  test('a connected Table offers only its links within the same PostgreSQL source', () => {
    const shop = { data_source: 'Shop DB', source_engine: 'postgres' } as Partial<TableMeta>
    const store = table('Store', [], shop)
    const floor = table('Floor', [ref('store', 'Store'), ref('division', 'Division')], shop)
    const of = (t: string) => (t === 'Store' ? store : metaOf(t))
    expect(linkOptions(floor, [{ table: 'Section', column: 'x', via: null }], of).map((o) => o.label)).toEqual(['Store'])
    const duck = table('Floor', [ref('store', 'Store')], { data_source: 'Shop DB', source_engine: 'duckdb' } as Partial<TableMeta>)
    expect(linkOptions(duck, [], of)).toEqual([])
  })

  test('a native Table offers no step into a connected Table', () => {
    const store = table('Store', [], { data_source: 'Shop DB', source_engine: 'postgres' } as Partial<TableMeta>)
    const visit = table('Visit', [ref('store', 'Store'), ref('division', 'Division')])
    expect(linkOptions(visit, [], (t) => (t === 'Store' ? store : metaOf(t))).map((o) => o.label)).toEqual(['Division'])
  })

  test('a count via sub-table rows counts their lines on rows of this Table', () => {
    expect(choiceCountQuery('Order', [], { table: 'Item', link: { kind: 'via', via: 'Order Line', column: 'item' } }))
      .toEqual({ table: 'Order Line', group_by: 'item', filters: [['parenttype', '=', 'Order'], ['parent', 'related', { table: 'Order', filters: [] }]] })
  })

  test('a sub-table’s parent counts keep to the holding Table', () => {
    expect(choiceCountQuery('Order Line', [], { table: 'Order', link: { kind: 'forward', column: 'parent' } }))
      .toEqual({ table: 'Order Line', group_by: 'parent', filters: [['parenttype', '=', 'Order']] })
  })

  test('a count through a sub-table’s parent keeps to the holding Table', () => {
    expect(choiceCountQuery('Item', [], { table: 'Order', link: { kind: 'through', link: 'Order Line', back: 'item', column: 'parent' } }).filters)
      .toEqual([['item', 'related', { table: 'Item', filters: [] }], ['parenttype', '=', 'Order']])
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
    ['a search, none picked', [{ table: 'Division', link: { kind: 'forward', column: 'division' }, picked: [], search: { column: 'title', text: 'Sar' } }]],
  ] as [string, ChainStep[]][])('%s reads back as the chain it was built from', (_, steps) => {
    expect(parseChain(chainFilter(steps))).toEqual({ negate: false, steps })
    expect(parseChain(chainFilter(steps, true))).toEqual({ negate: true, steps })
  })

  test.each([
    ['a parentfield', ['x', 'related', { table: 'T', parentfield: 'p' }]],
    ['filters that are not filters', ['x', 'related', { table: 'T', filters: [1] }]],
    ['a via read from a column', ['x', 'related', { via: 'V', column: 'c', table: 'T' }]],
    ['a via without its column', ['row_id', 'related', { table: 'T', via: 'V' }]],
    ['a far side whose filters are not filters', ['row_id', 'related', { table: 'L', column: 'e', filters: [['r', 'related', { table: 'R', filters: 'bad' }]] }]],
    ['a next step that is not one', ['x', 'related', { table: 'T', filters: [['y', 'related', 'bad']] }]],
  ] as [string, [string, string, unknown]][])('%s is not a chain', (_, filter) => {
    expect(parseChain(filter)).toBeNull()
  })

  test('a filter that is not a chain reads as none', () => {
    expect(parseChain(['status', '=', 'Open'])).toBeNull()
    expect(parseChain(['x', 'related', 'nope'])).toBeNull()
    expect(parseChain(['x', 'related', { table: 'T', filters: [['title', '=', 'a']] }])).toBeNull()
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
  const SUPPLIER = table('Supplier', [])
  const PO = table('Purchase Order', [ref('supplier', 'Supplier'), { column_name: 'lines', column_type: 'Sub-table', row_table: 'PO Line' }])
  const PO_LINE = table('PO Line', [ref('item', 'Item')], { kind: 'sub_table' })
  const ORDER_V = table('Order', [{ column_name: 'lines', column_type: 'Sub-table', row_table: 'Order Line' }])
  const now: Record<string, TableMeta> = { Supplier: SUPPLIER, 'Purchase Order': PO, 'PO Line': PO_LINE, Item: ITEM, Order: ORDER_V, 'Order Line': LINE }
  const known = (t: string) => now[t]
  const chain = JSON.stringify([{ mode: 'backlink', table: 'Purchase Order', column: 'supplier' }, { mode: 'child', table: 'PO Line', column: 'lines' }])

  test('a chain opens the last pane’s list, linked back to the first pane’s picks', () => {
    expect(exploreToList({ root: 'Supplier', chain, select: JSON.stringify(['S-1']) }, known)).toEqual({
      table: 'PO Line',
      filters: [['parentfield', '=', 'lines'], ['parent', 'related', { table: 'Purchase Order', filters: [['supplier', 'related', { table: 'Supplier', filters: [['row_id', 'in', ['S-1']]] }]] }]],
    })
    expect(exploreTables({ root: 'Supplier', chain })).toEqual(['Supplier', 'Purchase Order', 'PO Line'])
  })

  test('a via step and no picks follow every related row', () => {
    expect(exploreToList({ root: 'Item', chain: JSON.stringify([{ mode: 'viabacklink', table: 'Order', column: 'item', via: 'Order Line' }]) }, known))
      .toEqual({ table: 'Order', filters: [['row_id', 'related', { via: 'Order Line', column: 'item', table: 'Item', filters: [] }]] })
  })

  test('a link removed since stops the chain at the last step that still holds', () => {
    const gone = (t: string) => (t === 'Purchase Order' ? table('Purchase Order', [{ column_name: 'lines', column_type: 'Sub-table', row_table: 'PO Line' }]) : known(t))
    expect(exploreToList({ root: 'Supplier', chain }, gone)).toEqual({ table: 'Supplier', filters: [] })
    const noLines = (t: string) => (t === 'Purchase Order' ? table('Purchase Order', [ref('supplier', 'Supplier')]) : known(t))
    expect(exploreToList({ root: 'Supplier', chain }, noLines)?.table).toBe('Purchase Order')
    // A child step in the middle keeps its Sub-table column inside the next step.
    const twoSteps = JSON.stringify([{ mode: 'child', table: 'PO Line', column: 'lines' }, { mode: 'backlink', table: 'Item', column: 'x' }])
    const line = table('PO Line', [ref('item', 'Item')], { kind: 'sub_table' })
    const itemBack = (t: string) => (t === 'Item' ? table('Item', [ref('x', 'PO Line')]) : t === 'PO Line' ? line : known(t))
    expect(exploreToList({ root: 'Purchase Order', chain: twoSteps }, itemBack)?.filters).toEqual([['x', 'related', {
      table: 'PO Line', filters: [['parentfield', '=', 'lines'], ['parent', 'related', { table: 'Purchase Order', filters: [] }]],
    }]])
    expect(exploreToList({ root: 'Ghost', chain }, known)).toBeNull()
  })

  test('steps that are not Explore steps are left out, and a step whose Table is gone ends the chain', () => {
    // An address holds at most two steps.
    expect(exploreTables({ root: 'Supplier', chain: JSON.stringify([null, { mode: 'backlink', table: 'X', column: 'c', via: 'v' }]) })).toEqual(['Supplier'])
    expect(exploreTables({ root: 'Supplier', chain: JSON.stringify([{ mode: 'child', table: 1, column: 'c' }]) })).toEqual(['Supplier'])
    expect(exploreToList({ root: 'Supplier', chain: JSON.stringify([{ mode: 'backlink', table: 'Ghost', column: 'supplier' }]) }, known))
      .toEqual({ table: 'Supplier', filters: [] })
  })

  test('a malformed address keeps what reads, and no root is no list', () => {
    expect(exploreToList({ root: 'Supplier', chain: '{oops', select: '[1]' }, known)).toEqual({ table: 'Supplier', filters: [] })
    expect(exploreToList({ root: 'Supplier', chain: JSON.stringify([{ mode: 'nope' }]) }, known)).toEqual({ table: 'Supplier', filters: [] })
    expect(exploreToList({}, known)).toBeNull()
  })
})
