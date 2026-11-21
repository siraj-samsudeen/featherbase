import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx, type LucideIcon, raisedClasses } from '@featherbase/shop-floor'
import { railMark, railMenuPlace } from '../lib/sidebar-rail'

// #1248: the Admin sidebar's icon rail. Whether the sidebar is collapsed (md+)
// reaches each group here, and each draws its own rail form: icons in 40px
// squares, headings as rules, a long list of one kind folded into one icon.

export const SidebarRailContext = createContext(false)
/** Whether the sidebar shows as the rail now. */
export const useSidebarRail = () => useContext(SidebarRailContext)

/** A rail row: a 40px square, its icon centred, a badge on its corner. */
export const RAIL_ROW = 'relative mx-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-md'
/** A row's colours, open or in the rail (#1253, Quiet Canvas): the open page is
 *  a white tile with a soft shadow on the grey canvas; a hover is a soft fill. */
export const ROW_IDLE = 'text-ink hover:bg-border/50'
export const ROW_SELECTED = 'font-medium text-ink bg-surface shadow-sm'
/** A group's title (#1253): small, grey, regular weight, Title Case. */
export const SIDEBAR_HEADING = 'px-2 pb-1 pt-1 text-xs text-ink-muted'

/** The owner's review (17-Nov-2026): each sidebar group's icons in its own hue,
 *  so groups read apart at a glance (theme tokens --color-group-*). */
export const GROUP_TONE = {
  blue: 'text-group-blue', teal: 'text-group-teal', rose: 'text-group-rose', amber: 'text-group-amber',
  violet: 'text-group-violet', green: 'text-group-green', indigo: 'text-group-indigo', slate: 'text-group-slate',
} as const
export type GroupTone = keyof typeof GROUP_TONE

/** The hues a table's tile is drawn in, in the order its name's hash picks them. */
const TILE_TONES: GroupTone[] = ['blue', 'teal', 'rose', 'amber', 'violet', 'green', 'indigo']

/** #1253 (Siraj's style A, 17-Nov): a table's own colour, like an avatar's:
 *  a stable hash of its name, so Role always looks the same and Department
 *  always looks different from it. */
export function tableTone(name: string): GroupTone {
  const hash = [...name].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7)
  return TILE_TONES[hash % TILE_TONES.length]
}

/** A 22px tile with a table's initials, tinted in its own colour. */
export function TableTile({ name }: { name: string }) {
  return (
    <span aria-hidden data-testid="table-tile" className={cx('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-current/15 text-xs font-bold leading-none', GROUP_TONE[tableTone(name)])}>
      {railMark(name)}
    </span>
  )
}

/** A group's heading in the rail: a gap, no line (#1253, minimal lines); the heading kept for screen readers. */
export function RailRule({ heading }: { heading: string }) {
  return (
    <>
      <h2 className="sr-only">{heading}</h2>
      <div aria-hidden className="h-4" data-testid="sidebar-rail-rule" />
    </>
  )
}

/** A long list of one kind (Recently opened, Saved views, Data sources), one
 *  icon in the rail: its menu lists them, beside the rail, never clipped. */
export function RailFold({ label, icon: Icon, testid, tone = 'slate', children }: {
  label: string
  icon: LucideIcon
  testid?: string
  /** The group's hue for its icon. */
  tone?: GroupTone
  /** The menu's items, given a way to close the menu. */
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ left: number; top: number }>()
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
  // #1385: in an app's sidebar the fold is in a shadow root, which holds the platform's styles: the menu is
  // drawn there, and events and focus are read through it (an event's target outside it is the host).
  const root = () => button.current?.getRootNode()
  const layer = () => { const at = root(); return at instanceof ShadowRoot ? at : document.body }
  const focused = () => { const at = root(); return at instanceof ShadowRoot ? at.activeElement : document.activeElement }

  useLayoutEffect(() => {
    if (!open || !button.current) return
    setPlace(railMenuPlace(button.current, menu.current?.getBoundingClientRect().height ?? 0))
    items()[0]?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      const path = event.composedPath()
      if (!path.includes(menu.current!) && !path.includes(button.current!)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])

  const close = () => setOpen(false)
  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const all = items()
    const at = all.indexOf(focused() as HTMLElement)
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setOpen(false)
      button.current?.focus()
    } else if (event.key === 'ArrowDown') { event.preventDefault(); all[(at + 1) % all.length]?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); all[(at - 1 + all.length) % all.length]?.focus() }
    else if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div className="px-2 py-1" data-testid={testid}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); setOpen(true) } }}
        className={cx(RAIL_ROW, open ? 'bg-border/50 text-ink' : ROW_IDLE, 'focus-visible:outline-2 focus-visible:outline-focus')}
      >
        <Icon aria-hidden size={18} className={GROUP_TONE[tone]} />
      </button>
      {open && createPortal(
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={{ position: 'fixed', left: place?.left ?? -9999, top: place?.top ?? 0 }}
          className={raisedClasses('z-[61] flex max-h-[calc(100vh-16px)] min-w-56 flex-col gap-px overflow-y-auto p-1.5')}
          data-testid="sidebar-rail-menu"
        >
          <div aria-hidden className="px-2 py-1 text-xs text-ink-subtle">{label}</div>
          {children(close)}
        </div>,
        layer(),
      )}
    </div>
  )
}

/** One item in a rail menu: it closes the menu, then does its job. */
export function RailMenuItem({ onSelect, close, current = false, children }: {
  onSelect: () => void
  close: () => void
  current?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-current={current ? 'page' : undefined}
      onClick={() => { close(); onSelect() }}
      className={cx(
        'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none',
        current ? 'font-medium text-action' : 'text-ink',
      )}
    >
      {children}
    </button>
  )
}
