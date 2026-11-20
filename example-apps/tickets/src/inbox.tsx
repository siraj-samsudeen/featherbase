// #1379: the pieces that make Tickets read like a shared inbox (Front's layout):
// a person's initials in a circle, a short "how long ago", and the keys that move
// through the list without the mouse.
import { useEffect } from 'react'
import { person, time } from './ticket-words'

/** Up to two initials from a name: "Bala Murugan" → "BM", "Support" → "S". */
export const initials = (name: string) =>
  name === '—'
    ? '?'
    : name
        .split(/\s+/)
        .filter((word) => /\p{L}|\d/u.test(word[0] ?? ''))
        .slice(0, 2)
        .map((word) => word[0]!.toUpperCase())
        .join('') || '?'

// Four tints, picked by the person's id so one person keeps one colour on every line.
const hue = (id: string) => [...id].reduce((sum, c) => (sum + c.charCodeAt(0)) % 4, 0)

/** A person's initials in a circle, beside their line or message. The name is read
 *  beside it, so the circle itself is hidden from screen readers. */
export function Avatar({ id, size = 'md' }: { id: unknown; size?: 'sm' | 'md' }) {
  const key = typeof id === 'string' ? id : ''
  return (
    <span className={`avatar avatar-${size} avatar-hue-${hue(key)}`} aria-hidden="true">
      {initials(person(key))}
    </span>
  )
}

/** "now", "5m", "4h", "3d", then the date: how long since the ticket last moved. */
export function ago(value: unknown, now = Date.now()): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return ''
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d`
  return time(value).split(',')[0]!.slice(0, 6)
}

/** The list's keys: j/↓ next, k/↑ previous, / search, c new ticket. None fire while
 *  someone types in a field, holds a modifier, or has a dialog open. */
export function useInboxKeys({ ids, selected, open, search, create }: {
  ids: string[]
  selected: string
  open: (id: string) => void
  search: () => void
  create: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog[open], [role=menu]')) return
      if (document.querySelector('dialog[open]')) return
      // The arrows move through the list only from the list (or nothing focused), so they still scroll a ticket.
      const arrows = !target || target === document.body || Boolean(target.closest('.ticket-list'))
      const step = event.key === 'j' || (arrows && event.key === 'ArrowDown') ? 1 : event.key === 'k' || (arrows && event.key === 'ArrowUp') ? -1 : 0
      if (step) {
        if (!ids.length) return
        event.preventDefault()
        const at = ids.indexOf(selected)
        const next = ids[at < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, at + step))]!
        if (next !== selected) open(next)
        return
      }
      if (event.key === '/') {
        event.preventDefault()
        search()
      } else if (event.key === 'c') {
        event.preventDefault()
        create()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [ids.join(' '), selected, open, search, create])
}
