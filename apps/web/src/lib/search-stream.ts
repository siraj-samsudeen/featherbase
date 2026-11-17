import { useEffect, useState } from 'react'
import { send } from './api'
import { pageLoad } from './page-load'

// #1265: Search or Command shows its work. /api/search answers one JSON line
// at a time: the groups it will search, then each group as its Table answers,
// then done (or an error line). This hook reads those lines as they come, and
// a newer query aborts the older request, so a stale answer never lands.

export interface SearchHit {
  table: string
  row_id: string
  title: string
  kind_label?: string
}

export interface SearchGroup {
  table: string
  label: string
  /** undefined while its Table has not answered. */
  hits?: SearchHit[]
}

export interface StreamedSearch {
  /** The query these groups answer. */
  query: string
  groups: SearchGroup[]
  done: boolean
  failed: boolean
}

const EMPTY: StreamedSearch = { query: '', groups: [], done: true, failed: false }

/** Splits a growing text into its complete lines, keeping the unfinished tail. */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  return { lines: parts.slice(0, -1).filter(Boolean), rest: parts.at(-1) ?? '' }
}

/** Applies one streamed line to the search so far. */
export function applyLine(search: StreamedSearch, line: Record<string, unknown>): StreamedSearch {
  if (Array.isArray(line.groups))
    return { ...search, groups: (line.groups as { table: string; label: string }[]).map((g) => ({ table: g.table, label: g.label })) }
  if (typeof line.table === 'string' && Array.isArray(line.hits)) {
    const hits = line.hits as SearchHit[]
    return { ...search, groups: search.groups.map((g) => (g.table === line.table ? { ...g, hits } : g)) }
  }
  if (line.done === true) return { ...search, done: true }
  if (typeof line.error === 'string') return { ...search, done: true, failed: true }
  return search
}

export function useStreamedSearch(query: string): StreamedSearch {
  const [search, setSearch] = useState<StreamedSearch>(EMPTY)
  useEffect(() => {
    if (!query) {
      setSearch(EMPTY)
      return
    }
    const abort = new AbortController()
    let current: StreamedSearch = { query, groups: [], done: false, failed: false }
    setSearch(current)
    const update = (next: StreamedSearch) => {
      current = next
      if (!abort.signal.aborted) setSearch(next)
    }
    void (async () => {
      try {
        const res = await send(`/api/search?q=${encodeURIComponent(query)}`, { signal: abort.signal })
        if (!res.ok || !res.body) {
          // #1222: View as ended while it searched: reload, as every other read does.
          if (res.status === 409) {
            const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
            if (body.error?.message?.startsWith('View as has ended')) return pageLoad.reload()
          }
          return update({ ...current, done: true, failed: true })
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          const { lines, rest } = takeLines(buffer + decoder.decode(value, { stream: true }))
          buffer = rest
          let next = current
          for (const line of lines) next = applyLine(next, JSON.parse(line) as Record<string, unknown>)
          update(next)
        }
        // A stream cut short of its done line is a failed search, not an empty one.
        if (!current.done) update({ ...current, done: true, failed: true })
      } catch {
        if (!abort.signal.aborted) update({ ...current, done: true, failed: true })
      }
    })()
    return () => abort.abort()
  }, [query])
  return search
}
