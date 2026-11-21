// The app's address: the page first, then what the page is showing, all in the hash, so a
// view can be linked to and the back button undoes a choice.
import { useEffect, useState } from 'react'

export interface Route { page: string; id: string; params: URLSearchParams }

export function readRoute(hash = location.hash): Route {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const [first] = [...params.entries()]
  const [page, id] = first ?? ['pl', '']
  params.delete(page)
  return { page, id, params }
}

/** The address of a page: `to('version', 'BV-001', { store: '9003' })`. */
export function to(page: string, id = '', params: Record<string, string | null | undefined> = {}): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  const rest = query.toString()
  return `#${page}${id ? `=${encodeURIComponent(id)}` : ''}${rest ? `&${rest}` : ''}`
}

export function useRoute(): Route & { set(changes: Record<string, string | null>): void } {
  const [route, setRoute] = useState(() => readRoute())
  useEffect(() => {
    const change = () => setRoute(readRoute())
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  return { ...route, set(changes) {
    const next = Object.fromEntries(route.params.entries())
    location.hash = to(route.page, route.id, { ...next, ...changes })
  } }
}
