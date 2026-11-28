import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rowRuleProblems } from './check-row-rules.mjs'

const tables = [{ name: 'shop.order' }, { name: 'shop.line', kind: 'sub_table' }, { name: 'shop.setting', kind: 'settings' }]

test('a Table with no rule is a problem; a Sub-table needs none', () => {
  assert.deepEqual(rowRuleProblems({ tables, rowRules: { 'shop.order': { kind: 'own' }, 'shop.setting': { kind: 'all' } } }), [])
  assert.deepEqual(rowRuleProblems({ tables, rowRules: { 'shop.order': { kind: 'own' } } }), ['shop.setting has no row rule'])
  assert.deepEqual(rowRuleProblems({ tables }), ['shop.order has no row rule', 'shop.setting has no row rule'])
})

test('a rule that names no Table of the app, or a Sub-table, is a problem', () => {
  const rowRules = { 'shop.order': { kind: 'all' }, 'shop.setting': { kind: 'all' }, 'shop.line': { kind: 'all' }, 'shop.gone': { kind: 'all' } }
  assert.equal(rowRuleProblems({ tables, rowRules }).length, 2)
})
