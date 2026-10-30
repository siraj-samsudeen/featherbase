import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, countTasks, isFinished } from './check-unarchived-changes.mjs'

test('ticked and unticked tasks are counted, in any indentation and either x case', () => {
  const text = '# Tasks\n\n- [x] 1.1 one\n  - [X] 1.2 two\n- [ ] 1.3 three\nnot a task\n- [y] nor this'
  assert.deepEqual(countTasks(text), { total: 3, done: 2 })
})

test('a change with every task ticked is finished', () => {
  assert.equal(isFinished(countTasks('- [x] a\n- [x] b')), true)
})

test('a change with any task open is not finished', () => {
  assert.equal(isFinished(countTasks('- [x] a\n- [ ] b')), false)
})

test('a change with no tasks yet is not finished', () => {
  assert.equal(isFinished(countTasks('# Tasks\n\nto be planned')), false)
})

test('a change finished only on this branch is reported, not failed', () => {
  const here = [{ name: 'a' }, { name: 'b' }]
  const { stale, fresh } = classify(here, new Set())
  assert.deepEqual(stale, [])
  assert.deepEqual(fresh.map((c) => c.name), ['a', 'b'])
})

test('a change already finished on the base fails: its archive was forgotten', () => {
  const { stale, fresh } = classify([{ name: 'a' }, { name: 'b' }], new Set(['b']))
  assert.deepEqual(stale.map((c) => c.name), ['b'])
  assert.deepEqual(fresh.map((c) => c.name), ['a'])
})

test('with no base to compare (on main) nothing fails', () => {
  const { stale, fresh } = classify([{ name: 'a' }], null)
  assert.deepEqual(stale, [])
  assert.deepEqual(fresh.map((c) => c.name), ['a'])
})
