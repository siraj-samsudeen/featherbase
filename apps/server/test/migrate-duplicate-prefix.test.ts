import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertUniqueMigrationNumbers, findDuplicateMigrationPrefixes } from '../src/migrate'

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

  it('passes a list of files with unique prefixes', () => {
    const errors = findDuplicateMigrationPrefixes([
      '0001_baseline.sql',
      '0002_administrator_password.ts',
      '0003a_later.sql',
      '0003_mock_google_sign_in.ts',
    ])
    expect(errors).toEqual([])
  })

  it('treats 0003 and 0003a as distinct numbers, not a collision', () => {
    // A lettered sub-number orders a file right after its number on purpose;
    // it is not what this guard exists to catch.
    const errors = findDuplicateMigrationPrefixes(['0003_mock_google_sign_in.ts', '0003a_later.sql'])
    expect(errors).toEqual([])
  })

  it('the real migrations/ directory on disk has no duplicate numbers', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
    expect(findDuplicateMigrationPrefixes(files)).toEqual([])
  })

  it('the migrator refuses a listing with a duplicate number, naming every collision', () => {
    expect(() => assertUniqueMigrationNumbers(['0001_init.sql', '0002_a.sql', '0002_b.ts'])).toThrow(
      'duplicate migration numbers:\nmigration number "0002" is claimed by more than one file: 0002_a.sql, 0002_b.ts',
    )
    expect(() => assertUniqueMigrationNumbers(['0001_init.sql', '0002_a.sql'])).not.toThrow()
  })
})
