// META-013: direct unit coverage for the validation contract both apps/server
// (document.ts) and the Admin form views build on. Previously exercised only
// indirectly through HTTP-level server tests. Pins actual zod behavior,
// including a few surprises noted inline — see #222.
import { describe, expect, it } from 'vitest'
import { tableSchemaToZod, zodFieldErrors, type ColumnDef } from '../src/schema'

const col = (column_name: string, column_type: string, extra: Partial<ColumnDef> = {}): ColumnDef => ({
  column_name,
  column_type,
  ...extra,
})

describe('tableSchemaToZod: column type mapping', () => {
  it('maps Data and Reference to a string capped at 140 characters', () => {
    const s = tableSchemaToZod([col('title', 'Data'), col('dept', 'Reference', { reference_table: 'Department' })])
    expect(s.safeParse({ title: 'x'.repeat(140), dept: 'Engineering' }).success).toBe(true)
    const over = s.safeParse({ title: 'x'.repeat(141), dept: 'Engineering' })
    expect(over.success).toBe(false)
  })

  it('maps Text, Long Text, Attach, and Attach Image to an unbounded string', () => {
    const s = tableSchemaToZod([
      col('body', 'Text'),
      col('notes', 'Long Text'),
      col('file', 'Attach'),
      col('photo', 'Attach Image'),
    ])
    const long = 'x'.repeat(10_000)
    expect(s.safeParse({ body: long, notes: long, file: long, photo: long }).success).toBe(true)
  })

  it('coerces Int from a numeric string and clamps to the safe-integer range', () => {
    const s = tableSchemaToZod([col('n', 'Int')])
    expect(s.safeParse({ n: '42' })).toMatchObject({ success: true, data: { n: 42 } })
    expect(s.safeParse({ n: Number.MAX_SAFE_INTEGER }).success).toBe(true)
    const over = s.safeParse({ n: Number.MAX_SAFE_INTEGER + 1 })
    expect(over.success).toBe(false)
    if (!over.success) expect(over.error.issues[0].message).toBe('integer out of range')
  })

  // Discovered behaviour, pinned as-is: a non-numeric string coerces to NaN
  // before the gte/lte bounds run, so it fails with zod's generic coercion
  // message rather than the custom 'integer out of range' text.
  it('reports a coercion failure, not the bounds message, for a non-numeric Int', () => {
    const s = tableSchemaToZod([col('n', 'Int')])
    const r = s.safeParse({ n: 'not-a-number' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('Expected number, received nan')
  })

  it('coerces Float and Currency from numeric strings with no integer constraint', () => {
    const s = tableSchemaToZod([col('rate', 'Float'), col('price', 'Currency')])
    expect(s.safeParse({ rate: '3.14', price: '19.99' })).toMatchObject({
      success: true,
      data: { rate: 3.14, price: 19.99 },
    })
  })

  it('maps Check to a strict boolean with no string coercion', () => {
    const s = tableSchemaToZod([col('active', 'Check')])
    expect(s.safeParse({ active: true }).success).toBe(true)
    expect(s.safeParse({ active: false }).success).toBe(true)
    expect(s.safeParse({ active: 'true' }).success).toBe(false)
    expect(s.safeParse({ active: 1 }).success).toBe(false)
  })

  it('maps Choice to an enum of its trimmed, newline-separated choices', () => {
    const s = tableSchemaToZod([col('stage', 'Choice', { choices: '  Open \n\n  Closed  \n' })])
    expect(s.safeParse({ stage: 'Open' }).success).toBe(true)
    expect(s.safeParse({ stage: 'Closed' }).success).toBe(true)
    expect(s.safeParse({ stage: 'Bogus' }).success).toBe(false)
    // the untrimmed original text is not itself a valid member — only the
    // trimmed choice is
    expect(s.safeParse({ stage: ' Open' }).success).toBe(false)
  })

  it('falls back to a free-form string when a Choice column has no choices', () => {
    const s = tableSchemaToZod([col('stage', 'Choice')])
    expect(s.safeParse({ stage: 'anything at all' }).success).toBe(true)
  })

  it('normalizes Date to YYYY-MM-DD, round-tripping Date objects and ISO timestamps', () => {
    const s = tableSchemaToZod([col('d', 'Date')])
    expect(s.safeParse({ d: new Date('2024-01-15T00:00:00.000Z') })).toMatchObject({
      success: true,
      data: { d: '2024-01-15' },
    })
    expect(s.safeParse({ d: '2024-01-15T10:30:00.000Z' })).toMatchObject({
      success: true,
      data: { d: '2024-01-15' },
    })
    expect(s.safeParse({ d: '2024-01-15' })).toMatchObject({ success: true, data: { d: '2024-01-15' } })
  })

  it('rejects a Date value that is not YYYY-MM-DD', () => {
    const s = tableSchemaToZod([col('d', 'Date')])
    const r = s.safeParse({ d: '15-01-2024' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('must be a YYYY-MM-DD date')
  })

  it('accepts any Datetime string Date.parse can parse, and rejects one it cannot', () => {
    const s = tableSchemaToZod([col('dt', 'Datetime')])
    expect(s.safeParse({ dt: '2024-01-15T10:30:00Z' }).success).toBe(true)
    // Date.parse is lenient: a bare date is a valid datetime too
    expect(s.safeParse({ dt: '2024-01-15' }).success).toBe(true)
    const r = s.safeParse({ dt: 'not-a-date' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('must be a valid datetime')
  })

  it('maps JSON and any unrecognized column type to unknown, accepting any value', () => {
    const s = tableSchemaToZod([col('j', 'JSON'), col('x', 'Barcode')])
    expect(s.safeParse({ j: { a: 1 }, x: 12345 }).success).toBe(true)
    expect(s.safeParse({ j: [1, 2, 3], x: 'text' }).success).toBe(true)
  })
})

describe('tableSchemaToZod: layout columns', () => {
  it('drops Sub-table, Section Break, and Column Break from the generated shape', () => {
    const s = tableSchemaToZod([
      col('items', 'Sub-table', { row_table: 'Line Item', reqd: true }),
      col('sec', 'Section Break'),
      col('gap', 'Column Break'),
      col('a', 'Data'),
    ])
    expect(Object.keys(s.shape)).toEqual(['a'])
    // a value for a dropped column is accepted and simply ignored, even
    // though the source Sub-table column was marked required
    expect(s.safeParse({ items: 'whatever', a: 'x' })).toMatchObject({ success: true, data: { a: 'x' } })
  })
})

describe('tableSchemaToZod: required vs optional', () => {
  it('rejects a required column that is missing, null, or empty string', () => {
    const s = tableSchemaToZod([col('a', 'Data', { reqd: true })])
    for (const value of [undefined, null, '']) {
      const r = s.safeParse(value === undefined ? {} : { a: value })
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues[0].message).toBe('Required')
    }
  })

  // Discovered behaviour, pinned as-is: the preprocess step maps both null
  // and '' to undefined before the optional/nullable schema ever sees them,
  // so an explicit null is not preserved in the parsed row — the key is
  // simply absent, the same as if it had never been sent.
  it('accepts an optional column that is missing, null, or empty string, dropping it from the parsed row', () => {
    const s = tableSchemaToZod([col('a', 'Data')])
    for (const value of [undefined, null, '']) {
      const r = s.safeParse(value === undefined ? {} : { a: value })
      expect(r).toMatchObject({ success: true, data: {} })
    }
  })
})

describe('tableSchemaToZod: unknown keys', () => {
  it('silently strips keys that are not in the column list', () => {
    const s = tableSchemaToZod([col('a', 'Data')])
    expect(s.safeParse({ a: 'x', not_a_column: 'y' })).toMatchObject({
      success: true,
      data: { a: 'x' },
    })
  })
})

describe('tableSchemaToZod: update mode (.partial())', () => {
  // document.ts calls schema.partial() for updates so a save can send only
  // the columns that changed.
  it('makes every column optional, including ones marked required', () => {
    const s = tableSchemaToZod([col('a', 'Data', { reqd: true })]).partial()
    expect(s.safeParse({})).toMatchObject({ success: true, data: {} })
  })
})

describe('zodFieldErrors', () => {
  it('returns an empty object when there are no issues', () => {
    const schema = tableSchemaToZod([col('a', 'Data')])
    const r = schema.safeParse({ a: 'ok' })
    expect(r.success).toBe(true)
    expect(zodFieldErrors({ issues: [] } as unknown as import('zod').ZodError)).toEqual({})
  })

  it('extracts a {column_name: message} map for a single failing field', () => {
    const schema = tableSchemaToZod([col('a', 'Data', { reqd: true })])
    const r = schema.safeParse({})
    expect(r.success).toBe(false)
    if (!r.success) expect(zodFieldErrors(r.error)).toEqual({ a: 'Required' })
  })

  it('reports one entry per failing field across multiple failures', () => {
    const schema = tableSchemaToZod([col('a', 'Data', { reqd: true }), col('n', 'Int')])
    const r = schema.safeParse({ a: '', n: 'not-a-number' })
    expect(r.success).toBe(false)
    if (!r.success)
      expect(zodFieldErrors(r.error)).toEqual({
        a: 'Required',
        n: 'Expected number, received nan',
      })
  })

  it('keeps only the first message when one field has multiple issues', () => {
    // Int fails both the underlying-number coercion AND would otherwise also
    // hit the range checks; construct a synthetic error with two issues on
    // the same path to pin the "first one wins" rule directly.
    const error = {
      issues: [
        { path: ['n'], message: 'first problem' },
        { path: ['n'], message: 'second problem' },
      ],
    } as unknown as import('zod').ZodError
    expect(zodFieldErrors(error)).toEqual({ n: 'first problem' })
  })

  it('falls back to the key "_" when an issue has no field in its path', () => {
    const error = {
      issues: [{ path: [], message: 'root problem' }],
    } as unknown as import('zod').ZodError
    expect(zodFieldErrors(error)).toEqual({ _: 'root problem' })
  })
})
