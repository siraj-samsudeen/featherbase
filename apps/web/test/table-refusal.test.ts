import { describe, expect, it } from 'vitest'
import { describeFieldErrors } from '../src/lib/table-refusal'

// #993: the definition check names a column by its machine name; the person
// reads the label they typed, whichever way the server pointed at it.
describe('describeFieldErrors', () => {
  const kept = [
    { column_name: 'zone', label: 'Zone', sourceIndex: 0 },
    { column_name: 'empty', label: 'Empty', sourceIndex: 3 },
  ]
  it('names a column keyed by its machine name by its label, and marks its row', () => {
    expect(describeFieldErrors({ empty: 'Choice column needs at least one choice' }, kept)).toEqual({
      rows: { 3: 'Choice column needs at least one choice' },
      parts: ['Column “Empty”: Choice column needs at least one choice'],
    })
  })
  it('still names a setting that is not a column by its control', () => {
    expect(describeFieldErrors({ name: 'invalid Table name' }, kept).parts).toEqual(['Table name: invalid Table name'])
  })
})
