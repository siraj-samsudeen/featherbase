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
  it('names a setting with no word of its own by its field name', () => {
    expect(describeFieldErrors({ title_column: 'not a column' }, kept).parts).toEqual(['title_column: not a column'])
  })
  it('says a problem on a path that names no column or setting without a name', () => {
    expect(describeFieldErrors({ 'views.0.filter': 'unknown filter' }, kept).parts).toEqual(['unknown filter'])
  })
  it('marks a column with two problems with both', () => {
    expect(describeFieldErrors({ 'columns.0.column_name': 'taken', 'columns.0.label': 'blank' }, kept).rows).toEqual({ 0: 'taken; blank' })
  })
  it('still names a setting that is not a column by its control', () => {
    expect(describeFieldErrors({ name: 'invalid Table name' }, kept).parts).toEqual(['Table name: invalid Table name'])
  })
})
