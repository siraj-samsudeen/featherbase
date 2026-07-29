import { describe, expect, test } from 'vitest'
import {
  coerceRows,
  inferColumnType,
  inferTableDef,
  sanitizeColumnName,
  sanitizeHeaders,
  tableNameFromFile,
} from 'shared'

// IMP-001..004: the pure inference layer behind the drag-drop Table builder.
// (Shared-package tests live in the server suite by convention.)

describe('IMP-001: sanitizeColumnName', () => {
  test.each([
    ['Full Name', 'full_name'],
    ['  Email Address  ', 'email_address'],
    ['unitPrice', 'unit_price'],
    ['Qty (kg)', 'qty_kg'],
    ['order#', 'order'],
    ['ORDER ID', 'order_id'],
    ['crème brûlée', 'cr_me_br_l_e'],
    ['123 total', 'col_123_total'],
    ['---', ''],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeColumnName(input)).toBe(expected)
  })

  test('caps at 63 chars to fit the server column_name rule', () => {
    expect(sanitizeColumnName('x'.repeat(100)).length).toBe(63)
  })
})

describe('IMP-001: sanitizeHeaders', () => {
  test('blank headers become positional col_N', () => {
    expect(sanitizeHeaders(['a', '', 'b'])).toEqual(['a', 'col_2', 'b'])
  })

  test('duplicates get numeric suffixes', () => {
    expect(sanitizeHeaders(['amount', 'Amount', 'AMOUNT'])).toEqual([
      'amount',
      'amount_1',
      'amount_2',
    ])
  })

  test('reserved standard columns step aside', () => {
    expect(sanitizeHeaders(['name', 'status', 'parent', 'title'])).toEqual([
      'name_1',
      'status_1',
      'parent_1',
      'title',
    ])
  })
})

describe('IMP-002: inferColumnType', () => {
  test.each([
    [['1', '42', '-7'], 'Int'],
    [[1, 42, -7], 'Int'],
    [['1.5', '2', '-0.25'], 'Float'],
    [[1.5, 2], 'Float'],
    [['yes', 'no', 'YES'], 'Check'],
    [['true', 'false'], 'Check'],
    [[true, false], 'Check'],
    [['2026-01-15', '2025-12-31'], 'Date'],
    [['2026-01-15T10:30:00Z', '2026-01-15 08:00'], 'Datetime'],
    [['hello', 'world'], 'Data'],
    [['1', 'apple'], 'Data'],
    [['0', '1'], 'Int'], // ambiguous with Check; Int wins, user can flip it
    [[], 'Data'],
    [['', null, undefined], 'Data'],
  ])('%j -> %s', (values, expected) => {
    expect(inferColumnType(values as unknown[])).toBe(expected)
  })

  test('values over 140 chars force Text', () => {
    expect(inferColumnType(['short', 'x'.repeat(141)])).toBe('Text')
  })

  test('multiline values force Text', () => {
    expect(inferColumnType(['line one\nline two'])).toBe('Text')
  })

  test('empty cells are ignored when sampling', () => {
    expect(inferColumnType(['', '3', null, '7'])).toBe('Int')
  })

  test('a midnight JS Date (SheetJS date cell) is a Date, with time a Datetime', () => {
    expect(inferColumnType([new Date(2026, 0, 15)])).toBe('Date')
    expect(inferColumnType([new Date(2026, 0, 15, 10, 30)])).toBe('Datetime')
  })
})

describe('IMP-003: inferTableDef', () => {
  test('builds a full doctype payload with labels from original headers', () => {
    const def = inferTableDef(
      'Order',
      ['Customer Name', 'Qty', 'Unit Price', 'Ship Date', 'Notes'],
      [
        ['Alice', '2', '9.99', '2026-01-15', 'first'],
        ['Bob', '5', '12.5', '2026-02-01', ''],
      ],
    )
    expect(def.name).toBe('Order')
    expect(def.columns).toEqual([
      { column_name: 'customer_name', label: 'Customer Name', column_type: 'Data', reqd: false, in_list_view: true },
      { column_name: 'qty', label: 'Qty', column_type: 'Int', reqd: false, in_list_view: true },
      { column_name: 'unit_price', label: 'Unit Price', column_type: 'Float', reqd: false, in_list_view: true },
      { column_name: 'ship_date', label: 'Ship Date', column_type: 'Date', reqd: false, in_list_view: true },
      { column_name: 'notes', label: 'Notes', column_type: 'Data', reqd: false, in_list_view: false },
    ])
  })
})

describe('IMP-003: tableNameFromFile', () => {
  test.each([
    ['customer orders.csv', 'Customer Orders'],
    ['sales-2026.xlsx', 'Sales 2026'],
    ['inventoryItems.csv', 'Inventory Items'],
    ['2026 report.csv', 'Report'],
  ])('%j -> %j', (file, expected) => {
    expect(tableNameFromFile(file)).toBe(expected)
  })
})

describe('IMP-004: coerceRows', () => {
  const columns = [
    { column_name: 'title', column_type: 'Data' },
    { column_name: 'qty', column_type: 'Int' },
    { column_name: 'active', column_type: 'Check' },
    { column_name: 'due', column_type: 'Date' },
  ]

  test('coerces per column type and omits empty cells', () => {
    const rows = coerceRows(columns, [
      ['A', '3', 'yes', new Date(2026, 0, 15)],
      ['B', '', 'no', '2026-02-01'],
    ])
    expect(rows).toEqual([
      { title: 'A', qty: '3', active: true, due: '2026-01-15' },
      { title: 'B', active: false, due: '2026-02-01' },
    ])
  })

  test('fully empty rows are dropped', () => {
    expect(coerceRows(columns, [['', null, '', undefined], ['C']])).toEqual([{ title: 'C' }])
  })
})
