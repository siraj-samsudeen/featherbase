import { describe, expect, it } from 'vitest'
import { ROW_RULE_KINDS, rowRuleSchema, rowRuleWords } from '../src/row-rule'

describe('#1459 a row rule is one of a closed set of kinds', () => {
  it('reads each kind, and nothing else', () => {
    for (const rule of [
      { kind: 'all' }, { kind: 'administrators' }, { kind: 'own' }, { kind: 'own', columns: ['owner'], whole_for: ['Head Office'] },
      { kind: 'places', columns: { store: 'store_code' } }, { kind: 'through', column: 'project' },
    ]) expect(rowRuleSchema.parse(rule)).toEqual(rule)
    expect(ROW_RULE_KINDS).toEqual(['all', 'own', 'places', 'through', 'administrators'])
    for (const bad of [
      { kind: 'everybody' }, { kind: 'all', whole_for: ['Head Office'] }, { kind: 'own', columns: [] }, { kind: 'own', columns: ['owner', 'owner'] },
      { kind: 'own', whole_for: ['Head Office', 'Head Office'] }, { kind: 'places', columns: {} }, { kind: 'places' }, { kind: 'through' },
      { kind: 'through', column: 'Not A Column' }, { kind: 'own', extra: true },
    ]) expect(rowRuleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
  })

  it('says each rule in a few words', () => {
    expect(rowRuleWords(null)).toBe('No rule: System Managers only')
    expect(rowRuleWords(undefined)).toBe('No rule: System Managers only')
    expect(rowRuleWords({ kind: 'all' })).toBe('Every row')
    expect(rowRuleWords({ kind: 'administrators' })).toBe('System Managers only')
    expect(rowRuleWords({ kind: 'own' })).toBe('Own rows')
    expect(rowRuleWords({ kind: 'own', columns: ['owner', 'assignee'], whole_for: ['Head Office'] }))
      .toBe('Own rows (created, or named in owner, assignee); every row for Head Office')
    expect(rowRuleWords({ kind: 'places', columns: { store: 'store_code', subcategory: 'subcategory_code' } }))
      .toBe('Within the person\'s places (store: store_code, subcategory: subcategory_code)')
    expect(rowRuleWords({ kind: 'through', column: 'project', whole_for: ['Head Office', 'Audit'] })).toBe('Through project; every row for Head Office, Audit')
  })
})
