import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { cx } from './cx'
import { ChevronDown, ChevronRight } from './icons'

export interface PathStep {
  key: string
  /** What kind of step this is, shown small before the label: "List", "Filter". */
  kindLabel?: string
  label: string
}

const COPIED_MS = 2000

/**
 * The path the user has walked: Back and Forward (disabled at the ends), every
 * step as a button (the current one aria-current="step"), Copy link with an
 * inline "Copied", and a slot for the Recent paths menu. A long path scrolls
 * sideways inside the bar, never the page, by whole steps; a "…" before it
 * says earlier steps are out of sight and brings them back.
 */
export function PathBar({ steps, current, onStep, onBack, onForward, onCopyLink, recent }: {
  steps: PathStep[]
  current: number
  onStep: (index: number) => void
  onBack: () => void
  onForward: () => void
  onCopyLink: () => void
  recent?: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const [earlier, setEarlier] = useState(false)
  const nav = useRef<HTMLElement>(null)
  // Whether any step starts left of the bar's edge, i.e. is out of sight.
  const notice = (left: number) => {
    const bar = nav.current
    if (!bar) return
    const outer = bar.getBoundingClientRect()
    const offsets = [...bar.querySelectorAll('li')].map((li) => li.getBoundingClientRect().left - outer.left + bar.scrollLeft)
    setEarlier(offsets.some((offset) => offset < left - 0.5))
  }
  // A long path scrolls inside the bar; keep the current step in sight
  // by scrolling the bar alone (scrollIntoView would also move the page),
  // by whole steps, so no step is ever cut through a word.
  useEffect(() => {
    const bar = nav.current
    const step = bar?.querySelector('[aria-current="step"]')
    if (!bar || !step) return
    const [outer, inner] = [bar.getBoundingClientRect(), step.getBoundingClientRect()]
    const shift = inner.right > outer.right ? inner.right - outer.right : inner.left < outer.left ? inner.left - outer.left : 0
    let left = bar.scrollLeft + shift
    if (shift > 0) {
      const starts = [...bar.querySelectorAll('li')].map((li) => li.getBoundingClientRect().left - outer.left + bar.scrollLeft)
      left = starts.find((start) => start >= left) ?? left
    }
    if (shift) bar.scrollTo?.({ left })
    notice(left)
  }, [current, steps.length, earlier])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    // On a narrow bar the path takes a line of its own under the buttons,
    // so the current step always has room.
    <div className="@container flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
      <Button onClick={onBack} disabled={current <= 0}>Back</Button>
      <Button onClick={onForward} disabled={current >= steps.length - 1}>Forward</Button>
      <div className="flex min-w-0 flex-1 items-center gap-1 @max-2xl:order-last @max-2xl:basis-full">
        {earlier && (
          <button type="button" aria-label="Earlier steps" title="Earlier steps"
            onClick={() => { nav.current?.scrollTo?.({ left: 0 }); setEarlier(false) }}
            className="inline-flex min-h-control shrink-0 items-center rounded-control px-2 text-sm text-ink-muted hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus"
          >…</button>
        )}
        <nav ref={nav} aria-label="Path" onScroll={(event) => notice(event.currentTarget.scrollLeft)}
          // A sliver of a step left over at the edge (the bar cannot scroll
          // any further) fades out rather than showing a cut word.
          className={cx('min-w-0 flex-1 snap-x overflow-x-auto', earlier && '[mask-image:linear-gradient(to_right,transparent,black_2rem)]')}>
          <ol className="flex w-max items-center gap-1 text-sm">
            {steps.map((step, index) => (
              <li key={step.key} className="flex shrink-0 snap-start items-center gap-1">
                {index > 0 && <ChevronRight aria-hidden size={14} className="text-ink-subtle" />}
                <button type="button" onClick={() => onStep(index)} aria-current={index === current ? 'step' : undefined}
                  className={cx('inline-flex min-h-control items-center gap-1 whitespace-nowrap rounded-control px-2 focus-visible:outline-2 focus-visible:outline-focus',
                    'text-ink hover:bg-subtle aria-[current=step]:bg-action-tint aria-[current=step]:font-semibold aria-[current=step]:text-action')}
                >
                  {step.kindLabel && <><span className="text-xs text-ink-muted">{step.kindLabel}</span>{' '}</>}
                  {step.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </div>
      {recent}
      <Button onClick={() => { onCopyLink(); setCopied(true) }}>Copy link</Button>
      <span role="status" className="min-w-0 shrink-0 text-sm text-positive">{copied ? 'Copied' : ''}</span>
    </div>
  )
}

const RECENT_LIMIT = 10

/** "Recent paths": a menu of up to ten earlier paths; picking one reports its key. */
export function RecentPaths({ paths, onPick }: {
  paths: { key: string; label: string }[]
  onPick: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const shown = paths.slice(0, RECENT_LIMIT)
  return (
    <div ref={root} className="relative shrink-0"
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false) } }}>
      <Button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        Recent paths <ChevronDown aria-hidden data-chevron size={16} />
      </Button>
      {open && (
        <div role="menu" aria-label="Recent paths"
          className="absolute right-0 z-20 mt-1 flex w-80 max-w-[calc(100vw-2rem)] flex-col rounded-card border border-border bg-surface py-1 shadow-lg">
          {shown.length === 0 && <p className="px-3 py-2 text-sm text-ink-muted">No recent paths yet</p>}
          {shown.map((path) => (
            <button key={path.key} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(path.key) }}
              className="min-h-control px-3 py-1.5 text-left text-sm text-ink wrap-anywhere hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus"
            >{path.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
