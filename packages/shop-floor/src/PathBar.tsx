import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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

/** The steps on show, from `from` to `to`; the rest sit behind "…". */
interface Shown { from: number; to: number; short?: string }

/** The words of `text` that fit in `room`, then "…" (at least the first word). */
function fitWords(text: string, room: number, width: (t: string) => number): string {
  const words = text.split(' ')
  for (let n = words.length - 1; n > 1; n--) {
    const short = `${words.slice(0, n).join(' ')}…`
    if (width(short) <= room) return short
  }
  return `${words[0]}…`
}

const stepText = (step: PathStep) => (step.kindLabel ? `${step.kindLabel} ${step.label}` : step.label)

/** A "…" button whose menu lists steps out of sight; choosing one goes to it. */
function HiddenSteps({ label, items, onStep }: {
  label: 'Earlier steps' | 'Later steps'
  items: { step: PathStep; index: number }[]
  onStep: (index: number) => void
}) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <div className="relative shrink-0"
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false) } }}>
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-control items-center rounded-control px-2 text-sm text-ink-muted hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus"
      >…</button>
      {open && (
        <div role="menu" aria-label={label}
          className={cx('absolute z-20 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col rounded-card border border-border bg-surface py-1 shadow-lg',
            label === 'Later steps' ? 'right-0' : 'left-0')}>
          {items.map(({ step, index }) => (
            <button key={step.key} type="button" role="menuitem" onClick={() => { setOpen(false); onStep(index) }}
              className="min-h-control px-3 py-1.5 text-left text-sm text-ink break-words hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus"
            >{stepText(step)}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The path the user has walked: Back and Forward (disabled at the ends), every
 * step as a button (the current one aria-current="step"), Copy link with an
 * inline "Copied", and a slot for the Recent paths menu. Steps show whole or
 * not at all: those that do not fit around the current one sit behind a "…"
 * menu on their own side (earlier steps before, later steps after); a single step wider than the whole bar is shortened at a word, its
 * full name kept as its name and title. On a bar narrower than a wide window
 * the path has a line of its own under the buttons.
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
  const [shown, setShown] = useState<Shown>({ from: 0, to: steps.length - 1 })
  const room = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const labels = steps.map(stepText).join('\u0000')
  // Which whole steps fit: the current one, then as many before it, then after it.
  useLayoutEffect(() => {
    const fit = () => {
      const box = room.current
      const ruler = measure.current
      if (!box || !ruler || !steps.length) return
      const width = (el: Element | null) => el?.getBoundingClientRect().width ?? 0
      const space = width(box)
      const each = steps.map((_, i) => width(ruler.querySelector(`[data-measure-step="${i}"]`)))
      const more = width(ruler.querySelector('[data-measure-more]'))
      const at = Math.min(Math.max(current, 0), steps.length - 1)
      let [from, to] = [at, at]
      const total = (f: number, t: number) => each.slice(f, t + 1).reduce((a, b) => a + b, 0) + (f > 0 ? more : 0) + (t < steps.length - 1 ? more : 0)
      while (from > 0 && total(from - 1, to) <= space) from--
      while (to < steps.length - 1 && total(from, to + 1) <= space) to++
      let short: string | undefined
      if (total(at, at) > space) {
        const text = ruler.querySelector<HTMLElement>('[data-measure-text]')!
        const textWidth = (t: string) => { text.textContent = t; return width(text) }
        short = fitWords(steps[at].label, space - (at > 0 ? more : 0) - (at < steps.length - 1 ? more : 0) - 40, textWidth)
      }
      setShown((was) => (was.from === from && was.to === to && was.short === short ? was : { from, to, short }))
    }
    fit()
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    if (room.current) watch?.observe(room.current)
    return () => watch?.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, labels])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  const from = Math.min(shown.from, steps.length - 1)
  const to = Math.min(shown.to, steps.length - 1)
  const indexed = steps.map((step, index) => ({ step, index }))
  const stepButton = (step: PathStep, index: number, short?: string) => (
    <button type="button" onClick={() => onStep(index)} aria-current={index === current ? 'step' : undefined}
      aria-label={short ? stepText(step) : undefined} title={short ? stepText(step) : undefined}
      className={cx('inline-flex min-h-control items-center gap-1 whitespace-nowrap rounded-control px-2 focus-visible:outline-2 focus-visible:outline-focus',
        'text-ink hover:bg-subtle aria-[current=step]:bg-action-tint aria-[current=step]:font-semibold aria-[current=step]:text-action')}
    >
      {step.kindLabel && <><span className="text-xs text-ink-muted">{step.kindLabel}</span>{' '}</>}
      {short ?? step.label}
    </button>
  )
  return (
    <div className="@container flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
      <Button onClick={onBack} disabled={current <= 0}>Back</Button>
      <Button onClick={onForward} disabled={current >= steps.length - 1}>Forward</Button>
      <div ref={room} data-path-room className="relative flex min-w-0 flex-1 items-center gap-1 @max-5xl:order-last @max-5xl:basis-full">
        {/* Every step at full width, out of sight, to measure what fits. */}
        <div ref={measure} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex w-max items-center gap-1 text-sm">
          <span data-measure-more className="inline-flex px-2">…</span>
          {steps.map((step, index) => (
            <span key={step.key} data-measure-step={index} className="inline-flex shrink-0 items-center gap-1 pl-1">
              {index > 0 && <ChevronRight aria-hidden size={14} />}
              <span className="inline-flex items-center gap-1 whitespace-nowrap px-2 font-semibold">
                {step.kindLabel && <span className="text-xs">{step.kindLabel}</span>}{step.label}
              </span>
            </span>
          ))}
          <span data-measure-text className="whitespace-nowrap px-2 font-semibold" />
        </div>
        <nav aria-label="Path" className="flex min-w-0 flex-1 items-center gap-1">
          <HiddenSteps label="Earlier steps" items={indexed.filter(({ index }) => index < from)} onStep={onStep} />
          <ol className="flex min-w-0 items-center gap-1 text-sm">
            {steps.map((step, index) => index < from || index > to ? null : (
              <li key={step.key} className="flex min-w-0 shrink-0 items-center gap-1">
                {index > from && <ChevronRight aria-hidden size={14} className="text-ink-subtle" />}
                {stepButton(step, index, index === current ? shown.short : undefined)}
              </li>
            ))}
          </ol>
          <HiddenSteps label="Later steps" items={indexed.filter(({ index }) => index > to)} onStep={onStep} />
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
