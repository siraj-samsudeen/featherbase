// #1282 I1: where the sideways step's other rows come from, read from the path alone.
import { describe, expect, test } from 'vitest'
import { listSiblings, shownRecord } from '../src/components/SidewaysMenu'
import type { NavPath, NavStep } from '../src/lib/nav-path'

const path = (...steps: NavStep[]): NavPath => ({ steps, at: steps.length - 1 })
const orders: NavStep = { screen: 'list', table: 'Order', filters: [['customer', '=', 'c1']] }

describe('the record a step shows', () => {
  test("the pane's record, else the page's, else none", () => {
    expect(shownRecord({ ...orders, pane: { table: 'Order', row: 'o1' } })).toEqual({ table: 'Order', row: 'o1' })
    expect(shownRecord({ screen: 'row', table: 'Order', row: 'o2' })).toEqual({ table: 'Order', row: 'o2' })
    expect(shownRecord(orders)).toBeNull()
    expect(shownRecord(undefined)).toBeNull()
  })
})

describe("a step's siblings from the path", () => {
  test('a list with one of its own rows in the pane: that list, its filters', () => {
    const here: NavStep = { ...orders, pane: { table: 'Order', row: 'o3' } }
    const s = listSiblings(path(orders, here))!
    expect([s.table, s.filters, s.rowId]).toEqual(['Order', [['customer', '=', 'c1']], 'o3'])
    expect(s.stepFor('o5')).toEqual({ ...orders, pane: { table: 'Order', row: 'o5' } })
  })

  test("a row page reached from a list of its Table: that list's filters; another row keeps its tab", () => {
    const page: NavStep = { screen: 'row', table: 'Order', row: 'o3', view: 'map' }
    const s = listSiblings(path(orders, page))!
    expect([s.table, s.filters, s.rowId]).toEqual(['Order', [['customer', '=', 'c1']], 'o3'])
    expect(s.stepFor('o5')).toEqual({ screen: 'row', table: 'Order', row: 'o5', view: 'map' })
  })

  test('no list there: a group in the pane, a page reached from another Table, or no step at all', () => {
    expect(listSiblings(path({ ...orders, pane: { table: 'Customer', row: 'c1', group: { table: 'Order', column: 'customer' } } }))).toBeNull()
    expect(listSiblings(path({ screen: 'list', table: 'Customer' }, { screen: 'row', table: 'Order', row: 'o3' }))).toBeNull()
    expect(listSiblings({ steps: [], at: -1 })).toBeNull()
  })
})
