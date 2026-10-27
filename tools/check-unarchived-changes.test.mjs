import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countTasks, isFinished } from './check-unarchived-changes.mjs'

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
