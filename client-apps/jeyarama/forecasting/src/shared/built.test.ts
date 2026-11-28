import { describe, expect, it } from 'vitest'
import { addsOf, evidenceOf } from './built'
import type { Base, BasisCode } from './model'

const base = (code: BasisCode, adds: number): Base => ({ code, own: null, w: null, mw: null, adds })

describe('how it was built (#1425)', () => {
  it('adds up what each base adds across the lines in view', () => {
    const adds = addsOf([{ bases: [base('B1', 100), base('B6', 50)] }, { bases: [base('B1', 20), base('B3', 5)] }])
    expect(adds).toEqual({ B1: 120, B2: 0, B3: 5, B4: 0, B5: 0, B6: 50 })
  })

  it('groups the bases into the three kinds of evidence, with what is left as the other steps', () => {
    const { groups, other } = evidenceOf(1000, { B1: 300, B2: 100, B3: 50, B4: 50, B5: 0, B6: 400 }, 'December')
    expect(groups.map(g => g.value)).toEqual([400, 400, 100])
    expect(other).toBe(100)
  })

  it("names the evidence for the Run's own month", () => {
    const { groups } = evidenceOf(0, {}, 'November')
    expect(groups[0].name).toBe("Last year's November")
    expect(groups[1].what).toContain('the usual October-to-November jump')
  })
})
