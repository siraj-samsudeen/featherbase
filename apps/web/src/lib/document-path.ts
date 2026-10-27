// #642 (E4): the server sets a page's frame policy on the document it serves,
// and a document keeps that policy through every in-app navigation. Moving
// between a page with a policy of its own (the Sales Target report frames
// MotherDuck, until B9) and any other page therefore takes a full load, in
// either direction: entering, so the report's frame is allowed; leaving, so
// the allowance does not follow the person (Codex round 1 on #643).
import { INTERIM_APPS } from 'shared'

/** The pages the server serves with a frame policy of their own. */
const OWN_POLICY_PAGES: readonly string[] = [INTERIM_APPS.feather_dash.root]

/** Where the browser loaded this document: its navigation entries. */
function navigationEntries(): readonly { name: string }[] {
  return typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('navigation') : []
}

const policyOf = (path: string) => (OWN_POLICY_PAGES.includes(path) ? path : null)

/** Would showing `path` in this document cross into or out of a page with its
 *  own frame policy? False when the browser does not say where the document
 *  was loaded (a test DOM). Never true for the page the document was loaded
 *  at, so the full load it asks for cannot ask again. */
export function crossesFramePolicy(path: string, entries: readonly { name: string }[] = navigationEntries()): boolean {
  const [entry] = entries
  return entry !== undefined && policyOf(new URL(entry.name).pathname) !== policyOf(path)
}
