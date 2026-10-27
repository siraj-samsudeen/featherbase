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
})

// A place that names no filter value would read as everything.
test.each([
  ['no filters', { label: 'Anywhere', filters: {} }],
  ['a filter with no values', { label: 'Store 12', filters: { store: [] } }],
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
])('a confirmation status for %s is not a valid scope', (_, confirmation) => {
  expect(personScopeSchema.safeParse([{ ...place, confirmation }]).success).toBe(false)
})
