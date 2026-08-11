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

  // pins-gap #110: at 62+ sanitized chars the `_n` suffix is sliced back
  // off, so identical long headers collapse to ONE name — the documented
  // "always a valid, unique set" contract is violated. When #110 is fixed
  // this test fails on purpose: flip it to a plain `it` (and fold the
  // boundary into the distinctness property above) in the same change.
  it.fails('IMP-R1: outputs stay distinct AT the truncation boundary (pins #110)', () => {
    const h63 = 'h'.repeat(63)
    expect(new Set(sanitizeHeaders([h63, h63])).size).toBe(2)
    const h70 = 'x'.repeat(70)
    expect(new Set(sanitizeHeaders([h70, h70, h70])).size).toBe(3)
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

  // pins-gap #111: INT_RE accepts leading zeros, so code-like columns
  // ('007') infer Int and the padding is destroyed silently on import.
  // Spec (IMP-R2 example table): digit strings with a leading zero are
  // content → Data. Fixing #111 makes this fail on purpose — flip to `it`.
  it.fails('IMP-R2: leading-zero codes are content, not quantities (pins #111)', () => {
    expect(inferColumnType(['007', '012', '350'])).toBe('Data')
  })

  // pins-gap #112: INT_RE's 15-digit cap correctly refuses >2^53 integers,
  // but the values then fall through to the UNBOUNDED FLOAT_RE and infer
  // Float — '…67' becomes '…68'. Spec: 16+ digit identifiers → Data.
  // Fixing #112 makes this fail on purpose — flip to `it`.
  it.fails('IMP-R2: 16+ digit identifiers must not lose precision (pins #112)', () => {
    expect(inferColumnType(['12345678901234567', '98765432109876543'])).toBe('Data')
  })
})
