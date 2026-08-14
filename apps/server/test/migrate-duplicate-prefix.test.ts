import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findDuplicateMigrationPrefixes } from '../src/migrate'

// #149: two migration files sharing a numeric prefix apply silently — one
// wins the slot in an arbitrary sort order, the other becomes an unreachable
// duplicate. Pure logic, no DB: findDuplicateMigrationPrefixes takes a plain
// file list.
describe('findDuplicateMigrationPrefixes', () => {
  it('reports a new duplicate prefix, naming both files', () => {
    const errors = findDuplicateMigrationPrefixes([
      '0001_init.sql',
      '0002_a.sql',
      '0002_b.ts',
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('0002')
    expect(errors[0]).toContain('0002_a.sql')
    expect(errors[0]).toContain('0002_b.ts')
  })

  it('does not flag the grandfathered 0064 and 0069 pairs', () => {
    const errors = findDuplicateMigrationPrefixes([
      '0063_fix_literal_newline_choices.sql',
      '0064_data_sources.ts',
      '0064_user_event.ts',
      '0065_saved_view.ts',
      '0069_access_tokens.sql',
      '0069_import_upsert_log.ts',
      '0070_oauth_settings.ts',
    ])
    expect(errors).toEqual([])
  })

  it('passes a list of files with unique prefixes', () => {
    const errors = findDuplicateMigrationPrefixes([
      '0001_init.sql',
      '0002_table.sql',
      '0010_rls.sql',
      '0010a_rename_rls_role.sql',
    ])
    expect(errors).toEqual([])
  })

  it('treats 0010 and 0010a as distinct numbers, not a collision', () => {
    // Same-batch sub-ordering (0010, 0010a, 0010b, ...) is a deliberate,
    // pre-existing convention — not what this guard exists to catch.
    const errors = findDuplicateMigrationPrefixes(['0010_rls.sql', '0010a_rename_rls_role.sql'])
    expect(errors).toEqual([])
  })

  it('still fails loudly if a grandfathered number picks up a THIRD file', () => {
    const errors = findDuplicateMigrationPrefixes([
      '0064_data_sources.ts',
      '0064_user_event.ts',
      '0064_something_new.ts',
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('0064_something_new.ts')
  })

  it('the real migrations/ directory on disk has no unexpected duplicate numbers', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
    expect(findDuplicateMigrationPrefixes(files)).toEqual([])
  })
})
