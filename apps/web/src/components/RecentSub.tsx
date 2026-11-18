import { Fragment } from 'react'
import { displayEntry, type RecentEntry } from '../lib/recents'
import { useMeta } from '../lib/meta'
import { FilterWords, type Filter } from './ListFilters'

/** A remembered list's filters and view, from its key: `list:<Table>[/<view>]?<filters JSON>`. */
export function listOf(entry: Pick<RecentEntry, 'key'>): { table: string; view?: string; filters: Filter[] } | null {
  const m = /^list:([^?]*)\?(.*)$/.exec(entry.key)
  if (!m) return null
  const [table, view] = m[1].split('/')
  let filters: Filter[] = []
  try {
    const parsed: unknown = m[2] ? JSON.parse(m[2]) : []
    if (Array.isArray(parsed)) filters = parsed.filter((f): f is Filter => Array.isArray(f) && f.length >= 3 && typeof f[0] === 'string' && typeof f[1] === 'string')
  } catch {
    // An old or hand-made key: its stored words stand.
    return null
  }
  return { table, view, filters }
}

/**
 * #1288: what sets a recent apart, read as its list's chips read: "Full Name contains a · Site: Head Office",
 * never the stored operator and wildcards ("Full Name like %a%"). Anything that is not a filtered list keeps its
 * own words.
 */
export function RecentSub({ entry }: { entry: RecentEntry }) {
  const list = listOf(entry)
  const meta = useMeta(list?.table ?? '', Boolean(list?.filters.length))
  // Until its Table's columns are known (or where they cannot be read), the words stored with the visit stand.
  if (!list?.filters.length || !meta.data) return <>{displayEntry(entry).sub}</>
  return (
    <>
      {list.view && <>{list.view} · </>}
      {list.filters.map((f, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          <FilterWords meta={meta.data} filter={f} />
        </Fragment>
      ))}
    </>
  )
}
