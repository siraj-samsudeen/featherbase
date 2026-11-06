// #910: a list's filters live in the address's `path` parameter (one step of
// the walk), not in `?filters=`. These read them back from an address, so a
// spec can still check that a filter is in the URL and survives a reload.
import { decodePath } from '../src/lib/nav-path'

/** The filters of the step on screen in `url`, from `?path=` (or a hand-typed `?filters=`). */
export function urlFilters(url: string): unknown[] {
  const params = new URL(url).searchParams
  const path = decodePath(params.get('path') ?? undefined)
  if (path) return path.steps[path.at]?.filters ?? []
  const typed = params.get('filters')
  if (!typed) return []
  // The router writes search values as JSON, so the array may arrive as a
  // JSON string of itself.
  const parsed: unknown = JSON.parse(typed)
  return (typeof parsed === 'string' ? JSON.parse(parsed) : parsed) as unknown[]
}
