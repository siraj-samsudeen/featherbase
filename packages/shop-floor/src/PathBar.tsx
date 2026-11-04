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
 * sideways inside the bar, never the page.
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
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface px-4 py-2">
      <Button onClick={onBack} disabled={current <= 0}>Back</Button>
      <Button onClick={onForward} disabled={current >= steps.length - 1}>Forward</Button>
      <nav aria-label="Path" className="min-w-0 flex-1 overflow-x-auto">
        <ol className="flex w-max items-center gap-1 text-sm">
          {steps.map((step, index) => (
            <li key={step.key} className="flex shrink-0 items-center gap-1">
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
