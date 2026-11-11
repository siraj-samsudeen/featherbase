// The scenario binder's own rules (#1184): a Then, and an And or But that
// continues one, must assert something, so a bound test can't claim an
// outcome it never checks.
import { expect, test } from 'vitest'
import { isThenStep } from './scenario'

const steps = (...keywords: string[]) => keywords.map((keyword, i) => ({ keyword, text: `step ${i + 1}` }))

test('a Then, and every And or But that continues it, is an outcome to assert', () => {
  const s = steps('Given', 'And', 'When', 'Then', 'And', 'But')
  expect(s.map((_, i) => isThenStep(s, i))).toEqual([false, false, false, true, true, true])
})

test('an And after a second When is an action again, not an outcome', () => {
  const s = steps('Given', 'When', 'Then', 'When', 'And', 'Then')
  expect(s.map((_, i) => isThenStep(s, i))).toEqual([false, false, true, false, false, true])
})
