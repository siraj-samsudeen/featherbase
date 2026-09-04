import { describe, expect, test } from 'vitest'
import {
  applyColumnCombines,
  autoMapColumns,
  coerceRows,
  combineOverlap,
  COMBINE_JOIN_SEPARATOR,
  idPatternFor,
  inferChoices,
  inferColumnType,
  inferTableDef,
  mergeSheetHeaders,
  mergeSheetRows,
  namesShareToken,
  prettifyLabel,
  sanitizeColumnName,
  sanitizeHeaders,
  scoreTableMatch,
  seriesPrefix,
  shouldAutoMatch,
  tableMatchQuality,
  tableNameFromFile,
} from '../src/import'

// The sheet-merging half of `src/import.ts` (#201/#211, issue #197), tested
// in its own package rather than from the server suite.
//
// `apps/server/test/import/infer.test.ts` notes that shared-package tests
// live in the server suite by convention. That convention is also what
// `packages/shared/vitest.config.ts` names as the whole of this package's
// coverage gap: coverage is per-package, so a server run cannot credit
// `src/import.ts` here. These functions need no database and no HTTP — the
// decision tree in docs/TESTING.md puts pure, I/O-free code in this suite —
// so the code added by #201/#211 is verified where it lives.

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
    expect(sanitizeHeaders(['row_id', 'status', 'parent', 'title'])).toEqual([
      'row_id_1',
      'status_1',
      'parent_1',
      'title',
    ])
  })

  // #132: the row key is `row_id`, so `name` is an ordinary header again —
  // the whole point of the rename (Student.name, Customer.name).
  test('a header called name is no longer reserved', () => {
    expect(sanitizeHeaders(['name', 'title'])).toEqual(['name', 'title'])
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
  test('builds a full table payload with labels from original headers', () => {
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

describe('NAM-001: id pattern inferred for imported Tables', () => {
  test.each([
    ['Zone', 'ZONE-'],
    ['Sales Invoice', 'SALES-INVOICE-'],
    ['zone master', 'ZONE-MASTER-'],
    ['Sales 2026', 'SALES-2026-'],
    ['', ''],
  ])('seriesPrefix(%j) -> %j', (name, expected) => {
    expect(seriesPrefix(name)).toBe(expected)
  })

  test('a dot never survives into a prefix — resolveName splits the pattern there', () => {
    expect(seriesPrefix('Zone.Master')).toBe('ZONE-MASTER-')
  })

  test('idPatternFor composes prefix and digits, and falls back to hash', () => {
    expect(idPatternFor('Zone')).toBe('ZONE-.###')
    expect(idPatternFor('Zone', 1)).toBe('ZONE-.#')
    expect(idPatternFor('')).toBe('hash')
  })

  test('inferTableDef defaults an imported Table to a readable series', () => {
    const def = inferTableDef('Zone', ['Zone Name'], [['Chennai'], ['Salem']])
    expect(def.id_pattern).toBe('ZONE-.###')
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

describe('IMP-008: inferChoices', () => {
  const repeat = (options: string[], times: number) =>
    Array.from({ length: times * options.length }, (_, i) => options[i % options.length])

  test('a repeated small set of values reads as choices, sorted', () => {
    expect(inferChoices(repeat(['Open', 'Closed', 'Pending'], 4))).toEqual([
      'Closed',
      'Open',
      'Pending',
    ])
  })

  test('too few samples, too many distinct values, or near-unique values decline', () => {
    expect(inferChoices(['Open', 'Closed'])).toBeNull() // < 6 samples
    expect(inferChoices(repeat(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 3))).toBeNull() // > 8 distinct
    expect(inferChoices(['u1', 'u2', 'u3', 'u4', 'u5', 'u6'])).toBeNull() // each value ~unique
  })

  test('long or multiline values decline', () => {
    expect(inferChoices(repeat(['x'.repeat(61), 'y'], 4))).toBeNull()
    expect(inferChoices(repeat(['one\ntwo', 'three'], 4))).toBeNull()
  })

  test('inferTableDef turns a qualifying Data column into a Choice column', () => {
    const stages = ['New', 'Done', 'New', 'Done', 'New', 'Done', 'New', 'Done', 'New']
    const def = inferTableDef(
      'T',
      ['Title', 'Stage'],
      stages.map((s, i) => [`row ${i}`, s]),
    )
    expect(def.columns[0].column_type).toBe('Data') // titles stay Data
    expect(def.columns[1].column_type).toBe('Choice')
    expect(def.columns[1].choices).toBe('Done\nNew')
  })
})

describe('IMP-012: prettifyLabel', () => {
  test.each([
    ['Reg_District_ID', 'Reg District ID'],
    ['Active_flag', 'Active Flag'],
    ['zone name', 'Zone Name'],
    ['ORDER ID', 'Order ID'],
    ['unitPrice', 'Unit Price'],
    ['Qty (kg)', 'Qty (kg)'],
    ['SKU', 'SKU'],
    ['Customer Name', 'Customer Name'],
    ['col_2', 'Col 2'],
  ])('%j -> %j', (input, expected) => {
    expect(prettifyLabel(input)).toBe(expected)
  })

  test('inferTableDef normalizes messy headers into consistent labels', () => {
    const def = inferTableDef(
      'Zone',
      ['Zone ID', 'Zone Name', 'Reg_District_ID', 'Active_flag'],
      [['1', 'North', '7', '1']],
    )
    expect(def.columns.map((c) => c.label)).toEqual([
      'Zone ID',
      'Zone Name',
      'Reg District ID',
      'Active Flag',
    ])
    // The machine names stay snake_case as before.
    expect(def.columns.map((c) => c.column_name)).toEqual([
      'zone_id',
      'zone_name',
      'reg_district_id',
      'active_flag',
    ])
  })
})

describe('IMP-012: bidirectional auto-match', () => {
  const registrationDistrict = [
    { column_name: 'zone_id', label: 'Zone ID' },
    { column_name: 'zone_name', label: 'Zone Name' },
    { column_name: 'reg_district_id', label: 'Reg_District_ID' },
    { column_name: 'registration_district', label: 'Registration_District' },
    { column_name: 'active_flag', label: 'Active_flag' },
  ]
  const zoneHeaders = ['Zone Id', 'Zone Name', 'Active Flag']

  test('quality reports both directions', () => {
    const q = tableMatchQuality(zoneHeaders, registrationDistrict)
    expect(q.score).toBe(1) // all sheet headers fit...
    expect(q.coverage).toBeCloseTo(3 / 5) // ...but only 3 of 5 target columns
    expect(q.mapped).toBe(3)
  })

  test('the real Zone case: perfect score, weak coverage, no name overlap -> NO auto-match', () => {
    const q = tableMatchQuality(zoneHeaders, registrationDistrict)
    expect(shouldAutoMatch('Zone', 'Registration District', q)).toBe(false)
  })

  test('full coverage auto-matches even under a junk sheet name', () => {
    const stock = [
      { column_name: 'wizard_sku', label: 'Wizard SKU' },
      { column_name: 'bin_count', label: 'Bin Count' },
      { column_name: 'restock_level', label: 'Restock Level' },
    ]
    const q = tableMatchQuality(['Wizard SKU', 'Bin Count', 'Restock Level'], stock)
    expect(shouldAutoMatch('export-final-v2 (3)', 'Wizard Stock', q)).toBe(true)
  })

  test('matching names rescue a weak-coverage match', () => {
    const q = tableMatchQuality(zoneHeaders, registrationDistrict)
    expect(shouldAutoMatch('Zone', 'Zone Registration', q)).toBe(true) // shares "zone"
  })

  test('namesShareToken ignores single-letter noise and case', () => {
    expect(namesShareToken('zone', 'Zone')).toBe(true)
    expect(namesShareToken('zone', 'Registration District')).toBe(false)
    expect(namesShareToken('a b', 'b c')).toBe(false) // 1-char tokens dropped
  })
})

describe('IMP-009: autoMapColumns / scoreTableMatch', () => {
  const targets = [
    { column_name: 'customer_name', label: 'Customer Name' },
    { column_name: 'qty', label: 'Quantity' },
    { column_name: 'ship_date', label: 'Ship Date' },
  ]

  test('maps by sanitized column_name, then by sanitized label', () => {
    expect(autoMapColumns(['Customer Name', 'Quantity', 'shipdate'], targets)).toEqual([
      'customer_name', // header sanitizes to the column_name
      'qty', // header matches the label, not the name
      null, // no match ('shipdate' != 'ship_date')
    ])
  })

  test('a target column is never claimed twice', () => {
    expect(autoMapColumns(['qty', 'Quantity'], targets)).toEqual(['qty', null])
  })

  test('scoreTableMatch is the mapped fraction, ignoring blank headers', () => {
    expect(scoreTableMatch(['Customer Name', 'Qty', 'Ship Date'], targets)).toBe(1)
    expect(scoreTableMatch(['Customer Name', 'Qty', 'Unrelated'], targets)).toBeCloseTo(2 / 3)
    expect(scoreTableMatch(['', 'Qty'], targets)).toBe(1) // blank ignored
    expect(scoreTableMatch(['x', 'y'], targets)).toBe(0)
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
      { values: { title: 'A', qty: '3', active: true, due: '2026-01-15' }, sourceIndex: 0 },
      { values: { title: 'B', active: false, due: '2026-02-01' }, sourceIndex: 1 },
    ])
  })

  test('fully empty rows are dropped — but the survivor keeps its source index (#115)', () => {
    expect(coerceRows(columns, [['', null, '', undefined], ['C']])).toEqual([
      { values: { title: 'C' }, sourceIndex: 1 },
    ])
  })
})

// #201 (issue #197): merging several sheets into one Table. The folding rule
// is sanitizeColumnName — reused, not reinvented — and nothing beyond folding
// is ever guessed.
describe('mergeSheetHeaders', () => {
  test('case, spaces and underscores fold into one column', () => {
    const merged = mergeSheetHeaders([
      ['Zone', 'Floor', 'SKU Count'],
      ['Zone', 'FLOOR', 'SKU_Count'],
      ['zone', 'Floor ', 'sku count'],
    ])
    expect(merged.map((c) => c.key)).toEqual(['zone', 'floor', 'sku_count'])
    // Every raw spelling is kept, so the UI can disclose what it folded —
    // a trailing space is invisible on screen and must still be explainable.
    expect(merged[1].spellings).toEqual(['Floor', 'FLOOR', 'Floor '])
    expect(merged[1].from).toEqual([1, 1, 1])
  })

  test('a name with no folded twin stays its own column — nothing is guessed', () => {
    // 'Glor' is one letter from 'Floor'. Featherbase does not propose that
    // (owner decision): combining them is the user's explicit act.
    const merged = mergeSheetHeaders([
      ['Zone', 'Floor'],
      ['Zone', 'Glor'],
    ])
    expect(merged.map((c) => c.key)).toEqual(['zone', 'floor', 'glor'])
    expect(merged[1].from).toEqual([1, -1]) // floor: sheet 1 only
    expect(merged[2].from).toEqual([-1, 1]) // glor: sheet 2 only
  })

  test('a column only one sheet has is kept, and the others report -1', () => {
    const merged = mergeSheetHeaders([['A', 'B'], ['A']])
    expect(merged.map((c) => c.key)).toEqual(['a', 'b'])
    expect(merged[1].from).toEqual([1, -1])
  })

  test('two headers folding together WITHIN one sheet stay two columns', () => {
    // The sheet really has two columns; folding them would drop one.
    const merged = mergeSheetHeaders([['Floor', 'floor']])
    expect(merged).toHaveLength(2)
    expect(merged[0].from).toEqual([0])
    expect(merged[1].from).toEqual([1])
  })

  test('blank headers in different sheets are not the same column', () => {
    const merged = mergeSheetHeaders([
      ['', 'A'],
      ['', 'A'],
    ])
    expect(merged.filter((c) => c.key === 'a')).toHaveLength(1)
    expect(merged).toHaveLength(3) // one 'a', plus a separate blank per sheet
  })

  test('the label comes from the first spelling seen, normalized', () => {
    const merged = mergeSheetHeaders([['sku_count'], ['SKU Count']])
    expect(merged[0].label).toBe('Sku Count')
  })
})

describe('mergeSheetRows', () => {
  test('rows are projected onto the merged shape, absent columns as null', () => {
    const columns = mergeSheetHeaders([
      ['Zone', 'Floor'],
      ['Zone', 'Remarks'],
    ])
    expect(mergeSheetRows(columns, [[['Fresh', 'Ground']], [['Dairy', 'relaid']]])).toEqual([
      ['Fresh', 'Ground', null],
      ['Dairy', null, 'relaid'],
    ])
  })

  test('every member sheet contributes its rows, in sheet order', () => {
    const columns = mergeSheetHeaders([['A'], ['A']])
    expect(mergeSheetRows(columns, [[[1], [2]], [[3]]])).toEqual([[1], [2], [3]])
  })

  test('inference sees every member, so a disagreement resolves once', () => {
    // Sheet 1 alone would read as Int; sheet 2's codes make the column Data.
    const columns = mergeSheetHeaders([['Code'], ['Code']])
    const rows = mergeSheetRows(columns, [
      [[1], [2], [3]],
      [['A-1'], ['A-2'], ['A-3']],
    ])
    const def = inferTableDef(
      'T',
      columns.map((c) => c.label),
      rows,
    )
    expect(def.columns[0].column_type).toBe('Data')
  })
})

// #211: combining columns the folding rule could never join, because the
// knowledge is the user's. `Store Code` holding STR-009 and `Store Name`
// holding Anna Nagar are the same column to them and to nothing else.
describe('combineOverlap', () => {
  test('no sheet has both: nothing to resolve', () => {
    const columns = mergeSheetHeaders([['Store Code'], ['Store Name']])
    expect(combineOverlap(columns, ['store_code', 'store_name'])).toEqual([])
  })

  test('a sheet carrying both is named, because those rows need a rule', () => {
    const columns = mergeSheetHeaders([
      ['Store Code', 'Store Name'], // sheet 0 has both
      ['Store Name'],
    ])
    expect(combineOverlap(columns, ['store_code', 'store_name'])).toEqual([0])
  })

  test('fewer than two columns is not an overlap question', () => {
    const columns = mergeSheetHeaders([['Store Code']])
    expect(combineOverlap(columns, ['store_code'])).toEqual([])
  })
})

describe('applyColumnCombines', () => {
  const twoSheets = () => mergeSheetHeaders([['Store Code', 'Zone'], ['Store Name', 'Zone']])

  test('two columns become one, where the first of them was', () => {
    const out = applyColumnCombines(twoSheets(), [
      { name: 'Store', keys: ['store_code', 'store_name'], rule: 'first' },
    ])
    // Combined column sits in the first source's position — a combine must
    // not reshuffle the grid the user is reading.
    expect(out.map((c) => c.label)).toEqual(['Store', 'Zone'])
    expect(out[0].combinedKeys).toEqual(['store_code', 'store_name'])
    // Each sheet feeds it from whichever column it actually has.
    expect(out[0].from).toEqual([0, 0])
  })

  test('the rows follow: each sheet contributes its own spelling', () => {
    const columns = applyColumnCombines(twoSheets(), [
      { name: 'Store', keys: ['store_code', 'store_name'], rule: 'first' },
    ])
    const rows = mergeSheetRows(columns, [
      [['STR-009', 'Fresh']],
      [['Anna Nagar', 'Dairy']],
    ])
    expect(rows).toEqual([
      ['STR-009', 'Fresh'],
      ['Anna Nagar', 'Dairy'],
    ])
  })

  test("'first' is priority WITH fallback — the other fills only empty cells", () => {
    // Sheet 0 has both columns. A blank in the winner must not blank the row
    // when the other source has the value; discarding it would be the
    // data-loss bug the rule exists to prevent.
    const columns = applyColumnCombines(
      mergeSheetHeaders([['Store Code', 'Store Name']]),
      [{ name: 'Store', keys: ['store_code', 'store_name'], rule: 'first' }],
    )
    expect(mergeSheetRows(columns, [[['STR-001', 'Anna Nagar']]])).toEqual([['STR-001']])
    expect(mergeSheetRows(columns, [[['', 'Anna Nagar']]])).toEqual([['Anna Nagar']])
    expect(mergeSheetRows(columns, [[[null, null]]])).toEqual([[null]])
  })

  test("'join' keeps both values where a sheet has both", () => {
    const columns = applyColumnCombines(
      mergeSheetHeaders([['Store Code', 'Store Name']]),
      [{ name: 'Store', keys: ['store_code', 'store_name'], rule: 'join' }],
    )
    expect(mergeSheetRows(columns, [[['STR-001', 'Anna Nagar']]])).toEqual([
      [`STR-001${COMBINE_JOIN_SEPARATOR}Anna Nagar`],
    ])
    // With only one value present there is nothing to join to.
    expect(mergeSheetRows(columns, [[['STR-001', '']]])).toEqual([['STR-001']])
  })

  test('the user can combine what folding refused to guess', () => {
    // The Glor/Floor case: no folded twin, so mergeSheetHeaders left them
    // apart (Q5). The user says otherwise and the rows follow.
    const columns = applyColumnCombines(
      mergeSheetHeaders([['Floor'], ['Glor']]),
      [{ name: 'Floor', keys: ['floor', 'glor'], rule: 'first' }],
    )
    expect(columns).toHaveLength(1)
    expect(mergeSheetRows(columns, [[['Ground']], [['Mezzanine']]])).toEqual([
      ['Ground'],
      ['Mezzanine'],
    ])
  })

  test('a combine naming a column that is gone is ignored, not fatal', () => {
    // Selections change; a stale combine must not refuse to render the step.
    const out = applyColumnCombines(twoSheets(), [
      { name: 'Store', keys: ['store_code', 'nope'], rule: 'first' },
    ])
    expect(out.map((c) => c.key)).toEqual(['store_code', 'zone', 'store_name'])
  })

  test('two combines both apply, and their keys do not collide', () => {
    const columns = mergeSheetHeaders([['A', 'B', 'C', 'D']])
    const out = applyColumnCombines(columns, [
      { name: 'AB', keys: ['a', 'b'], rule: 'first' },
      { name: 'CD', keys: ['c', 'd'], rule: 'first' },
    ])
    expect(out.map((c) => c.label)).toEqual(['AB', 'CD'])
    expect(new Set(out.map((c) => c.key)).size).toBe(2)
  })

  test('inference sees the combined column, not its sources', () => {
    const columns = applyColumnCombines(
      mergeSheetHeaders([['Store Code'], ['Store Name']]),
      [{ name: 'Store', keys: ['store_code', 'store_name'], rule: 'first' }],
    )
    const rows = mergeSheetRows(columns, [[['STR-009']], [['Anna Nagar']]])
    const def = inferTableDef('T', columns.map((c) => c.label), rows)
    expect(def.columns).toHaveLength(1)
    expect(def.columns[0].column_name).toBe('store')
  })
})
