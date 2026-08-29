// #151: the builder's client-side column rules — the mirror of the server's
// columnSchema/validateDef. If these drift from table-engine.ts, fix the
// drift, don't relax the test.
import { describe, expect, it } from 'vitest'
import { blankColumn, checkColumn, slugify } from '../src/lib/column-rules'

const col = (column_name: string, extra: Partial<ReturnType<typeof blankColumn>> = {}) => ({
  ...blankColumn(),
  column_name,
  ...extra,
})

describe('slugify', () => {
  it('turns a label into a legal identifier', () => {
    expect(slugify('Date of Birth')).toBe('date_of_birth')
    expect(slugify('Employee_Name')).toBe('employee_name')
    expect(slugify('  Salary (INR)  ')).toBe('salary_inr')
  })
  it('collapses runs and trims underscores', () => {
    expect(slugify('a -- b')).toBe('a_b')
    expect(slugify('__x__')).toBe('x')
  })
  it('prefixes identifiers that start with a digit', () => {
    expect(slugify('2nd Line')).toBe('col_2nd_line')
  })
  it('returns empty for labels with nothing usable', () => {
    expect(slugify('!!!')).toBe('')
  })
})

describe('checkColumn', () => {
  it('passes a clean snake_case column', () => {
    expect(checkColumn(col('date_of_birth'), [])).toBeNull()
  })
  it('ignores blank rows — they are dropped from the payload', () => {
    expect(checkColumn(col(''), [])).toBeNull()
  })
  it('flags non-snake_case and offers the slug as the fix', () => {
    const v = checkColumn(col('Date of Birth'), [])
    expect(v?.error).toMatch(/database name/)
    expect(v?.fix).toBe('date_of_birth')
  })
  it('flags reserved names and offers the table-prefixed fix', () => {
    const v = checkColumn(col('status'), [], 'Employee')
    expect(v?.error).toMatch(/built-in/)
    expect(v?.fix).toBe('employee_status')
  })
  // #132 / PR #174: the physical row key is row_id now, so `name` is the
  // affirmative case the whole rename exists for — it must pass clean.
  it('accepts a plain "name" column (#132: no longer reserved)', () => {
    expect(checkColumn(col('name'), [], 'Employee')).toBeNull()
  })
  it('reserves "row_id" and says the Row ID owns it', () => {
    const v = checkColumn(col('row_id'), [], 'Employee')
    expect(v?.error).toMatch(/Row ID/)
    expect(v?.fix).toBe('employee_row_id')
  })
  it('withholds the reserved fix when it would collide with a sibling', () => {
    const taken = col('employee_row_id')
    const v = checkColumn(col('row_id'), [taken, col('row_id')], 'Employee')
    expect(v?.fix).toBeUndefined()
  })
  it('flags duplicates', () => {
    const a = col('x')
    const b = col('x')
    expect(checkColumn(b, [a, b])?.error).toMatch(/another column/)
  })
  it('requires a target for Choice/Reference/Sub-table', () => {
    expect(checkColumn(col('stage', { column_type: 'Choice' }), [])?.error).toMatch(/choices/)
    expect(checkColumn(col('dept', { column_type: 'Reference' }), [])?.error).toMatch(/table/)
    expect(checkColumn(col('items', { column_type: 'Sub-table' }), [])?.error).toMatch(/table/)
    expect(checkColumn(col('stage', { column_type: 'Choice', target: 'A, B' }), [])).toBeNull()
  })
})
