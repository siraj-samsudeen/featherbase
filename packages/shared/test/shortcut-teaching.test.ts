// #1251: the rules that decide when Featherbase teaches or reminds a person of a
// keyboard shortcut, and how long tips stay quiet. Pure: time is passed in.
import { describe, expect, test } from 'vitest'
import {
  DAY_MS,
  EMPTY_LEARNING,
  isQuiet,
  nextQuietStep,
  noteShortcutUse,
  quietTips,
  readLearning,
  shortcutStatus,
  turnTipsOn,
  type ShortcutLearning,
} from '../src/shortcut-teaching'

const T0 = Date.UTC(2026, 10, 17, 6, 0)

/** Uses one shortcut `times` times the same way, returning the last result. */
function use(learning: ShortcutLearning, id: string, via: 'key' | 'mouse', times: number, now: number) {
  let result = { learning, tip: null as ReturnType<typeof noteShortcutUse>['tip'] }
  for (let i = 0; i < times; i++) result = noteShortcutUse(result.learning, id, via, now)
  return result
}

describe('a first tip', () => {
  test('comes on the third mouse use in a row, not before', () => {
    const two = use(EMPTY_LEARNING, 'sidebar', 'mouse', 2, T0)
    expect(two.tip).toBeNull()
    const third = noteShortcutUse(two.learning, 'sidebar', 'mouse', T0)
    expect(third.tip).toEqual({ id: 'sidebar', reminder: false, mouseUses: 3 })
  })

  test('each ignored tip doubles the wait: 3, then 6 more, then 12 more', () => {
    let l = use(EMPTY_LEARNING, 'sidebar', 'mouse', 3, T0).learning
    // A day later, so the one-tip-a-day rule is not what holds the next tip back.
    const day1 = T0 + DAY_MS
    const five = use(l, 'sidebar', 'mouse', 5, day1)
    expect(five.tip).toBeNull()
    const sixth = noteShortcutUse(five.learning, 'sidebar', 'mouse', day1)
    expect(sixth.tip).toEqual({ id: 'sidebar', reminder: false, mouseUses: 9 })
    l = sixth.learning
    const day2 = day1 + DAY_MS
    expect(use(l, 'sidebar', 'mouse', 11, day2).tip).toBeNull()
    expect(use(l, 'sidebar', 'mouse', 12, day2).tip).toEqual({ id: 'sidebar', reminder: false, mouseUses: 21 })
  })
})

describe('a reminder', () => {
  test('comes when someone who used the key goes back to the mouse three times, a day later', () => {
    const keyed = use(EMPTY_LEARNING, 'sidebar', 'key', 1, T0).learning
    const later = T0 + 2 * DAY_MS
    expect(use(keyed, 'sidebar', 'mouse', 2, later).tip).toBeNull()
    expect(use(keyed, 'sidebar', 'mouse', 3, later).tip).toEqual({ id: 'sidebar', reminder: true, mouseUses: 3 })
  })

  test('waits until a day after the last key use, then counts every mouse use since', () => {
    const keyed = use(EMPTY_LEARNING, 'sidebar', 'key', 1, T0).learning
    const soon = use(keyed, 'sidebar', 'mouse', 3, T0 + 60 * 60 * 1000)
    expect(soon.tip).toBeNull()
    const next = noteShortcutUse(soon.learning, 'sidebar', 'mouse', T0 + DAY_MS)
    expect(next.tip).toEqual({ id: 'sidebar', reminder: true, mouseUses: 4 })
  })

  test('using the key starts the count again', () => {
    const tipped = use(EMPTY_LEARNING, 'sidebar', 'mouse', 3, T0).learning
    const keyed = noteShortcutUse(tipped, 'sidebar', 'key', T0).learning
    expect(keyed.use.sidebar).toMatchObject({ keys: 1, mouse: 0, shown: 0 })
    // The wait is back to 3, not doubled.
    expect(use(keyed, 'sidebar', 'mouse', 3, T0 + 2 * DAY_MS).tip).toMatchObject({ reminder: true, mouseUses: 3 })
  })
})

test('at most one tip a day, across all shortcuts', () => {
  const first = use(EMPTY_LEARNING, 'sidebar', 'mouse', 3, T0)
  expect(first.tip?.id).toBe('sidebar')
  const other = use(first.learning, 'command', 'mouse', 3, T0 + 60_000)
  expect(other.tip).toBeNull()
  expect(noteShortcutUse(other.learning, 'command', 'mouse', T0 + DAY_MS).tip).toEqual({ id: 'command', reminder: false, mouseUses: 4 })
})

describe('quieting tips', () => {
  test('lasts a week, then a month, then three months each time after', () => {
    expect(nextQuietStep(EMPTY_LEARNING)).toEqual({ days: 7, label: 'A Week' })
    let l = quietTips(EMPTY_LEARNING, T0)
    expect(l.quietUntil).toBe(T0 + 7 * DAY_MS)
    expect(nextQuietStep(l)).toEqual({ days: 30, label: 'A Month' })
    l = quietTips(l, T0)
    expect(l.quietUntil).toBe(T0 + 30 * DAY_MS)
    l = quietTips(l, T0)
    expect(l.quietUntil).toBe(T0 + 90 * DAY_MS)
    expect(quietTips(l, T0).quietUntil).toBe(T0 + 90 * DAY_MS)
  })

  test('holds every tip back until the time is up, then tips come back on their own', () => {
    const quiet = quietTips(EMPTY_LEARNING, T0)
    expect(isQuiet(quiet, T0 + 6 * DAY_MS)).toBe(true)
    expect(use(quiet, 'sidebar', 'mouse', 10, T0 + DAY_MS).tip).toBeNull()
    expect(isQuiet(quiet, T0 + 7 * DAY_MS)).toBe(false)
    expect(use(quiet, 'sidebar', 'mouse', 3, T0 + 7 * DAY_MS).tip).not.toBeNull()
  })

  test('turning tips on ends the quiet now and keeps the ladder', () => {
    const on = turnTipsOn(quietTips(EMPTY_LEARNING, T0))
    expect(isQuiet(on, T0)).toBe(false)
    expect(nextQuietStep(on)).toEqual({ days: 30, label: 'A Month' })
  })
})

test('a status per shortcut: not tried, in use, or slipping back to the mouse', () => {
  expect(shortcutStatus(undefined)).toEqual({ kind: 'not-tried' })
  expect(shortcutStatus(use(EMPTY_LEARNING, 's', 'mouse', 5, T0).learning.use.s)).toEqual({ kind: 'not-tried' })
  const keyed = use(EMPTY_LEARNING, 's', 'key', 3, T0).learning
  expect(shortcutStatus(keyed.use.s)).toEqual({ kind: 'in-use', keys: 3 })
  expect(shortcutStatus(use(keyed, 's', 'mouse', 1, T0).learning.use.s)).toEqual({ kind: 'in-use', keys: 3 })
  expect(shortcutStatus(use(keyed, 's', 'mouse', 2, T0).learning.use.s)).toEqual({ kind: 'slipping', mouse: 2 })
})

test('stored learning is read back safely, whatever the record holds', () => {
  expect(readLearning(null)).toEqual(EMPTY_LEARNING)
  expect(readLearning('junk')).toEqual(EMPTY_LEARNING)
  expect(readLearning({ use: 'every shortcut', quiets: 1 })).toEqual({ ...EMPTY_LEARNING, quiets: 1 })
  expect(readLearning({ use: { s: { keys: 2, mouse: 'x', shown: -1 }, bad: 5 }, quietUntil: 'soon', quiets: 2 })).toEqual({
    ...EMPTY_LEARNING,
    use: { s: { keys: 2, mouse: 0, shown: 0, lastKey: 0 } },
    quiets: 2,
  })
})
