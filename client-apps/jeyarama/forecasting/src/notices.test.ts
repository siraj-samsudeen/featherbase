import { describe, expect, it } from 'vitest'
import { noticesFor, type Move, type PastAnswer } from './notices'

// made-up: Lakeside (plant 9001); Asha answered Jean (at ₹1,00,000) and Capri (at ₹50,000), Bina answered Short in
// November; Omar is the Store Manager
const answer = (subcategory_name: string, reviewer: string, engine: number, forecast_month = '2026-12-01'): PastAnswer =>
  ({ store_code: '9001', subcategory_name, reviewer, forecast_month, engine_value_before_tax: engine })
const answers = [answer('Girls Jean', 'Asha', 100000), answer('Girls Capri', 'Asha', 50000), answer('Girls Short', 'Bina', 100000, '2026-11-01')]
const people = { Asha: 'asha@made.up', Bina: 'bina@made.up', Omar: 'omar@made.up' }
const move = (sub: string, before: number | null, after: number): Move => ({ store_code: '9001', subcategory_name: sub, before, after })

describe('who carry_changes tells (#1419)', () => {
  it('tells whoever answered a subcategory now more than 10% from the figure they answered, and the Store Manager in their own words, once each', () => {
    const notices = noticesFor([move('Girls Jean', 100000, 120000), move('Girls Capri', 50000, 40000)], answers, '2026-12-01', people, { '9001': ['omar@made.up'] })
    expect(notices.map(n => [n.person, n.subject])).toEqual([
      ['asha@made.up', 'Feather Forecast moved for 2 subcategories: answer again'],
      ['omar@made.up', 'Feather Forecast moved for 2 subcategories: your team answers again'],
    ])
    expect(notices[0].body).toContain('- Girls Jean: ₹1.00 L → ₹1.20 L')
    expect(notices[1].body).toContain('- Girls Jean: ₹1.00 L → ₹1.20 L (answered by Asha)')
  })

  it('measures from the answer, not the last load: 100 → 105 → 114 tells on the second load, and never twice', () => {
    expect(noticesFor([move('Girls Jean', 100000, 105000)], answers, '2026-12-01', people, {})).toEqual([])
    expect(noticesFor([move('Girls Jean', 105000, 114000)], answers, '2026-12-01', people, {}).map(n => n.person)).toEqual(['asha@made.up'])
    expect(noticesFor([move('Girls Jean', 114000, 118000)], answers, '2026-12-01', people, {})).toEqual([])
  })

  it('leaves out moves of 10% or less, answers from another month, names with no Person, and subcategories no one answered', () => {
    expect(noticesFor([move('Girls Jean', 100000, 110000)], answers, '2026-12-01', people, { '9001': ['omar@made.up'] })).toEqual([])
    expect(noticesFor([move('Girls Short', 100000, 200000)], answers, '2026-12-01', people, {})).toEqual([])
    expect(noticesFor([move('Girls Jean', 100000, 200000)], answers, '2026-12-01', { Omar: 'omar@made.up' }, {})).toEqual([])
  })

  it('tells each Store Manager by Person, so two who share a name are both told (#1438)', () => {
    const told = noticesFor([move('Girls Jean', 100000, 200000)], answers, '2026-12-01', people, { '9001': ['omar-one@made.up', 'omar-two@made.up'] })
    expect(told.map(n => n.person)).toEqual(['asha@made.up', 'omar-one@made.up', 'omar-two@made.up'])
    expect(noticesFor([move('Girls Skirt', 100000, 200000)], answers, '2026-12-01', people, { '9001': ['omar@made.up'] })).toEqual([])
  })
})
