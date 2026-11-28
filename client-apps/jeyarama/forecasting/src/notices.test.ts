import { describe, expect, it } from 'vitest'
import { noticesFor, type Move, type PastAnswer } from './notices'

// made-up: Lakeside (plant 9001); Asha answered Jean and Capri, Bina answered Short; Omar is the Store Manager
const names = { '9001:C1': 'Girls Jean', '9001:C2': 'Girls Capri', '9001:C3': 'Girls Short' }
const answers: PastAnswer[] = [
  { store_code: '9001', subcategory_name: 'Girls Jean', reviewer: 'Asha', forecast_month: '2026-12-01' },
  { store_code: '9001', subcategory_name: 'Girls Capri', reviewer: 'Asha', forecast_month: '2026-12-01' },
  { store_code: '9001', subcategory_name: 'Girls Short', reviewer: 'Bina', forecast_month: '2026-11-01' },
]
const people = { Asha: 'asha@made.up', Bina: 'bina@made.up', Omar: 'omar@made.up' }
const move = (code: string, before: number, after: number): Move => ({ store_code: '9001', subcategory_name: names[`9001:${code}` as keyof typeof names], before, after })

describe('who carry_changes tells (#1419)', () => {
  it('tells whoever answered a subcategory that moved more than 10% this month, and the Store Manager, once each', () => {
    const notices = noticesFor([move('C1', 100000, 120000), move('C2', 50000, 40000)], answers, '2026-12-01', people, { '9001': ['Omar'] })
    expect(notices.map(n => [n.person, n.subject])).toEqual([
      ['asha@made.up', 'Feather Forecast moved for 2 subcategories: answer again'],
      ['omar@made.up', 'Feather Forecast moved for 2 subcategories: answer again'],
    ])
    expect(notices[0].body).toContain('- Girls Jean: ₹1.00 L → ₹1.20 L')
  })

  it('leaves out moves of 10% or less, answers from another month, and names with no Person', () => {
    expect(noticesFor([move('C1', 100000, 110000)], answers, '2026-12-01', people, {})).toEqual([])
    expect(noticesFor([move('C3', 100000, 200000)], answers, '2026-12-01', people, {})).toEqual([])
    expect(noticesFor([move('C1', 100000, 200000)], answers, '2026-12-01', { Omar: 'omar@made.up' }, {})).toEqual([])
  })
})
