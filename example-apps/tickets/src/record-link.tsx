// #1230: everything that is a Featherbase record shows as a link to it, plain text only for a viewer
// who can't open it. Until the shared RecordLink lands, this asks the platform as the viewer.
import { useEffect, useState, type ReactNode } from 'react'
import { rowHref } from '../../../packages/shared/src/app-routes'

/** The ids of these rows the viewer may open: the platform's own list, read with their token. */
export async function openable(table: string, ids: string[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter(Boolean))]
  if (!wanted.length) return new Set()
  const token = localStorage.getItem('fc_token')
  const query = new URLSearchParams({ filters: JSON.stringify([['row_id', 'in', wanted]]), fields: JSON.stringify(['row_id']),
    limit_page_length: String(wanted.length) })
  try {
    const response = await fetch(`/api/table/${encodeURIComponent(table)}?${query}`, {
      credentials: 'same-origin', headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) return new Set()
    const { data } = (await response.json()) as { data: { row_id: string }[] }
    return new Set(data.map((row) => String(row.row_id)))
  } catch {
    return new Set()
  }
}

/** Which of these people the viewer may open; empty until the platform answers. */
export function useOpenablePeople(ids: (string | null | undefined)[]) {
  const key = [...new Set(ids.filter((id): id is string => !!id))].sort().join('\u0000')
  const [open, setOpen] = useState<Set<string>>(new Set())
  useEffect(() => {
    let live = true
    void openable('Person', key ? key.split('\u0000') : []).then((found) => { if (live) setOpen(found) })
    return () => { live = false }
  }, [key])
  return open
}

/** A record as a link to its page in Featherbase, or as plain text. */
export function RecordLink({ table, id, open, children, className, label }: {
  table: string; id: string | null | undefined; open: boolean; children: ReactNode; className?: string; label?: string
}) {
  if (!id || !open) return <span className={className}>{children}</span>
  return <a className={className} href={rowHref(table, id)} target="_blank" rel="noreferrer" aria-label={label}>{children}</a>
}
