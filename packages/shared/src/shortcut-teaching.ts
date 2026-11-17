// #1251: when Featherbase teaches or reminds a person of a keyboard shortcut.
// Pure: every rule takes the time it is asked at, so the web and its tests
// share one set of rules. The web keeps the learning in the person's own
// settings record (SHORTCUT_SETTINGS), so it follows them to any device.

/** How one person does one shortcut's job. */
export interface ShortcutUse {
  /** Times they used the key. */
  keys: number
  /** Mouse uses since they last used the key (since ever, if they never have). */
  mouse: number
  /** Tips shown since they last used the key; each doubles the next wait. */
  shown: number
  /** When they last used the key (ms since 1970), 0 for never. */
  lastKey: number
}

/** Everything one person's shortcut teaching remembers. */
export interface ShortcutLearning {
  use: Record<string, ShortcutUse>
  /** Tips stay quiet until then (ms since 1970); 0 when they are on. */
  quietUntil: number
  /** How many times tips were quieted: picks the next, longer, quiet. */
  quiets: number
  /** When the last tip showed: at most one a day. */
  lastTip: number
}

/** A tip or reminder to show now. */
export interface TipDue {
  id: string
  /** They used the key before and went back to the mouse. */
  reminder: boolean
  /** Mouse uses since they last used the key. */
  mouseUses: number
}

export type ShortcutStatus = { kind: 'not-tried' } | { kind: 'in-use'; keys: number } | { kind: 'slipping'; mouse: number }

export const DAY_MS = 24 * 60 * 60 * 1000
/** Mouse uses in a row before the first tip. */
export const FIRST_TIP_AT = 3
/** Mouse uses since the key that mark a known shortcut as slipping. */
const SLIPPING_AT = 2
/** Each quieting lasts longer; the last step repeats. Never forever. */
export const QUIET_STEPS = [
  { days: 7, label: 'A Week' },
  { days: 30, label: 'A Month' },
  { days: 90, label: '3 Months' },
] as const

export const EMPTY_LEARNING: ShortcutLearning = Object.freeze({ use: {}, quietUntil: 0, quiets: 0, lastTip: 0 }) as ShortcutLearning
const NO_USE: ShortcutUse = { keys: 0, mouse: 0, shown: 0, lastKey: 0 }

/** Mouse uses that bring the next tip after `shown` ignored ones: 3, 9, 21, …
 *  (a wait of 3, then 6 more, then 12 more). */
function tipAt(shown: number): number {
  return FIRST_TIP_AT * (2 ** (shown + 1) - 1)
}

export function isQuiet(learning: ShortcutLearning, now: number): boolean {
  return now < learning.quietUntil
}

/**
 * Notes one use of a shortcut's job, by its key or by the mouse, and says
 * whether a tip is due. A key use starts the count again. A tip waits for:
 * tips not quieted, no tip yet today, and for a reminder, a day since the key.
 */
export function noteShortcutUse(
  learning: ShortcutLearning,
  id: string,
  via: 'key' | 'mouse',
  now: number,
): { learning: ShortcutLearning; tip: TipDue | null } {
  const before = learning.use[id] ?? NO_USE
  if (via === 'key') {
    const use = { keys: before.keys + 1, mouse: 0, shown: 0, lastKey: now }
    return { learning: { ...learning, use: { ...learning.use, [id]: use } }, tip: null }
  }
  const use = { ...before, mouse: before.mouse + 1 }
  const reminder = use.keys > 0
  const due =
    use.mouse >= tipAt(use.shown) &&
    !isQuiet(learning, now) &&
    now - learning.lastTip >= DAY_MS &&
    (!reminder || now - use.lastKey >= DAY_MS)
  if (!due) return { learning: { ...learning, use: { ...learning.use, [id]: use } }, tip: null }
  return {
    learning: { ...learning, lastTip: now, use: { ...learning.use, [id]: { ...use, shown: use.shown + 1 } } },
    tip: { id, reminder, mouseUses: use.mouse },
  }
}

export function shortcutStatus(use: ShortcutUse | undefined): ShortcutStatus {
  if (!use || use.keys === 0) return { kind: 'not-tried' }
  if (use.mouse >= SLIPPING_AT) return { kind: 'slipping', mouse: use.mouse }
  return { kind: 'in-use', keys: use.keys }
}

/** The quiet the next "quiet tips" gives. */
export function nextQuietStep(learning: ShortcutLearning): { days: number; label: string } {
  const step = QUIET_STEPS[Math.min(learning.quiets, QUIET_STEPS.length - 1)]
  return { days: step.days, label: step.label }
}

export function quietTips(learning: ShortcutLearning, now: number): ShortcutLearning {
  return { ...learning, quietUntil: now + nextQuietStep(learning).days * DAY_MS, quiets: learning.quiets + 1 }
}

/** Ends a quiet now; the next quiet still lasts longer. */
export function turnTipsOn(learning: ShortcutLearning): ShortcutLearning {
  return { ...learning, quietUntil: 0 }
}

const count = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0)

/** The stored record as learning; anything malformed counts as never used. */
export function readLearning(raw: unknown): ShortcutLearning {
  if (!raw || typeof raw !== 'object') return EMPTY_LEARNING
  const record = raw as Record<string, unknown>
  const use: Record<string, ShortcutUse> = {}
  if (record.use && typeof record.use === 'object') {
    for (const [id, value] of Object.entries(record.use as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const u = value as Record<string, unknown>
      use[id] = { keys: count(u.keys), mouse: count(u.mouse), shown: count(u.shown), lastKey: count(u.lastKey) }
    }
  }
  return { use, quietUntil: count(record.quietUntil), quiets: count(record.quiets), lastTip: count(record.lastTip) }
}
