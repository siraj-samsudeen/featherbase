import { beforeEach, describe, expect, it, vi } from 'vitest'

// The server's answer for one chunk; each test sets it.
const post = vi.fn()
vi.mock('../src/lib/api', () => ({ api: { post: (...args: unknown[]) => post(...args) } }))

import { failureMessage, sendImportRun } from '../src/lib/import-run'

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

describe('sendImportRun reports the refused column', () => {
  beforeEach(() => {
    post.mockReset()
    post.mockResolvedValue({
      valid: 1,
      failed: [{ index: 1, message: 'Invalid values for Section Ownership', fields: { effective_from: 'must be a YYYY-MM-DD date' } }],
    })
  })
  const rows = [
    { sourceIndex: 0, values: { section_name: 'A', effective_from: '2026-10-23' } },
    { sourceIndex: 2, values: { section_name: 'B', effective_from: '23-Oct-2026' } },
  ]

  it('names the column the server refused, on the source row', async () => {
    const report = await sendImportRun({ table: 'Section Ownership', rows, dryRun: true })
    expect(report.failed).toEqual([
      { sourceIndex: 2, message: 'Invalid values for Section Ownership — effective_from: must be a YYYY-MM-DD date' },
    ])
  })

  it('names it by the file’s own header when the caller knows the mapping', async () => {
    const report = await sendImportRun({
      table: 'Section Ownership',
      rows,
      dryRun: true,
      columnLabel: (c) => (c === 'effective_from' ? 'Effective From' : c),
    })
    expect(report.failed[0].message).toBe('Invalid values for Section Ownership — Effective From: must be a YYYY-MM-DD date')
  })
})
