import { describe, expect, it } from 'vitest'
import { parentsOf } from './MeasureTable'
import { contribution } from './model'

describe('Share: contribution among siblings (Siraj, 28-Nov)', () => {
  it("groups a section's rows and a group's members as siblings, and a tree by depth", () => {
    const flat = parentsOf([{ key: 'Capri' }, { key: 'G1', look: ['band', 'head'] }, { key: 'Jean', look: ['member'] }, { key: 'Pant', look: ['member'] }, { key: 'Skirt' }])
    expect([...flat]).toEqual([['Capri', ''], ['G1', ''], ['Jean', 'G1'], ['Pant', 'G1'], ['Skirt', '']])
    const tree = parentsOf([{ key: 'D', depth: 0 }, { key: 'C1', depth: 1 }, { key: 'S1', depth: 2 }, { key: 'C2', depth: 1 }, { key: 'E', depth: 0 }])
    expect(tree.get('S1')).toBe('C1'); expect(tree.get('C2')).toBe('D'); expect(tree.get('E')).toBe('')
  })
  it('shows a whole %, "<1%" for a sliver, and — with nothing to divide by', () => {
    expect([contribution(25, 100), contribution(0.5, 100), contribution(0, 100), contribution(5, 0)]).toEqual(['25%', '<1%', '0%', '—'])
  })
})
