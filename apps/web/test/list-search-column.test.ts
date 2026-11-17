// #1242, Codex review round 12: a list's Search looks only where text people
// read is stored: never a title that is a link (it holds an id).
import { describe, expect, test } from 'vitest'
import { searchColumn } from '../src/components/ListFilters'
import type { TableMeta } from '../src/lib/meta'

const meta = (title: string | null, columns: { column_name: string; column_type: string; hidden?: boolean }[]) =>
  ({ title_column: title, columns }) as unknown as TableMeta

describe('the column a list searches', () => {
  test('a text title column', () => {
    expect(searchColumn(meta('dept_name', [{ column_name: 'dept_name', column_type: 'Data' }]))).toBe('dept_name')
  })
  test('not a title that links to another row: the first text column instead', () => {
    expect(searchColumn(meta('person', [{ column_name: 'person', column_type: 'Reference' }, { column_name: 'note', column_type: 'Data' }]))).toBe('note')
  })
  test('none when nothing holds text', () => {
    expect(searchColumn(meta('asset', [{ column_name: 'asset', column_type: 'Reference' }, { column_name: 'qty', column_type: 'Int' }]))).toBeUndefined()
  })
})
