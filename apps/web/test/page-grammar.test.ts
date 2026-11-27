// The runtime page grammar (#1410): reading a path, resolving a value, the named
// functions, writing back and an action's context. Pure functions: no server,
// no database. Made-up data: a shop's reorder lines.
import { describe, expect, test } from 'vitest'
import { absolutePath, asTyped, formatNumber, readPath, resolveContext, resolveValue, writePath, type PageModel } from '../src/runtime/grammar'

const NOTEBOOK = { row_id: 'RL-1', item: 'Notebook A5', category: 'Stationery', sold_qty: 820, sold_value: 16400, suggested_qty: 760, planned_qty: null, updated_at: '2026-11-27T10:00:00.000Z' }
const GEL_PEN = { row_id: 'RL-2', item: 'Gel Pen', category: 'Stationery', sold_qty: 690, sold_value: 6900, suggested_qty: 640, planned_qty: 600, updated_at: '2026-11-27T10:00:00.000Z' }
const MODEL: PageModel = { state: { measure: 'quantity', open: '' }, data: { lines: [NOTEBOOK, GEL_PEN] } }
const TOP = { model: MODEL }
const IN_ROW = { model: MODEL, row: NOTEBOOK, at: '/data/lines/0' }

describe('reading a path', () => {
  test('a path from the top reads the page\'s state', () => {
    expect(readPath('/state/measure', TOP)).toBe('quantity')
  })

  test('a path from the top reads the rows of a data source', () => {
    expect(readPath('/data/lines', TOP)).toBe(MODEL.data.lines)
  })

  test('a path from the top reaches into one row by its place', () => {
    expect(readPath('/data/lines/1/item', TOP)).toBe('Gel Pen')
  })

  test('a path with no leading slash reads the row being drawn', () => {
    expect(readPath('item', IN_ROW)).toBe('Notebook A5')
  })

  test('a path to something that is not there reads as nothing', () => {
    expect(readPath('/data/prices/0/item', TOP)).toBeUndefined()
  })

  test('a row path outside a row reads as nothing', () => {
    expect(readPath('item', TOP)).toBeUndefined()
  })
})

describe('resolving a value', () => {
  test('a literal is itself', () => {
    expect(resolveValue('Reorder Plan', TOP)).toBe('Reorder Plan')
  })

  test('a {"@path"} is the value at that path', () => {
    expect(resolveValue({ '@path': 'sold_qty' }, IN_ROW)).toBe(820)
  })

  test('a {"@call"} is what its function answers', () => {
    expect(resolveValue({ '@call': 'eq', args: { a: { '@path': '/state/measure' }, b: 'quantity' } }, TOP)).toBe(true)
  })
})

describe('the named functions', () => {
  const call = (name: string, args: Record<string, unknown>, scope = IN_ROW) => resolveValue({ '@call': name, args }, scope)

  test('eq is false for two different values', () => {
    expect(call('eq', { a: { '@path': '/state/measure' }, b: 'value' })).toBe(false)
  })

  test.each([[0, true], ['', true], [null, true], [1, false], ['x', false]])('not %j is %j', (value, answer) => {
    expect(call('not', { value })).toBe(answer)
  })

  test('and is true only when every value is', () => {
    expect([call('and', { values: [true, { '@path': 'sold_qty' }] }), call('and', { values: [true, { '@path': 'planned_qty' }] })]).toEqual([true, false])
  })

  test('or is true when any value is', () => {
    expect([call('or', { values: [false, { '@path': 'sold_qty' }] }), call('or', { values: [false, { '@path': 'planned_qty' }] })]).toEqual([true, false])
  })

  test('choose picks the one of "from" that the key names', () => {
    const from = { value: { '@path': 'sold_value' }, quantity: { '@path': 'sold_qty' } }
    expect(call('choose', { key: { '@path': '/state/measure' }, from })).toBe(820)
  })

  test('choose answers "otherwise" for a key "from" does not have', () => {
    expect(call('choose', { key: 'weight', from: { quantity: 1 }, otherwise: { '@path': 'item' } })).toBe('Notebook A5')
  })

  test('choose with no match and no "otherwise" answers nothing', () => {
    expect(call('choose', { key: 'weight', from: { quantity: 1 } })).toBeNull()
  })

  test('formatNumber separates the thousands', () => {
    expect(call('formatNumber', { value: { '@path': 'sold_value' } })).toBe('16,400')
  })

  test('formatNumber shows the places it is asked for', () => {
    expect(call('formatNumber', { value: 16400.5, decimals: 2 })).toBe('16,400.50')
  })

  test('formatNumber with no places asked keeps up to two, and no more', () => {
    expect([call('formatNumber', { value: 12.5 }), call('formatNumber', { value: 0.126 })]).toEqual(['12.5', '0.13'])
  })

  test('formatNumber reads a number written as text', () => {
    expect(call('formatNumber', { value: '1510' })).toBe('1,510')
  })

  test.each([[null], ['about ten'], [true]])('formatNumber of %j, which is no number, is a dash', (value) => {
    expect(call('formatNumber', { value })).toBe('—')
  })

  test('formatNumber of a number that is not finite is a dash', () => {
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('—')
  })

  test('formatCurrency is rupees to two places unless told otherwise', () => {
    expect(call('formatCurrency', { value: 16400 })).toBe('₹16,400.00')
  })

  test('formatCurrency takes a currency and its places', () => {
    expect(call('formatCurrency', { value: 16400, currency: 'USD', decimals: 0 })).toBe('$16,400')
  })

  test('formatCurrency of nothing is a dash', () => {
    expect(call('formatCurrency', { value: null })).toBe('—')
  })

  test('formatDate writes a day as DD-Mon-YYYY', () => {
    expect(call('formatDate', { value: '2026-12-01' })).toBe('01-Dec-2026')
  })

  test('formatDate reads the day of an instant', () => {
    expect(call('formatDate', { value: '2026-12-01T00:00:00.000Z' })).toBe('01-Dec-2026')
  })

  test.each([[null], [''], ['next week'], [5]])('formatDate of %j, which is no day, is a dash', (value) => {
    expect(call('formatDate', { value })).toBe('—')
  })

  test('formatString puts the value at each ${path} into the text', () => {
    expect(call('formatString', { value: '${item}: ${sold_qty} sold as a ${/state/measure}' })).toBe('Notebook A5: 820 sold as a quantity')
  })

  test('formatString leaves a gap where a path has no value', () => {
    expect(call('formatString', { value: 'Planned: ${planned_qty}.' })).toBe('Planned: .')
  })

  test('formatString takes its text from a path too', () => {
    expect(call('formatString', { value: { '@path': 'item' } })).toBe('Notebook A5')
  })
})

describe('writing a value back', () => {
  test('the new model holds the value at the path', () => {
    expect(readPath('/data/lines/0/planned_qty', { model: writePath(MODEL, '/data/lines/0/planned_qty', 700) })).toBe(700)
  })

  test('the old model is left as it was', () => {
    writePath(MODEL, '/data/lines/0/planned_qty', 700)
    expect(MODEL.data.lines![0]!.planned_qty).toBeNull()
  })

  test('what the path does not pass through is the same object as before', () => {
    const next = writePath(MODEL, '/data/lines/0/planned_qty', 700)
    expect([next.data.lines![1], next.state]).toEqual([GEL_PEN, MODEL.state])
    expect(next.data.lines![1]).toBe(GEL_PEN)
  })

  test('a path through something not yet there makes it', () => {
    expect(writePath({}, '/lines/RL-1/planned_qty', 700)).toEqual({ lines: { 'RL-1': { planned_qty: 700 } } })
  })

  test('a row path is written at the row\'s own place', () => {
    expect(absolutePath('planned_qty', IN_ROW)).toBe('/data/lines/0/planned_qty')
  })

  test('a path from the top is already where it is written', () => {
    expect(absolutePath('/state/open', IN_ROW)).toBe('/state/open')
  })
})

describe('an action\'s context', () => {
  test('text is kept as written, a value is resolved, and each named value of a set is resolved', () => {
    const event = { name: 'save_row' as const, context: {
      table: 'Reorder Line', row: { '@path': 'row_id' }, updated_at: { '@path': 'updated_at' },
      values: { planned_qty: { '@path': 'suggested_qty' } },
    } }
    expect(resolveContext(event, IN_ROW)).toEqual({ table: 'Reorder Line', row: 'RL-1', updated_at: '2026-11-27T10:00:00.000Z', values: { planned_qty: 760 } })
  })

  test('a key the action was not given is left out', () => {
    expect(resolveContext({ name: 'open_page', context: { page: 'reorder-plan' } }, TOP)).toEqual({ page: 'reorder-plan' })
  })
})

describe('what a box gives the page', () => {
  test.each([['12', 12], ['1.5', 1.5], ['', null]])('a number box holding %j gives %j', (typed, given) => {
    expect(asTyped(typed, 'number')).toBe(given)
  })

  test.each([['12', '12'], ['', '']])('a text box holding %j gives the text as typed', (typed, given) => {
    expect(asTyped(typed, undefined)).toBe(given)
  })
})
