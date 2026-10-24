import { describe, expect, it } from 'vitest'
import { searchHitKind } from '../src/lib/search-hit'

describe('searchHitKind (#431)', () => {
  it('uses the server label for registry rows', () => {
    expect(searchHitKind({ table: 'Table', kind_label: 'Table definition' })).toBe('Table definition')
  })
  it('falls back to "row in <Table>" for ordinary records', () => {
    expect(searchHitKind({ table: 'Customer' })).toBe('row in Customer')
  })
})
