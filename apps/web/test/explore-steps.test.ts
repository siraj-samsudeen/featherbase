import { describe, expect, test } from 'vitest'
import {
  parseChain,
  parseSelect,
  stepKey,
  stepOptions,
  type Step,
} from '../src/lib/explore-steps'

// The shared Explore chain-step seam: one pure option builder consumed by
// Explore's StepPicker, ListView's Explore split button, and RelationMap's
// "Open in Explore" — plus the defensive parsers for the `chain` / `select`
// URL search params (the #87 parseFilters discipline: a URL is user input,
// malformed values are discarded, never thrown).

const col = (over: Partial<{ column_name: string; label: string | null; column_type: string; row_table: string | null }>) => ({
  column_name: 'x',
  label: null,
  column_type: 'Data',
  row_table: null,
  ...over,
})

describe('stepOptions', () => {
  test('offers the destination of an outgoing Reference', () => {
    const columns = [{ ...col({ column_name: 'worker', column_type: 'Reference' }), reference_table: 'Worker' }]
    expect(stepOptions({ columns }, [])).toContainEqual({
      key: 'reference:Worker:worker',
      label: expect.stringContaining('Worker'),
      step: { mode: 'reference', table: 'Worker', column: 'worker' },
    })
  })

  test('builds child, backlink, and via-backlink steps from meta + backlinks', () => {
    const options = stepOptions(
      {
        columns: [
          col({ column_name: 'items', label: 'Items', column_type: 'Sub-table', row_table: 'PO Line' }),
          col({ column_name: 'supplier', column_type: 'Reference' }),
        ],
      },
      [
        { table: 'Accident', column: 'vehicle', via: null },
        { table: 'Purchase Order', column: 'item', via: 'PO Line' },
      ],
    )
    expect(options).toEqual([
      {
        key: 'child:PO Line:items',
        label: 'PO Line (Items)',
        step: { mode: 'child', table: 'PO Line', column: 'items' },
      },
      {
        key: 'backlink:Accident:vehicle',
        label: 'Accident · vehicle',
        step: { mode: 'backlink', table: 'Accident', column: 'vehicle' },
      },
      {
        key: 'viabacklink:Purchase Order:item:PO Line',
        label: 'Purchase Order · via PO Line',
        step: { mode: 'viabacklink', table: 'Purchase Order', column: 'item', via: 'PO Line' },
      },
    ])
  })

  test('missing inputs yield an empty list', () => {
    expect(stepOptions(undefined, undefined)).toEqual([])
  })
})

describe('stepKey', () => {
  test('round-trips with the option keys', () => {
    const step: Step = { mode: 'viabacklink', table: 'Purchase Order', column: 'item', via: 'PO Line' }
    expect(stepKey(step)).toBe('viabacklink:Purchase Order:item:PO Line')
    expect(stepKey({ mode: 'backlink', table: 'Accident', column: 'vehicle' })).toBe(
      'backlink:Accident:vehicle',
    )
  })
})

describe('parseChain', () => {
  test('accepts a well-formed chain of up to two steps', () => {
    const chain = [
      { mode: 'backlink', table: 'Accident', column: 'vehicle' },
      { mode: 'viabacklink', table: 'Claim', column: 'accident', via: 'Claim Line' },
    ]
    expect(parseChain(JSON.stringify(chain))).toEqual(chain)
  })

  test('truncates to the four-edge path limit', () => {
    const step = { mode: 'backlink', table: 'A', column: 'b' }
    expect(parseChain(JSON.stringify(Array(5).fill(step)))).toEqual(Array(4).fill(step))
  })

  test('retains a five-Table mixed-direction journey', () => {
    const chain = [
      { mode: 'backlink', table: 'FloorSection', column: 'section' },
      { mode: 'backlink', table: 'AssignmentSection', column: 'floor_section' },
      { mode: 'reference', table: 'Assignment', column: 'assignment' },
      { mode: 'reference', table: 'Worker', column: 'worker' },
    ]
    expect(parseChain(JSON.stringify(chain))).toEqual(chain)
  })

  test('preserves only the valid prefix before a malformed fourth edge', () => {
    const step = { mode: 'backlink', table: 'A', column: 'b' }
    expect(parseChain(JSON.stringify([step, step, step, null, step]))).toEqual([step, step, step])
  })

  test('malformed JSON is ignored, not thrown', () => {
    expect(parseChain('not json')).toEqual([])
    expect(parseChain(undefined)).toEqual([])
    expect(parseChain('{}')).toEqual([])
  })

  test('a malformed step drops itself and everything after it', () => {
    const good = { mode: 'backlink', table: 'Accident', column: 'vehicle' }
    expect(parseChain(JSON.stringify([{ mode: 'nope', table: 'A', column: 'b' }, good]))).toEqual([])
    expect(parseChain(JSON.stringify([good, { mode: 'child', table: 'X' }]))).toEqual([good])
    expect(parseChain(JSON.stringify([good, null]))).toEqual([good])
  })

  test('a viabacklink step requires via; other modes must not smuggle non-strings', () => {
    expect(parseChain(JSON.stringify([{ mode: 'viabacklink', table: 'A', column: 'b' }]))).toEqual([])
    expect(parseChain(JSON.stringify([{ mode: 'backlink', table: 1, column: 'b' }]))).toEqual([])
  })
})

describe('parseSelect', () => {
  test('accepts a JSON array of row names', () => {
    expect(parseSelect(JSON.stringify(['VEH-001', 'VEH-002']))).toEqual(['VEH-001', 'VEH-002'])
  })

  test('anything else is ignored', () => {
    expect(parseSelect(undefined)).toEqual([])
    expect(parseSelect('oops')).toEqual([])
    expect(parseSelect('{"a":1}')).toEqual([])
    expect(parseSelect(JSON.stringify(['ok', 7]))).toEqual([])
  })
})
