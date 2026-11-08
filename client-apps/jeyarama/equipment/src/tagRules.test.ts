import { describe, expect, it } from 'vitest'
import { isTag, reconciliation, recountSample, rollOf, rollSummary, sapStatus, tagNumber } from './tagRules'

describe('tag numbers', () => {
  it('are JRA- and six digits', () => {
    expect(isTag('JRA-000123')).toBe(true)
    expect(['JRA-123', 'AST-0001', 'JRA-0001234', 'jra-000123', ''].map(isTag)).toEqual([false, false, false, false, false])
    expect(tagNumber('JRA-000123')).toBe(123)
  })

  it('belong to the roll whose range holds them', () => {
    const rolls = [{ row_id: 'a', first_no: 1, last_no: 200 }, { row_id: 'b', first_no: 1201, last_no: 1300 }]
    expect(rollOf(rolls, 'JRA-000200')?.row_id).toBe('a')
    expect(rollOf(rolls, 'JRA-001250')?.row_id).toBe('b')
    expect(rollOf(rolls, 'JRA-000500')).toBeUndefined()
  })
})

describe('the roll log', () => {
  it('counts used, spoiled and, once returned, returned numbers', () => {
    const roll = { row_id: 'a', first_no: 1, last_no: 10, roll_state: 'Returned' }
    const summary = rollSummary(roll, ['JRA-000001', 'JRA-000002', 'JRA-000005', 'JRA-000099'], [{ tag_no: 'JRA-000003', event_kind: 'Spoiled' }, { tag_no: 'JRA-000002', event_kind: 'Reprinted' }])
    expect(summary).toEqual({ issued: 10, used: 3, spoiled: 1, reprinted: 1, returned: 6, unaccounted: 0 })
    expect(rollSummary({ ...roll, roll_state: 'Issued' }, ['JRA-000001'], []).returned).toBe(0)
  })
})

describe('SAP record status', () => {
  it('is Not found yet with no tag, Found when every unit has a tag, and Found n of m when some do', () => {
    expect(sapStatus({ quantity: 1, plant: '1501' }, [])).toBe('Not found yet')
    expect(sapStatus({ quantity: 1, plant: '1501' }, [{ plant: '1501' }])).toBe('Found')
    expect(sapStatus({ quantity: 6, plant: '1501' }, [{ plant: '1501' }, { plant: '1501' }])).toBe('Found 2 of 6')
  })

  it('asks to check the tag number when a matched tag was counted at another plant', () => {
    expect(sapStatus({ quantity: 1, plant: '1501' }, [{ plant: '9151' }])).toBe('Check tag no.')
  })
})

describe('reconciliation', () => {
  it('shows match rate, value not yet found, found-not-in-books, tag coverage and open exceptions', () => {
    const figures = reconciliation({
      book: [{ row_id: 's1', book_value: 100000, quantity: 1 }, { row_id: 's2', book_value: 60000, quantity: 6 }, { row_id: 's3', book_value: 40000, quantity: 1 }],
      matches: [{ sap_book: 's1', asset: 'a1' }, { sap_book: 's2', asset: 'a2' }, { sap_book: 's2', asset: 'a3' }],
      assets: [
        { row_id: 'a1', tag_status: 'Tagged' }, { row_id: 'a2', tag_status: 'Tagged' }, { row_id: 'a3', tag_status: 'Tagged' },
        { row_id: 'a4', tag_status: 'Tagged' }, { row_id: 'a5', tag_status: 'Bulk count, no tag' }, { row_id: 'a6', tag_status: 'Third-party, not tagged' },
        { row_id: 'a7', tag_status: 'Needs a tag' },
      ],
      exceptions: [{ exception_state: 'Open' }, { exception_state: 'Approved' }, { exception_state: 'Closed' }],
    })
    // s1 fully found, s2 two of six units (value 40,000 still to find), s3 none.
    expect(figures).toEqual({ matchRate: 33, valueNotFound: 80000, foundNotInBooks: 1, tagCoverage: 80, openExceptions: 2 })
  })
})

describe('the independent recount', () => {
  it('takes every line at or over the threshold and a random 10% of the rest', () => {
    const lines = Array.from({ length: 40 }, (_, index) => ({ row_id: `a${index}`, book_value: index === 3 || index === 7 ? 250000 : 5000 }))
    const picked = recountSample(lines, { percent: 10, threshold: 200000 }, () => 0.5)
    expect(picked).toContain('a3')
    expect(picked).toContain('a7')
    expect(picked).toHaveLength(2 + 4)
  })
})
