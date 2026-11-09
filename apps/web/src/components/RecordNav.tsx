import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { buttonClasses, fmtCount } from '@featherbase/shop-floor'
import { listResource } from '../lib/api'
import { useNavigation } from '../lib/navigation'

// Previous / next record on the form: steps through the list the record was
// opened from, with that list's filters, sort and pages. The list leaves its
// place in this tab's sessionStorage; a record opened any other way (a link,
// a new tab, search) has no list behind it and shows no buttons.

export interface ListPlace {
  filters: unknown[]
  orderBy?: string
  withRetired?: boolean
  /** Position in the whole list of ids[0]. */
  start: number
  ids: string[]
}

const key = (table: string) => `featherbase.listPlace.${table}`

export function rememberListPlace(table: string, place: ListPlace): void {
  try {
    sessionStorage.setItem(key(table), JSON.stringify(place))
  } catch {
    // Storage unavailable: the form simply shows no record nav.
  }
}

function readListPlace(table: string): ListPlace | null {
  try {
    const raw = sessionStorage.getItem(key(table))
    return raw ? (JSON.parse(raw) as ListPlace) : null
  } catch {
    return null
  }
}

// Unsaved changes are the form's to guard: its leave question asks before a
// step to another record, as before any other page.
export function RecordNav({ table, name }: { table: string; name: string }) {
  const navigate = useNavigate()
  const nav = useNavigation()
  // Read once per record shown; a step below rewrites it for the next one.
  const place = useMemo(() => readListPlace(table), [table, name])
  const hint = place ? place.ids.indexOf(name) : -1
  const at = place && hint >= 0 ? place.start + hint : -1

  // The record and its two neighbours, asked of the server in the list's own
  // order, so a change since the list was loaded shows here too.
  const near = useQuery({
    queryKey: ['record-nav', table, name, place?.filters, place?.orderBy, place?.withRetired, at],
    enabled: at >= 0,
    queryFn: async () => {
      const from = Math.max(0, at - 1)
      const result = await listResource(table, {
        filters: place!.filters,
        order_by: place!.orderBy,
        with_retired: place!.withRetired,
        fields: ['row_id'],
        limit_start: from,
        limit_page_length: 3,
      })
      return { from, ids: result.data.map((r) => String(r.row_id)), total: result.total }
    },
  })

  const index = near.data ? near.data.ids.indexOf(name) : -1
  useEffect(() => {
    if (!near.data || index < 0 || !place) return
    rememberListPlace(table, { ...place, start: near.data.from, ids: near.data.ids })
  }, [near.data, index, place, table])

  // Not opened from a list, or the record has moved in it since.
  if (!near.data || index < 0) return null
  const position = near.data.from + index
  const prev = near.data.ids[index - 1]
  const next = near.data.ids[index + 1]

  const go = (id: string) => {
    if (nav?.addressed) nav.replace({ screen: 'row', table, row: id })
    else void navigate({ to: '/featherbase/admin/table/$table/row/$name', params: { table, name: id }, search: { prefill: undefined } })
  }

  return (
    <span className="flex items-center gap-1" data-testid="record-nav">
      <button type="button" aria-label="Previous record" title="Previous record" disabled={!prev}
        onClick={() => go(prev!)} className={buttonClasses({ className: 'disabled:opacity-40' })}>
        ‹
      </button>
      <span className="whitespace-nowrap px-1 text-xs text-ink-muted tabular-nums" data-testid="record-position">
        {fmtCount(position + 1)} of {fmtCount(near.data.total)}
      </span>
      <button type="button" aria-label="Next record" title="Next record" disabled={!next}
        onClick={() => go(next!)} className={buttonClasses({ className: 'disabled:opacity-40' })}>
        ›
      </button>
    </span>
  )
}
