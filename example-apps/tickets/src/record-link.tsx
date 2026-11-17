// #1230: everything that is a Featherbase record shows as a link to it (the shared RecordLink, #1234),
// plain text only for a viewer who can't open it. Whether they can is asked of the platform, as them.
import { useEffect, useState } from 'react'

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
