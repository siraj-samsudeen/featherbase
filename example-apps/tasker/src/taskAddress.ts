import { useEffect, useState, type MouseEvent } from 'react'

// #1378: what is open in Tasker lives in its address, so a copied address
// reopens the same page, task and subtask. The page is the path; a task opened
// on it adds /tasks/<task>, a subtask /subtasks/<subtask> under its parent; a
// discussion question is ?question=. Other query keys (the shared bar's) are
// left as they are.

export type Page =
  | 'work' | 'inbox' | 'verify' | 'together' | 'stores' | 'personal'
  | 'projects' | 'views' | 'issues' | 'sla-rules'

export interface Address {
  page: Page
  /** The project on 'projects', the saved view on 'views', the issue on 'issues'. */
  item?: string
  task?: string
  subtask?: string
  question?: string
}

export const APP_ROOT = '/tasker/'

const PAGE_SEGMENTS: Partial<Record<Page, string>> = {
  inbox: 'inbox', verify: 'to-verify', together: 'together', stores: 'stores', personal: 'personal',
  projects: 'projects', views: 'views', issues: 'issues', 'sla-rules': 'sla-rules',
}
const PAGES_BY_SEGMENT = new Map(Object.entries(PAGE_SEGMENTS).map(([page, segment]) => [segment, page as Page]))
const WITH_ITEM = new Set<Page>(['projects', 'views', 'issues'])

export function parseAddress(pathname: string, search: string): Address {
  const path = pathname.startsWith(APP_ROOT) ? pathname.slice(APP_ROOT.length) : pathname.replace(/^\/+/, '')
  const segments = path.split('/').filter(Boolean).map((segment) => {
    try { return decodeURIComponent(segment) } catch { return segment }
  })
  const address: Address = { page: 'work' }
  let at = 0
  const page = PAGES_BY_SEGMENT.get(segments[0] ?? '')
  if (page) {
    address.page = page
    at = 1
    if (WITH_ITEM.has(page) && segments[1] && segments[1] !== 'tasks') { address.item = segments[1]; at = 2 }
  }
  if (segments[at] === 'tasks' && segments[at + 1]) {
    address.task = segments[at + 1]
    if (segments[at + 2] === 'subtasks' && segments[at + 3]) address.subtask = segments[at + 3]
  }
  const question = new URLSearchParams(search).get('question')
  if (question && address.task) address.question = question
  return address
}

/** The address as a path and query, keeping the query keys Tasker does not own. */
export function formatAddress(address: Address, search = location.search): string {
  const parts: string[] = []
  const segment = PAGE_SEGMENTS[address.page]
  if (segment) parts.push(segment)
  if (segment && address.item && WITH_ITEM.has(address.page)) parts.push(address.item)
  if (address.task) {
    parts.push('tasks', address.task)
    if (address.subtask) parts.push('subtasks', address.subtask)
  }
  const query = new URLSearchParams(search)
  query.delete('question')
  if (address.task && address.question) query.set('question', address.question)
  const rest = query.toString()
  return `${APP_ROOT}${parts.map(encodeURIComponent).join('/')}${rest ? `?${rest}` : ''}`
}

/** The page alone: what closing a task returns to. */
export function pageOf(address: Address): Address {
  return { page: address.page, ...(address.item ? { item: address.item } : {}) }
}

/** A task opened on the current page; a subtask under its parent. */
export function taskAddress(on: Address, task: { row_id: string; parent_task?: string | null }, question?: string): Address {
  const opened: Address = task.parent_task
    ? { ...pageOf(on), task: task.parent_task, subtask: task.row_id }
    : { ...pageOf(on), task: task.row_id }
  return question ? { ...opened, question } : opened
}

/** The task whose details show: the subtask when one is open. */
export function openTaskId(address: Address): string | null {
  return address.subtask ?? address.task ?? null
}

const ADDRESS_CHANGE = 'tasker:address'

export function currentAddress(): Address {
  return parseAddress(location.pathname, location.search)
}

/** Moves to an address: a new history entry, or with `replace` the current one rewritten. */
export function go(address: Address, { replace = false } = {}) {
  const target = formatAddress(address)
  if (target === `${location.pathname}${location.search}`) return
  window.history[replace ? 'replaceState' : 'pushState'](null, '', target)
  window.dispatchEvent(new Event(ADDRESS_CHANGE))
}

/** The current address, followed through Tasker's moves and the browser's Back and Forward. */
export function useAddress(): Address {
  const [address, setAddress] = useState(currentAddress)
  useEffect(() => {
    const follow = () => setAddress((previous) => {
      const next = currentAddress()
      return formatAddress(previous) === formatAddress(next) ? previous : next
    })
    window.addEventListener(ADDRESS_CHANGE, follow)
    window.addEventListener('popstate', follow)
    return () => {
      window.removeEventListener(ADDRESS_CHANGE, follow)
      window.removeEventListener('popstate', follow)
    }
  }, [])
  return address
}

/** A link's props: a real href to copy or open in a new tab, and a plain click moves in place. */
export function linkTo(address: Address) {
  return {
    href: formatAddress(address),
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      go(address)
    },
  }
}
