// Adding a Dive to Dash (#1169): what a pasted link, id or name finds, and the key a new report
// takes. Made-up Dives only.
import { describe, expect, it } from 'vitest'
import { diveIdIn, matchingDives, reportKeyFor, type DiveChoice } from './add-dive'

const dive = (over: Partial<DiveChoice>): DiveChoice => ({ dive_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Floor stock', owner: 'asha', saved_on: '2026-11-14', in_dash: null, ...over })
const floor = dive({})
const pricing = dive({ dive_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Women buyers pricing', owner: 'ben', saved_on: '2026-11-10' })
const kurti = dive({ dive_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Kurti tower', owner: 'asha', saved_on: '2026-11-12', in_dash: 'Kurti tower' })

describe("a Dive's id in what was pasted", () => {
  it('is the id itself', () => {
    expect(diveIdIn(' bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb ')).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  })

  it("is the id at the end of a Dive's link, whatever its title words, query and saved view", () => {
    expect(diveIdIn('https://app.motherduck.com/dives/women-buyers-pricing-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb?s=ae41822e#state=eyJ3b21l')).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  })

  it('is read in lower case', () => {
    expect(diveIdIn('BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBABCD')).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbabcd')
  })

  it('is none in a name', () => {
    expect(diveIdIn('Floor stock')).toBeNull()
  })
})

describe('the Dives a search finds', () => {
  const all = [floor, pricing, kurti]

  it('are all of them, newest saved first, for an empty search', () => {
    expect(matchingDives(all, '').map(d => d.title)).toEqual(['Floor stock', 'Kurti tower', 'Women buyers pricing'])
  })

  it("are those whose title or owner holds every word typed, in any case", () => {
    expect(matchingDives(all, 'PRICING women').map(d => d.title)).toEqual(['Women buyers pricing'])
    expect(matchingDives(all, 'asha').map(d => d.title)).toEqual(['Floor stock', 'Kurti tower'])
  })

  it('is the one Dive a pasted link or id names', () => {
    expect(matchingDives(all, 'https://app.motherduck.com/dives/x-cccccccc-cccc-4ccc-8ccc-cccccccccccc?s=1').map(d => d.title)).toEqual(['Kurti tower'])
  })

  it("is none for a link to a Dive Dash can't see", () => {
    expect(matchingDives(all, 'https://app.motherduck.com/dives/x-dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toEqual([])
  })
})

describe("a new report's key", () => {
  it('is its name in lower case, words joined by dashes', () => {
    expect(reportKeyFor('KL Women · Floor Stock (Nov)', [])).toBe('kl-women-floor-stock-nov')
  })

  it('takes the next free number when the key is taken', () => {
    expect(reportKeyFor('Floor stock', ['floor-stock', 'floor-stock-2'])).toBe('floor-stock-3')
  })

  it('is "report" for a name with no letter or digit', () => {
    expect(reportKeyFor('· ·', [])).toBe('report')
  })
})

describe('Dives never saved', () => {
  it('come after every saved Dive, by title', () => {
    const unsaved = dive({ dive_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', title: 'Draft', saved_on: null })
    const alsoUnsaved = dive({ dive_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', title: 'Another draft', saved_on: null })
    expect(matchingDives([unsaved, floor, alsoUnsaved], '').map(d => d.title)).toEqual(['Floor stock', 'Another draft', 'Draft'])
  })
})
