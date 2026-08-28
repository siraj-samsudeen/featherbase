import { beforeEach, describe, expect, test } from 'vitest'
import {
  IMPORT_DATA_KEY,
  IMPORT_DECISIONS_KEY,
  clearSession,
  loadDecisions,
  loadSheets,
  sameShape,
  saveDecisions,
  saveSheets,
  shapeOf,
} from '../src/lib/import-session'
import type { ParsedSheet } from '../src/lib/parse-file'

// #204 (issue #197): the wizard's work outliving the page.
//
// The owner imported one sheet, went to look at the rows, came back, and
// found nothing — every decision about seventeen sheets gone with the route.

function sheet(name: string, headers: string[], rows: unknown[][]): ParsedSheet {
  return { sheetName: name, headers, rows, headerExcelRow: 1, visibility: 'visible' }
}

const SHEETS = [
  sheet('Alpha', ['A', 'B'], [['1', '2'], ['3', '4']]),
  sheet('Beta', ['C'], [['5']]),
]

function decisions(over: Partial<Parameters<typeof saveDecisions<{ table: string }>>[0]> = {}) {
  return {
    fileName: 'chain.xlsx',
    // #206: the file-import's identity travels with the decisions, so a
    // resumed import stays ONE batch.
    batchId: 'batch-1',
    stage: 'columns' as const,
    selected: [true, true],
    plans: [{ table: 'One' }, { table: 'Two' }],
    natural: [{ table: 'One' }, { table: 'Two' }],
    current: 1,
    groupMode: 'separate' as const,
    mergeName: 'Merged',
    outcome: null,
    done: false,
    shape: shapeOf(SHEETS),
    ...over,
  }
}

beforeEach(() => {
  clearSession()
})

describe('decisions survive the round trip', () => {
  test('what was saved is what comes back', () => {
    expect(saveDecisions(decisions())).toBe(true)
    expect(loadDecisions()).toEqual(decisions())
  })

  test('nothing saved reads as nothing, not as a crash', () => {
    expect(loadDecisions()).toBeNull()
  })

  test('a half-written or foreign entry is treated as absent', () => {
    // A shape from an older build must not throw on arrival — the wizard has
    // to open either way.
    sessionStorage.setItem(IMPORT_DECISIONS_KEY, '{"fileName":"x"}')
    expect(loadDecisions()).toBeNull()
    sessionStorage.setItem(IMPORT_DECISIONS_KEY, 'not json at all')
    expect(loadDecisions()).toBeNull()
  })
})

describe('the file rows are the half allowed to fail', () => {
  test('rows come back for the same file', () => {
    expect(saveSheets('chain.xlsx', SHEETS)).toBe(true)
    expect(loadSheets('chain.xlsx')).toEqual(SHEETS)
  })

  test('rows saved for one file are never handed to another', () => {
    // Plans address sheets by INDEX. Serving another file's rows would point
    // every mapping at the wrong columns.
    saveSheets('chain.xlsx', SHEETS)
    expect(loadSheets('other.xlsx')).toBeNull()
  })

  test('a storage failure loses the rows and NOT the decisions', () => {
    saveDecisions(decisions())
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = function throwing() {
      throw new DOMException('QuotaExceededError')
    }
    try {
      expect(saveSheets('chain.xlsx', SHEETS)).toBe(false)
    } finally {
      Storage.prototype.setItem = real
    }
    // The expensive half — every name, mapping and combine — is still there.
    expect(loadDecisions()).toEqual(decisions())
    expect(loadSheets('chain.xlsx')).toBeNull()
  })

  test('a failed write leaves no half-file behind', () => {
    saveSheets('chain.xlsx', SHEETS)
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = function throwing() {
      throw new DOMException('QuotaExceededError')
    }
    try {
      saveSheets('bigger.xlsx', SHEETS)
    } finally {
      Storage.prototype.setItem = real
    }
    // The previous file's rows must not be served for the new one.
    expect(sessionStorage.getItem(IMPORT_DATA_KEY)).toBeNull()
  })
})

describe('sameShape decides whether saved plans may be applied', () => {
  test('the same workbook matches', () => {
    expect(sameShape(shapeOf(SHEETS), shapeOf(SHEETS))).toBe(true)
  })

  test('a different sheet name does not', () => {
    const other = [sheet('Alphaa', ['A', 'B'], SHEETS[0].rows), SHEETS[1]]
    expect(sameShape(shapeOf(SHEETS), shapeOf(other))).toBe(false)
  })

  test('the same names with different headers do not', () => {
    // The case that would silently misdirect a mapping: same sheet, columns
    // renamed or reordered underneath it.
    const other = [sheet('Alpha', ['B', 'A'], SHEETS[0].rows), SHEETS[1]]
    expect(sameShape(shapeOf(SHEETS), shapeOf(other))).toBe(false)
  })

  test('an edited file with more rows does not', () => {
    const other = [sheet('Alpha', ['A', 'B'], [...SHEETS[0].rows, ['5', '6']]), SHEETS[1]]
    expect(sameShape(shapeOf(SHEETS), shapeOf(other))).toBe(false)
  })

  test('a missing or extra sheet does not', () => {
    expect(sameShape(shapeOf(SHEETS), shapeOf([SHEETS[0]]))).toBe(false)
    expect(sameShape(shapeOf(SHEETS), shapeOf([...SHEETS, sheet('Gamma', ['D'], [])]))).toBe(false)
  })
})

test('starting over leaves nothing behind', () => {
  saveDecisions(decisions())
  saveSheets('chain.xlsx', SHEETS)
  clearSession()
  expect(loadDecisions()).toBeNull()
  expect(loadSheets('chain.xlsx')).toBeNull()
})
