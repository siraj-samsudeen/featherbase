import { expect, test } from 'vitest'
import { personScopeSchema } from '../src/index'

const place = {
  label: 'Store 12 / Kids Wear',
  filters: { store: ['12'], section: ['kids'] },
  basis: 'team leader',
  confirmation: { section: { kids: 'assumed' } },
}

test('a place with a label, filter values, a basis and confirmation statuses is a valid scope', () => {
  expect(personScopeSchema.parse([place])).toEqual([place])
  const other = { label: 'Store 13', filters: { store: ['13'] } }
  expect(personScopeSchema.parse([place, other])).toEqual([place, other])
})

// A place that names no filter value would read as everything.
test.each([
  ['no filters', { label: 'Anywhere', filters: {} }],
  ['a filter with no values', { label: 'Store 12', filters: { store: [] } }],
  ['a whitespace-only label', { label: ' \t ', filters: { store: ['12'] } }],
  ['a whitespace-only value', { label: 'Store 12', filters: { store: ['12', ' \t '] } }],
  ['an invalid filter-name prefix', { label: 'Store 12', filters: { '!store': ['12'] } }],
  ['an invalid filter-name suffix', { label: 'Store 12', filters: { 'store!': ['12'] } }],
])('a place with %s is not a valid scope', (_, invalid) => {
  expect(personScopeSchema.safeParse([invalid]).success).toBe(false)
})

test('two places with one label are not a valid scope', () => {
  expect(personScopeSchema.safeParse([place, { ...place, filters: { store: ['13'] } }]).success).toBe(false)
})

test('a filter value listed twice in one place is not a valid scope', () => {
  expect(personScopeSchema.safeParse([{ label: 'Store 12', filters: { store: ['12', '12'] } }]).success).toBe(false)
})

test.each([
  ['a filter the place does not name', { region: { north: 'confirmed' } }],
  ['a value the place does not name', { section: { mens: 'confirmed' } }],
  ['an invalid filter alongside a valid one', { section: { kids: 'assumed' }, region: { north: 'confirmed' } }],
  ['an invalid value alongside a valid one', { section: { kids: 'assumed', mens: 'confirmed' } }],
])('a confirmation status for %s is not a valid scope', (_, confirmation) => {
  expect(personScopeSchema.safeParse([{ ...place, confirmation }]).success).toBe(false)
})

// #628 (Q1 C): a place says why the person has it, with dates where the app knows them.
test('a place may carry its reasons, each with a start and end day', () => {
  const reasoned = { ...place, reasons: [{ text: 'Team Leader job assignment', since: '2026-08-06', until: '2026-12-31' }, { text: 'Old rule' }] }
  expect(personScopeSchema.parse([reasoned])).toEqual([reasoned])
})

test('a reason without text, or with a day that is not a day, is not a valid scope', () => {
  for (const reasons of [[{ text: '' }], [{ text: 'Job', since: '6 Aug' }], [{ text: 'Job', until: '2026-13-01' }], [{ text: 'Job', extra: 1 }]])
    expect(personScopeSchema.safeParse([{ ...place, reasons }]).success).toBe(false)
})
