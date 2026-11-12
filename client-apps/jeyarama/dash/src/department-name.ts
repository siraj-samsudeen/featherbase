// A department's name from its sections (#1205), shared by the load and the set-up form (#1209), so a
// pre-filled name and the one the form re-suggests are always the same.
const NAME_LIMIT = 40

/**
 * Sections in name order, joined with ", " and " & " (the owner, 11-Nov-2026). Past 40 characters, the
 * first two and how many more; the page lists them all.
 */
export function sectionsName(sections: string[]): string {
  const joined = sections.length < 2 ? sections.join('') : `${sections.slice(0, -1).join(', ')} & ${sections.at(-1)}`
  if (joined.length <= NAME_LIMIT || sections.length < 3) return joined
  const two = `${sections[0]}, ${sections[1]} & ${sections.length - 2} more`
  return two.length <= NAME_LIMIT ? two : `${sections[0]} & ${sections.length - 1} more`
}

/** The taken-out sections a name still mentions, whole words and any case, in name order. */
export function mentionsRemoved(name: string, removed: string[]): string[] {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return removed.filter(section => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(section)}($|[^\\p{L}\\p{N}])`, 'iu').test(name))
    .sort((a, b) => a.localeCompare(b))
}

/** "A", "A and B", "A, B and C". */
export function andList(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
