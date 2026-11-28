import { describe, expect, it } from 'vitest'
import { ownerOf, type SignedIn } from './chainPage'
import { storeOf } from '../storeManager/sections'
import type { Chain, ChainPerson } from './chainData'
import type { Line } from './model'

// made-up: two stores, Lakeside (LKS) and Hilltop (HLT); two Store Managers who share the name Omar (E1 at LKS,
// E2 at HLT); two category heads who share the name Ravi (E3, E4); no Chief Executive on the chain itself
const line = (store: string, code: string) => ({ store, storeName: store === 'LKS' ? 'Lakeside' : 'Hilltop', code, rowId: `${store}-${code}` }) as unknown as Line
const people: ChainPerson[] = [
  { id: 'E1', name: 'Omar', role: 'Store Manager', place: 'LKS', places: [{ store: 'LKS', codes: null }] },
  { id: 'E2', name: 'Omar', role: 'Store Manager', place: 'HLT', places: [{ store: 'HLT', codes: null }] },
  { id: 'E3', name: 'Ravi', role: 'Category Head', place: 'North', places: [{ store: 'LKS', codes: ['S1'] }] },
  { id: 'E4', name: 'Ravi', role: 'Category Head', place: 'North', places: [{ store: 'HLT', codes: ['S2'] }] },
]
const chain = { real: true, lines: [line('LKS', 'S1'), line('LKS', 'S2'), line('HLT', 'S2')], sections: [], people, proposals: [], cutOff: '2026-11-27', horizon: '2026-12-01' } as Chain
const me = (employees: string[], chiefs: SignedIn['chiefs'] = [], admin = false): SignedIn => ({ admin, employees, chiefs })
const person = (o: ReturnType<typeof ownerOf>) => ('person' in o ? o.person : null)

describe('whose manager page opens (#1438)', () => {
  it('opens a Store Manager on their own store, matched by Employee row, never by the name they share', () => {
    expect(person(ownerOf('store-review', chain, me(['E2']), null))).toMatchObject({ id: 'E2', places: [{ store: 'HLT' }] })
  })

  it("ignores ?as= for someone who is not an administrator: they cannot open another manager's page", () => {
    expect(person(ownerOf('store-review', chain, me(['E2']), 'E1'))?.id).toBe('E2')
    expect(person(ownerOf('category-review', chain, me(['E3']), 'E4'))?.id).toBe('E3')
  })

  it('keeps two category heads who share a name apart, each with their own merchandise', () => {
    expect(person(ownerOf('category-review', chain, me(['E4']), null))?.places).toEqual([{ store: 'HLT', codes: ['S2'] }])
  })

  it('lets an administrator view as anyone by their Employee row (?as=), and not by a name', () => {
    expect(person(ownerOf('store-review', chain, me([], [], true), 'E1'))?.id).toBe('E1')
    expect(person(ownerOf('store-review', chain, me([], [], true), 'Omar'))).toBeNull()
    expect(person(ownerOf('category-review', chain, me([], [], true), 'E4'))?.id).toBe('E4')
  })

  it('opens RB Review for the Chief Executive the org chart names, under their own name, covering every store', () => {
    const o = ownerOf('rb-review', chain, me(['E9'], [{ id: 'E9', name: 'Kumar', job: 'Managing Director' }]), null)
    expect(person(o)).toMatchObject({ id: 'E9', name: 'Kumar', role: 'Chief Executive', places: [{ store: 'LKS', codes: null }, { store: 'HLT', codes: null }] })
  })

  it('says plainly when the org chart has no job for the page, not an empty page or a placeholder name', () => {
    expect(ownerOf('rb-review', chain, me(['E1']), null)).toEqual({ missing: expect.objectContaining({ title: 'No Chief Executive job on the org chart' }) })
    expect(ownerOf('rb-review', chain, me([], [], true), null)).toEqual({ missing: expect.objectContaining({ title: 'No Chief Executive job on the org chart' }) })
    expect(ownerOf('store-review', chain, me(['E3']), null)).toEqual({ missing: expect.objectContaining({ title: 'You have no Store Manager job on the org chart' }) })
    expect(ownerOf('category-review', chain, me(['E1']), null)).toEqual({ missing: expect.objectContaining({ title: 'You have no category head assignment on the org chart' }) })
  })

  it('tells someone whose sign-in has no employee record so, whatever the page', () => {
    expect(ownerOf('store-review', chain, me([]), null)).toEqual({ missing: expect.objectContaining({ title: 'Your sign-in is not linked to an employee' }) })
  })

  it('gives one person with two jobs (or an Employee row in each region) every place they hold', () => {
    expect(person(ownerOf('store-review', chain, me(['E1', 'E2']), null))?.places.map(p => p.store)).toEqual(['LKS', 'HLT'])
  })
})

describe("the store a Store Manager's page reviews (#1438)", () => {
  const omar = people[0]
  it("keeps a Store Manager to their own stores: ?store= of someone else's store is ignored", () => {
    expect(storeOf(chain, omar, false, 'HLT')).toBe('LKS')
    expect(storeOf(chain, omar, false, 'Lakeside')).toBe('LKS')
  })
  it('lets an administrator open any store by code or name, and opens the biggest store when nothing is named', () => {
    expect(storeOf(chain, null, true, 'Hilltop')).toBe('HLT')
    expect(storeOf(chain, null, true, null)).toBe('LKS')
  })
})
