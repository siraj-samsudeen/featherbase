// The import's type-to-confirm prompt shows the row count Indian-grouped, so
// either form of the same number confirms it (#380).
import { expect, test } from 'vitest'
import { confirmsCount } from '../src/pages/ImportWizard'

test('the shown, grouped count confirms', () => expect(confirmsCount('1,23,456', 123456)).toBe(true))
test('the bare count confirms, with stray spaces', () => expect(confirmsCount(' 123456 ', 123456)).toBe(true))
test('a different number does not', () => expect(confirmsCount('1,23,455', 123456)).toBe(false))
test('an empty box does not', () => expect(confirmsCount('', 3)).toBe(false))
