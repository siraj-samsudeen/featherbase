// #642 (E4): the server sets a page's frame policy on the document it serves,
// and a document keeps that policy through every in-app navigation. A page
// with a policy of its own (the Sales Target report frames MotherDuck, until
// B9) must therefore be entered by a full load.

/** Where the browser loaded this document: its navigation entries. */
function navigationEntries(): readonly { name: string }[] {
  return typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('navigation') : []
}

/** Was this document loaded at a page other than `path`? False when the
 *  browser does not say (a test DOM). */
export function loadedElsewhere(path: string, entries: readonly { name: string }[] = navigationEntries()): boolean {
  const [entry] = entries
  return entry !== undefined && new URL(entry.name).pathname !== path
}
