// Carrying answers to a new official Run (#1419; Siraj, 28-Nov-2026). When the warehouse publishes a new official Run
// for a month that already has one, what people answered on the earlier Run still counts, unless Feather Forecast
// for that subcategory moved by more than 10%: then the answer is asked for again ("Feather Forecast moved: answer
// again"). Decided when the review is read, so nothing is copied or rewritten when a Run loads.

/** Feather Forecast moving by more than this, in %, asks for the answer again. */
export const MOVED_PCT = 10

/** One answer as stored: on which Run, for which month, and against which Feather Forecast. */
export interface StoredAnswer<T> { run: string; month: string | null; subcategory: string; engine: number | null; updatedAt: string; answer: T }

/** Each subcategory's answer for `run`: its own, else the newest one given on an earlier Run of the same month,
 *  carried while Feather Forecast moved by 10% or less; a bigger move lists it under `moved` instead. */
export function carryAnswers<T>(stored: StoredAnswer<T>[], run: string, month: string, forecast: Record<string, number>) {
  const answers: Record<string, T> = {}, moved: Record<string, { from: number; to: number }> = {}
  const newest = [...stored].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  for (const sub of new Set(stored.map(s => s.subcategory))) {
    const own = newest.find(s => s.subcategory === sub && s.run === run)
    if (own) { answers[sub] = own.answer; continue }
    const earlier = newest.find(s => s.subcategory === sub && s.month?.slice(0, 7) === month.slice(0, 7))
    if (!earlier || forecast[sub] == null) continue
    const from = earlier.engine ?? 0, to = forecast[sub]
    // compared without dividing, so exactly 10% stays 10% (110 / 100 − 1 is a hair over 0.1 in floating point)
    if (from && Math.abs(to - from) * 100 <= MOVED_PCT * Math.abs(from)) answers[sub] = earlier.answer
    else moved[sub] = { from, to }
  }
  return { answers, moved }
}
