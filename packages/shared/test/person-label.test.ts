// #1345: the words beside a person's name, the one place they are put together,
// so every surface reads alike. Made-up people.
import { describe, expect, test } from 'vitest'
import { needsEmail, personMeta, personMetaShort, personMetaText } from '../src/person-label'

describe('personMeta', () => {
  test('code · role · place, each where known; with none of them, the email', () => {
    expect(personMetaText({ code: 'TN-1', role: 'Cashier', place: 'Hill Road' })).toBe('TN-1 · Cashier · Hill Road')
    expect(personMetaText({ role: 'Area Manager', place: 'North' })).toBe('Area Manager · North')
    expect(personMetaText({ code: 'TN-1' })).toBe('TN-1')
    expect(personMetaText({ email: 'a@example.test' })).toBe('a@example.test')
    expect(personMeta(undefined)).toEqual([])
    expect(personMetaText(undefined)).toBe('')
  })

  test('the email is added where asked for, after the other words', () => {
    expect(personMetaText({ code: 'TN-1', email: 'a@example.test' }, { withEmail: true })).toBe('TN-1 · a@example.test')
    expect(personMetaText({ code: 'TN-1', email: 'a@example.test' })).toBe('TN-1')
  })

  test('Former Staff with the day they left and their code', () => {
    expect(personMetaText({ standing: 'left', left_on: '2026-03-12', code: '3990' })).toBe('Former Staff · left 12-Mar-2026 · 3990')
    expect(personMetaText({ standing: 'left', code: '3990' })).toBe('Former Staff · 3990')
    expect(personMeta({ standing: 'left', left_on: '2026-03-12' }).map((p) => p.kind)).toEqual(['standing', 'left'])
  })

  test('a Consultant or Supplier with their company', () => {
    expect(personMetaText({ standing: 'consultant', company: 'Made-up Advisory' })).toBe('Consultant · Made-up Advisory')
    expect(personMetaText({ standing: 'supplier' })).toBe('Supplier')
  })

  test('someone on the staff reads as code · role · place', () => {
    expect(personMetaText({ standing: 'current', code: 'TN-1', place: 'Hill Road' })).toBe('TN-1 · Hill Road')
  })
})

describe('personMetaShort', () => {
  test('(code · place) for activity lines, or nothing', () => {
    expect(personMetaShort({ code: 'TN-1', role: 'Cashier', place: 'Hill Road' })).toBe('(TN-1 · Hill Road)')
    expect(personMetaShort({ standing: 'left', code: '3990' })).toBe('(Former Staff · 3990)')
    expect(personMetaShort({ email: 'a@example.test' })).toBe('')
    expect(personMetaShort(undefined)).toBe('')
  })
})

describe('needsEmail', () => {
  test('only people who would read exactly the same need their email', () => {
    const a = { title: 'Ravi', person: { role: 'Cashier', email: 'a@example.test' } }
    const b = { title: 'Ravi', person: { role: 'Cashier', email: 'b@example.test' } }
    const c = { title: 'Ravi', person: { code: 'TN-3' } }
    const d = { title: 'Ravi' }
    expect([...needsEmail([a, b, c, d])]).toEqual([a, b])
  })
})
