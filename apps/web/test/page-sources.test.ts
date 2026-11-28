// A runtime page's data sources (#1410): what a Table source asks the list API
// for, which sources a part needs, and the values typed on the page laid over
// the rows that were read. Pure functions: no server, no database.
import { describe, expect, test } from 'vitest'
import { PAGE_EXAMPLE, PAGE_ROW_CAP, type PagePart } from 'shared'
import { columnsRead, forgetTyped, sourceRequest, sourcesRead, typeInto, withTyped } from '../src/runtime/sources'

describe('what a Table source asks for', () => {
  test('its filters and order go as written, and it asks for the most rows a page may read', () => {
    expect(sourceRequest({ table: 'Reorder Line', filters: [['month', '=', '2026-12']], order_by: 'category asc' }, {}))
      .toEqual({ table: 'Reorder Line', filters: [['month', '=', '2026-12']], fields: ['row_id', 'updated_at'], order_by: 'category asc', limit_page_length: PAGE_ROW_CAP })
  })

  test('a filter on the page\'s state is asked with the state\'s value', () => {
    expect(sourceRequest({ table: 'Reorder Line', filters: [['month', '=', { '@path': '/state/month' }]] }, { month: '2026-11' }).filters).toEqual([['month', '=', '2026-11']])
  })

  test('listed columns are asked for with the columns every row carries', () => {
    expect(sourceRequest({ table: 'Reorder Line', columns: ['item', 'sold_qty'] }, {}, ['item']).fields).toEqual(['item', 'sold_qty', 'row_id', 'updated_at'])
  })

  test('a column every row carries is not asked for twice', () => {
    expect(sourceRequest({ table: 'Reorder Line', columns: ['row_id', 'item'] }, {}).fields).toEqual(['row_id', 'item', 'updated_at'])
  })

  test('a source that lists no columns asks for the ones the page reads from it', () => {
    expect(sourceRequest({ table: 'Reorder Line' }, {}, ['category', 'item', 'category']).fields).toEqual(['category', 'item', 'row_id', 'updated_at'])
  })

  test('its own limit is asked for when it has one', () => {
    expect(sourceRequest({ table: 'Reorder Line', limit: 20 }, {}).limit_page_length).toBe(20)
  })
})

describe('the sources a part needs', () => {
  const part = (id: string) => PAGE_EXAMPLE.components.find((each) => each.id === id)!

  test('a table needs the source its rows come from', () => {
    expect(sourcesRead(part('plan'))).toEqual(['lines'])
  })

  test('a part that reads only state and its own row needs none', () => {
    expect([sourcesRead(part('measure')), sourcesRead(part('plan_save'))]).toEqual([[], []])
  })

  test('a part repeated over a source\'s rows needs that source', () => {
    expect(sourcesRead({ id: 'cards', component: 'Stack', children: { componentId: 'card', path: '/data/lines' } })).toEqual(['lines'])
  })

  test('text with a value from a source put in needs that source, once', () => {
    const text: PagePart = { id: 'first', component: 'Text', text: { '@call': 'formatString', args: { value: '${/data/prices/0/item} and ${/data/prices/1/item}' } } }
    expect(sourcesRead(text)).toEqual(['prices'])
  })
})

describe('what was typed, laid over the rows that were read', () => {
  const ROWS = [{ row_id: 'RL-1', item: 'Notebook A5', planned_qty: null }, { row_id: 'RL-2', item: 'Gel Pen', planned_qty: 600 }]

  test('a row with a typed value shows it', () => {
    expect(withTyped(ROWS, { 'RL-1': { planned_qty: 700 } })[0]).toEqual({ row_id: 'RL-1', item: 'Notebook A5', planned_qty: 700 })
  })

  test('a row with nothing typed is the row that was read', () => {
    expect(withTyped(ROWS, { 'RL-1': { planned_qty: 700 } })[1]).toBe(ROWS[1])
  })

  test('a row with no id of its own is told apart by its place', () => {
    expect(withTyped([{ item: 'Notebook A5' }, { item: 'Gel Pen' }], { 1: { item: 'Gel Pen, Blue' } })).toEqual([{ item: 'Notebook A5' }, { item: 'Gel Pen, Blue' }])
  })
})

describe('typing into a row', () => {
  const DATA = { lines: [{ row_id: 'RL-1', planned_qty: null }, { row_id: 'RL-2', planned_qty: 600, notes: { colour: 'blue', size: 'A5' } }] }

  test('the value is kept under the row\'s own id, not its place', () => {
    expect(typeInto({}, DATA, '/data/lines/1/planned_qty', 650)).toEqual({ lines: { 'RL-2': { planned_qty: 650 } } })
  })

  test('a second value typed into the same row joins the first', () => {
    const typed = typeInto({}, DATA, '/data/lines/1/planned_qty', 650)
    expect(typeInto(typed, { lines: withTyped(DATA.lines, typed.lines) }, '/data/lines/1/notes/colour', 'black'))
      .toEqual({ lines: { 'RL-2': { planned_qty: 650, notes: { colour: 'black', size: 'A5' } } } })
  })

  test('what was typed before is not changed in place', () => {
    const typed = typeInto({}, DATA, '/data/lines/0/planned_qty', 700)
    typeInto(typed, DATA, '/data/lines/1/planned_qty', 650)
    expect(typed).toEqual({ lines: { 'RL-1': { planned_qty: 700 } } })
  })

  test.each(['/data/lines/7/planned_qty', '/data/prices/0/price', '/data/lines/0', '/data/lines'])('a path that is no column of a row on the page (%s) types nothing', (path) => {
    expect(typeInto({}, DATA, path, 1)).toEqual({})
  })
})

describe('once a row is saved', () => {
  const TYPED = { lines: { 'RL-1': { planned_qty: 700 }, 'RL-2': { planned_qty: 650 } }, prices: { 'RL-1': { price: 20 } } }

  test('what was typed into it is no longer waiting, in the sources of its Table', () => {
    expect(forgetTyped(TYPED, ['lines'], 'RL-1')).toEqual({ lines: { 'RL-2': { planned_qty: 650 } }, prices: { 'RL-1': { price: 20 } } })
  })
})

describe('the columns a page reads from each source', () => {
  test('the worked example reads what it filters, orders, groups, shows and saves', () => {
    expect(columnsRead(PAGE_EXAMPLE).lines!.sort()).toEqual(['category', 'item', 'month', 'planned_qty', 'returned_qty', 'returned_value', 'row_id', 'sold_qty', 'sold_value', 'suggested_qty', 'suggested_value', 'updated_at'])
  })
})
