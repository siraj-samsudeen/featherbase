import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { inferColumnType, sanitizeColumnName, sanitizeHeaders } from 'shared'

// Property tests for IMP-R1 (column naming) and IMP-R2 (type inference) —
// docs/design/requirements-framework.md, Part I §3: example tables are for
// agreement, properties are for coverage. Every assertion here states the
// SPEC. Where today's code violates it, the test is `it.fails` with the
// issue pinned: the suite stays green, and FIXING the bug makes the pin
// fail on purpose — flip it to a plain `it` in the same change.

const IDENT = /^[a-z][a-z0-9_]*$/

// Headers whose sanitized form stays well under the 63-char cap, so the
// suffixing logic never meets the truncation boundary (that boundary is
// pinned separately — #110).
const shortHeader = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constantFrom('Zone Name', 'name', 'id', '2026 Total', '', '   ', 'unitPrice', 'Qty (kg)'),
)

describe('IMP-R1 properties: column naming', () => {
  it('IMP-R1: output length always equals input length', () => {
    fc.assert(
      fc.property(fc.array(shortHeader, { maxLength: 12 }), (headers) => {
        expect(sanitizeHeaders(headers)).toHaveLength(headers.length)
      }),
    )
  })

  it('IMP-R1: every output is a valid identifier of at most 63 chars, never reserved', () => {
    const reserved = new Set(['row_id', 'owner', 'created_at', 'updated_at', 'parent', 'parenttype', 'parentfield'])
    fc.assert(
      fc.property(fc.array(shortHeader, { minLength: 1, maxLength: 12 }), (headers) => {
        for (const out of sanitizeHeaders(headers)) {
          expect(out).toMatch(IDENT)
          expect(out.length).toBeLessThanOrEqual(63)
          expect(reserved.has(out)).toBe(false)
        }
      }),
    )
  })

  it('IMP-R1: outputs are distinct below the truncation boundary', () => {
    fc.assert(
      fc.property(fc.array(shortHeader, { maxLength: 12 }), (headers) => {
        const out = sanitizeHeaders(headers)
        expect(new Set(out).size).toBe(out.length)
      }),
    )
  })

  it('IMP-R1: sanitizeColumnName is deterministic and shape-valid on any input', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ maxLength: 100 }), fc.string({ unit: 'grapheme', maxLength: 100 })),
        (h) => {
        const a = sanitizeColumnName(h)
        expect(sanitizeColumnName(h)).toBe(a)
        if (a !== '') {
          // The server's column rule, minus the trailing-underscore slice
          // artefact: starts lowercase, stays in [a-z0-9_], caps at 63.
          expect(a).toMatch(/^[a-z][a-z0-9_]*$/)
          expect(a.length).toBeLessThanOrEqual(63)
        }
        },
      ),
    )
  })

  it('IMP-R1.uniq-boundary: outputs stay distinct AT the truncation boundary (#110)', () => {
    fc.assert(fc.property(fc.integer({ min: 61, max: 70 }), fc.integer({ min: 2, max: 110 }), (length, copies) => {
      const h = 'h'.repeat(length)
      const out = sanitizeHeaders([h.slice(0, 61) + '_1', ...Array(copies).fill(h), '', 'row_id'])
      expect(new Set(out).size).toBe(out.length)
      for (const name of out) expect(name).toMatch(/^[a-z][a-z0-9_]{0,62}$/)
    }))
  })
})

describe('IMP-R2 properties: type inference', () => {
  const anyCell = fc.oneof(
    fc.string({ maxLength: 160 }),
    fc.double(),
    fc.integer(),
    fc.boolean(),
    fc.date(),
    fc.constant(null),
    fc.constant(undefined),
    fc.constant(''),
  )
  const KNOWN = ['Check', 'Int', 'Float', 'Date', 'Datetime', 'Text', 'Data']

  it('IMP-R2: total — any column of any values yields exactly one known type', () => {
    fc.assert(
      fc.property(fc.array(anyCell, { maxLength: 20 }), (values) => {
        expect(KNOWN).toContain(inferColumnType(values))
      }),
    )
  })

  it('IMP-R2: order-independent — permuting rows never changes the type', () => {
    fc.assert(
      fc.property(fc.array(anyCell, { maxLength: 20 }), (values) => {
        const t = inferColumnType(values)
        expect(inferColumnType([...values].reverse())).toBe(t)
        expect(inferColumnType([...values].sort(() => -1))).toBe(t)
      }),
    )
  })

  it('IMP-R2: an entirely empty column falls back to Data', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(null, undefined, '', '   '), { maxLength: 8 }), (values) => {
        expect(inferColumnType(values)).toBe('Data')
      }),
    )
  })

  it('IMP-R2: canonical whole numbers infer Int', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -9_999_999, max: 9_999_999 }).map(String), { minLength: 1, maxLength: 20 }),
        (values) => {
          expect(inferColumnType(values)).toBe('Int')
        },
      ),
    )
  })

  it('IMP-R2: one decimal anywhere forbids Int — the narrower type would lose data', () => {
    const intStr = fc.integer({ min: 0, max: 99_999 }).map(String)
    const decStr = fc
      .tuple(fc.integer({ min: 0, max: 99_999 }), fc.integer({ min: 1, max: 99 }))
      .map(([w, f]) => `${w}.${f}`)
    fc.assert(
      fc.property(fc.array(intStr, { maxLength: 10 }), decStr, fc.array(intStr, { maxLength: 10 }), (a, d, b) => {
        expect(inferColumnType([...a, d, ...b])).toBe('Float')
      }),
    )
  })

  it('IMP-R2: yes/no in any casing infers Check — and wins before Choice could', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('yes', 'no', 'YES', 'No', 'true', 'FALSE', 'y', 'N'), {
          minLength: 1,
          maxLength: 20,
        }),
        (values) => {
          expect(inferColumnType(values)).toBe('Check')
        },
      ),
    )
  })

  it('IMP-R2: non-numeric text over 140 chars infers Text', () => {
    const longAlpha = fc
      .array(fc.constantFrom(...'abcdefghijklmnop'), { minLength: 141, maxLength: 200 })
      .map((cs) => cs.join(''))
    fc.assert(
      fc.property(fc.array(longAlpha, { minLength: 1, maxLength: 5 }), (values) => {
        expect(inferColumnType(values)).toBe('Text')
      }),
    )
  })

  it('IMP-R2.leading-zero: leading-zero codes are content, not quantities (#111)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 999999 }), (n) => {
      expect(inferColumnType([`0${n}`, '350', '1.5'])).toBe('Data')
    }))
  })

  it('IMP-R2.16-digit: unsafe integer identifiers must not lose precision (#112)', () => {
    fc.assert(fc.property(fc.bigInt({ min: 9007199254740992n, max: 9999999999999999999n }), (n) => {
      expect(inferColumnType([String(n), '2.25'])).toBe('Data')
      expect(inferColumnType([String(-n), '2'])).toBe('Data')
    }))
  })
})
