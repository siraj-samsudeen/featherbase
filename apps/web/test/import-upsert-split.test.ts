import { describe, expect, it } from 'vitest'
import type { CoercedRow } from 'shared'
import { splitForSend } from '../src/lib/import-run'

// UPS-R2 × IMPORT_CHUNK — the wizard-side half of duplicate catching. The
// server fails duplicates within one request; a duplicate SPLIT ACROSS TWO
// CHUNKS would reach it as two clean requests, so the wizard must fail
// those rows before chunking. splitForSend is that gate: duplicate-key rows
// fail (all occurrences, named), the clean remainder is sent, and sendIdx
// maps each sent position to the row's SOURCE index in the sheet (#115:
// blanks included), so every failure names the true spreadsheet row.
// (Property-style sweep is deterministic here — fast-check lives in the
// server suite; adding it to web is blocked on the git-dep lockfile.)

const row = (sourceIndex: number, values: Record<string, unknown>): CoercedRow => ({
  values,
  sourceIndex,
})

describe('UPS-R2: splitForSend — pre-chunk duplicate catching', () => {
  it('UPS-R2 × #115: rows sharing a key all fail; indices are SOURCE rows, blanks included', () => {
    // Source indices have gaps (2 and 5): blank sheet rows coerceRows
    // dropped. The gate must report source indices, not positions.
    const rows = [
      row(0, { zone: 'Alpha', pop: 1 }), // clean
      row(1, { zone: 'Dup', pop: 2 }), //   duplicate
      row(3, { zone: 'Bravo', pop: 3 }), // clean (blank row above it dropped)
      row(4, { zone: 'Dup', pop: 4 }), //   duplicate (would land in a later chunk)
      row(6, { pop: 5 }), //                empty key: NOT the wizard's to fail —
      //                                    the server names it per-request
    ]
    const { send, sendIdx, dupFailed } = splitForSend(rows, 'zone')
    expect(dupFailed.map((f) => f.sourceIndex)).toEqual([1, 4])
    expect(dupFailed[0].message).toContain('Dup')
    expect(send.map((r) => r.pop)).toEqual([1, 3, 5])
    expect(sendIdx).toEqual([0, 3, 6])
  })

  it('UPS-R2: without a key nothing is withheld', () => {
    const rows = [row(0, { zone: 'Dup' }), row(1, { zone: 'Dup' })]
    const { send, sendIdx, dupFailed } = splitForSend(rows, null)
    expect(send).toHaveLength(2)
    expect(sendIdx).toEqual([0, 1])
    expect(dupFailed).toEqual([])
  })

  it('UPS-R2 sweep: every row is either sent or dup-failed, never both, never lost', () => {
    // All key sequences of length 5 over a 4-symbol alphabet (incl. the
    // empty key) — 1024 files, exhaustive at this size.
    const alphabet = ['A', 'B', 'C', '']
    const total = Math.pow(alphabet.length, 5)
    for (let n = 0; n < total; n++) {
      const keys: string[] = []
      for (let d = 0, v = n; d < 5; d++, v = Math.floor(v / alphabet.length))
        keys.push(alphabet[v % alphabet.length])
      const rows = keys.map((k, i) => row(i, k ? { zone: k, i } : { i }))
      const { send, sendIdx, dupFailed } = splitForSend(rows, 'zone')

      // Partition: |send| + |dupFailed| = |rows|; indices disjoint, exhaustive.
      expect(send.length + dupFailed.length).toBe(rows.length)
      const claimed = [...sendIdx, ...dupFailed.map((f) => f.sourceIndex)].sort((a, b) => a - b)
      expect(claimed).toEqual(rows.map((_, i) => i))

      // Exactly the multi-occurrence keys fail; empty keys pass through.
      const counts = new Map<string, number>()
      for (const k of keys) if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
      for (const f of dupFailed)
        expect(counts.get(String(rows[f.sourceIndex].values.zone)) ?? 0).toBeGreaterThan(1)
      for (const [pos, r] of send.entries()) expect(rows[sendIdx[pos]].values).toBe(r)
    }
  })
})
