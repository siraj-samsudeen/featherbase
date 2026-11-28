import { describe, expect, it } from 'vitest'
import { carryAnswers, type StoredAnswer } from './carry'

const a = (run: string, sub: string, engine: number | null, answer: string, updatedAt = '2026-11-28T10:00', month = '2026-12-01'): StoredAnswer<string> => ({ run, month, subcategory: sub, engine, updatedAt, answer })

describe('carrying answers to a new official Run (#1419)', () => {
  it("keeps an answer given on this Run, and carries one from an earlier Run of the month while Feather Forecast moved 10% or less", () => {
    const { answers, moved } = carryAnswers([a('v2', 'Jean', 100, 'mine on v2'), a('v1', 'Capri', 100, 'carried')], 'v2', '2026-12-01', { Jean: 300, Capri: 110 })
    expect(answers).toEqual({ Jean: 'mine on v2', Capri: 'carried' })
    expect(moved).toEqual({})
  })

  it('asks again when Feather Forecast moved by more than 10%, either way', () => {
    const { answers, moved } = carryAnswers([a('v1', 'Capri', 100, 'old'), a('v1', 'Skirt', 100, 'old')], 'v2', '2026-12-01', { Capri: 111, Skirt: 89 })
    expect(answers).toEqual({})
    expect(moved).toEqual({ Capri: { from: 100, to: 111 }, Skirt: { from: 100, to: 89 } })
  })

  it("never carries another month's answer, and takes the newest earlier answer", () => {
    const stored = [a('nov', 'Jean', 100, 'november', '2026-11-28T10:00', '2026-11-01'), a('v0', 'Capri', 100, 'older', '2026-11-26T10:00'), a('v1', 'Capri', 100, 'newer', '2026-11-27T10:00')]
    expect(carryAnswers(stored, 'v2', '2026-12-01', { Jean: 100, Capri: 100 }).answers).toEqual({ Capri: 'newer' })
  })

  it('asks again when the earlier answer recorded no Feather Forecast', () => {
    expect(carryAnswers([a('v1', 'Capri', null, 'old')], 'v2', '2026-12-01', { Capri: 100 }).moved).toEqual({ Capri: { from: 0, to: 100 } })
  })
})
