import { describe, expect, it } from 'vitest'
import { MISSING_DECISIONS, UNLISTED_DECISIONS, pickSample, reviewLines, withinPlace } from './countRules'

const expected = [
  { asset: 'ac', expected_place: 'billing' },
  { asset: 'pc', expected_place: 'billing' },
  { asset: 'chiller', expected_place: 'dairy' },
  { asset: 'scale', expected_place: 'dairy' },
  { asset: 'forklift', expected_place: 'store' },
  { asset: 'shelf', expected_place: 'store' },
]
const now = new Map([['ac', 'billing'], ['pc', 'billing'], ['chiller', 'dairy'], ['scale', 'dairy'], ['forklift', 'enchakkal'], ['shelf', 'store'], ['ups', 'office']])
const scans = [
  { row_id: 's1', asset: 'ac', outcome: 'Found here', duplicate: false },
  { row_id: 's2', asset: 'pc', outcome: 'Belongs elsewhere', duplicate: false },
  { row_id: 's3', asset: 'chiller', outcome: 'Damaged', duplicate: false },
  { row_id: 's4', asset: 'ac', outcome: 'Found here', duplicate: true },
  { row_id: 's5', asset: null, outcome: 'Not on the list', duplicate: false },
  { row_id: 's6', asset: 'ups', outcome: 'Found here', duplicate: false },
  { row_id: 's7', asset: 'shelf', outcome: 'Idle', duplicate: false },
]

describe('review lines', () => {
  it('sorts every expected asset and every record into one outcome', () => {
    const review = reviewLines({ expected, scans, placeNow: now, decisions: [] })
    expect(review.expected).toBe(6)
    expect(review.lines).toEqual({
      found: ['ac'], damaged: ['chiller'], idle: ['shelf'], elsewhere: ['pc'],
      missing: ['scale'], moved: ['forklift'], unlisted: ['s5', 's6'], duplicate: ['s4'],
    })
    expect(review.counts).toEqual({ found: 1, damaged: 1, idle: 1, elsewhere: 1, missing: 1, moved: 1, unlisted: 2, duplicate: 1 })
  })

  it('needs a final decision on every missing and unlisted line before closing', () => {
    const open = reviewLines({ expected, scans, placeNow: now, decisions: [{ asset: 'scale', scan: null, decision: 'Recount' }] })
    expect(open.recount).toEqual(['scale'])
    expect(open.undecided).toEqual({ missing: ['scale'], unlisted: ['s5', 's6'] })
    expect(open.closable).toBe(false)
    const decided = reviewLines({ expected, scans, placeNow: now, decisions: [
      { asset: 'scale', scan: null, decision: 'To Loss Prevention' },
      { asset: null, scan: 's5', decision: 'Controlled item' },
      { asset: null, scan: 's6', decision: 'Third-party' },
    ] })
    expect(decided.undecided).toEqual({ missing: [], unlisted: [] })
    expect(decided.closable).toBe(true)
  })

  it('counts a recounted asset as found once it is recorded', () => {
    const recounted = reviewLines({ expected, scans: [...scans, { row_id: 's8', asset: 'scale', outcome: 'Found here', duplicate: false }], placeNow: now,
      decisions: [{ asset: 'scale', scan: null, decision: 'Recount' }] })
    expect(recounted.lines.missing).toEqual([])
    expect(recounted.lines.found).toEqual(['ac', 'scale'])
    expect(recounted.recount).toEqual([])
    expect(recounted.undecided.missing).toEqual([])
  })

  it('offers decisions that fit each kind of line', () => {
    expect(MISSING_DECISIONS).toEqual(['Recount', 'Found later', 'Mapping corrected', 'To Loss Prevention', 'Propose retirement to Finance'])
    expect(UNLISTED_DECISIONS).toEqual(['Capitalize', 'Controlled item', 'Third-party'])
  })
})

describe('places and samples', () => {
  const places = [
    { row_id: 'site', place_name: 'ATK 1501', parent_place: null },
    { row_id: 'floor', place_name: 'Ground floor', parent_place: 'site' },
    { row_id: 'billing', place_name: 'Billing', parent_place: 'floor' },
    { row_id: 'other', place_name: 'Enchakkal WH 9151', parent_place: null },
  ]

  it('knows whether a place is inside the counted place', () => {
    expect(withinPlace('billing', 'site', places)).toBe(true)
    expect(withinPlace('site', 'site', places)).toBe(true)
    expect(withinPlace('billing', 'floor', places)).toBe(true)
    expect(withinPlace('other', 'site', places)).toBe(false)
    expect(withinPlace('floor', 'billing', places)).toBe(false)
  })

  it('picks the chosen number of assets, each once', () => {
    const picked = pickSample(['a', 'b', 'c', 'd', 'e'], 3, () => 0)
    expect(picked).toHaveLength(3)
    expect(new Set(picked).size).toBe(3)
    expect(pickSample(['a', 'b'], 5, Math.random).sort()).toEqual(['a', 'b'])
  })
})
