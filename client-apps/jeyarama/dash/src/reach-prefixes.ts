// #1269: a store's subcategories as the shortest code prefixes the reader wholly holds, so a reach
// that covers whole lines of business stays a few hundred bytes (MotherDuck's embed API answered
// HTTP 413 to a division head's 25 plants × 695 codes). Subcategory codes are SAP's levels: 2 digits
// the line of business, 4 the main category, 6 the category, 9 the subcategory. A Dive matches a
// reach entry with `starts_with`, so a 9-digit code still matches only itself.
//
// Never widen: a prefix stands in for every code that starts with it, so it is sent only when the
// reader holds every known code under it, of any type (a Service or Consumable code under a line of
// business they hold the merchandise of keeps that line as codes).

/** The prefix lengths a code collapses to, shortest first. */
export const PREFIX_LENGTHS = [2, 4, 6] as const

/**
 * `held`'s codes as the shortest prefixes wholly held, given `every` code there is. A held code no
 * prefix covers goes as itself. Sorted, no duplicates.
 */
export function collapseCodes(held: Iterable<string>, every: readonly string[]): string[] {
  const holds = new Set(held)
  // Per prefix length, the prefixes some known code under them isn't held for.
  const partial = new Map<number, Set<string>>(PREFIX_LENGTHS.map(length => [length, new Set<string>()]))
  for (const code of every) {
    if (holds.has(code)) continue
    for (const length of PREFIX_LENGTHS) partial.get(length)!.add(code.slice(0, length))
  }
  const known = new Set(every)
  const sent = new Set<string>()
  for (const code of holds) {
    // Only a code the hierarchy knows collapses: an unknown one could be shorter than a prefix.
    const length = known.has(code) ? PREFIX_LENGTHS.find(at => code.length > at && !partial.get(at)!.has(code.slice(0, at))) : undefined
    sent.add(length === undefined ? code : code.slice(0, length))
  }
  return [...sent].sort()
}
