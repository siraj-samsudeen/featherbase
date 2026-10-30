import { useEffect, useRef } from 'react'
import { cx } from './cx'
import type { LucideIcon } from './icons'

export interface TabBarItem {
  label: string
  icon: LucideIcon
  href: string
  current?: boolean
}

/**
 * The tabs a person moves between on a phone (#380 task 4.4): fixed to the
 * bottom of the screen, within reach of a thumb. Each tab is an icon over a
 * one-line label, 48px tall (--spacing-touch); the open one is marked by a bar above it and a
 * bolder label as well as by colour, and named the current page. Phone only:
 * from `sm` up the screen has room for its own navigation, so the bar is never
 * drawn there. While it is drawn the page keeps room for it at the bottom
 * (index.css), so it never covers the last row. Over an installed app's own
 * page the bar lives in a shadow root and never styles the app's page (#650),
 * so its height is published on the document's root as
 * `--featherbase-tab-bar-height` (0 on a wider screen) for the app to keep
 * that room itself.
 */
const TAB_BAR_HEIGHT_VARIABLE = '--featherbase-tab-bar-height'

export function TabBar({
  label,
  tabs,
  testId = 'tab-bar',
  preview = false,
}: {
  label: string
  tabs: TabBarItem[]
  testId?: string
  /** The gallery's specimen: drawn in place, at any width, instead of fixed to a phone's screen. */
  preview?: boolean
}) {
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = nav.current
    if (preview || !el || typeof ResizeObserver !== 'function') return
    const root = document.documentElement.style
    const observer = new ResizeObserver(() => root.setProperty(TAB_BAR_HEIGHT_VARIABLE, `${Math.round(el.getBoundingClientRect().height)}px`))
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.removeProperty(TAB_BAR_HEIGHT_VARIABLE)
    }
  }, [preview])
  return (
    <nav
      ref={nav}
      aria-label={label}
      data-tab-bar={preview ? undefined : ''}
      data-testid={testId}
      className={cx(
        'border-t border-border bg-surface',
        !preview && 'fixed inset-x-0 bottom-0 z-20 pb-[env(safe-area-inset-bottom)] sm:hidden',
      )}
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map(({ label: name, icon: Icon, href, current }) => (
          <li key={href} className="min-w-0">
            <a
              href={href}
              aria-current={current ? 'page' : undefined}
              data-testid="tab-bar-tab"
              className={cx(
                'flex min-h-touch flex-col items-center justify-center gap-0.5 border-t-2 px-1 text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                current ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-ink-muted hover:text-ink',
              )}
            >
              <Icon aria-hidden size={20} className="shrink-0" />
              <span className="max-w-full truncate">{name}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
