import { describe, expect, test } from 'vitest'
import { canRetire } from '../src/row-retirement'

describe('canRetire (#859)', () => {
  test('a plain Table that stores its own rows can', () => {
    expect(canRetire({ name: 'Plant', kind: 'table' })).toBe(true)
    expect(canRetire({ name: 'Plant' })).toBe(true)
  })
  test.each([
    ['nothing to judge', undefined],
    ['a sub-table', { name: 'Line', kind: 'sub_table' }],
    ['settings', { name: 'Defaults', kind: 'settings' }],
    ['a connected Table', { name: 'Remote', kind: 'table', data_source: 'erp' }],
    ['a system-written Table', { name: 'Version', kind: 'table', system_written: true }],
    ['the engine\'s Table', { name: 'Table', kind: 'table' }],
    ['the engine\'s Column', { name: 'Column', kind: 'table' }],
    ['a Permission grant (#1060)', { name: 'Permission', kind: 'table' }],
  ])('%s cannot', (_label, meta) => {
    expect(canRetire(meta)).toBe(false)
  })
})
