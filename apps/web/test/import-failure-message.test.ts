import { describe, expect, it } from 'vitest'
import { failureMessage } from '../src/lib/import-run'

// #416: a row the server refuses names the column and the reason, not just
// "Invalid values for <Table>" — the dry run already returns them as `fields`.
describe('failureMessage', () => {
  it('names each refused column with its reason', () => {
    expect(
      failureMessage({
        message: 'Invalid values for Section Ownership',
        fields: { effective_from: 'must be a YYYY-MM-DD date' },
      }),
    ).toBe('Invalid values for Section Ownership — effective_from: must be a YYYY-MM-DD date')
  })

  it('lists several columns', () => {
    expect(failureMessage({ message: 'Invalid values for T', fields: { a: 'Required', b: 'is not a real calendar day' } })).toBe(
      'Invalid values for T — a: Required; b: is not a real calendar day',
    )
  })

  it('keeps a message that carries no fields as it is', () => {
    expect(failureMessage({ message: 'Duplicate name X within the import' })).toBe('Duplicate name X within the import')
    expect(failureMessage({ message: 'm', fields: {} })).toBe('m')
  })
})
