import { useEffect, useRef, type ReactNode } from 'react'
import { iconButtonClasses } from './Button'
import { cx } from './cx'
import { X } from './icons'
import type { ResolvedPanePlace } from './PanePlace'

/**
 * The frame of the drill pane: the row's table (small, muted) above its name,
 * the pane's actions and a close button. It takes focus when it opens;
 * Escape anywhere inside closes it.
 */
export function DrillPane({ kind, title, onClose, actions, children, place }: {
  kind: string
  title: string
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
  place: ResolvedPanePlace
}) {
  // Opening (or drilling to) a row puts focus in the pane, so Escape closes it.
  const frame = useRef<HTMLElement>(null)
  useEffect(() => { frame.current?.focus({ preventScroll: true }) }, [])
  return (
    <aside ref={frame} aria-label={title} data-place={place} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
      className={cx('flex min-h-0 min-w-0 flex-col bg-raised shadow-raised focus:outline-none',
        place === 'right' && 'h-full')}
    >
      {/* The title has the width beside Close to itself, wrapping between
          words; the actions sit on their own line under it and wrap there. */}
      <header className="flex shrink-0 flex-col gap-2 px-4 pt-3 pb-2">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] text-ink-subtle">{kind}</span>
            <h2 className="text-xl font-semibold text-ink break-words">{title}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className={iconButtonClasses()}>
            <X aria-hidden size={18} />
          </button>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">{children}</div>
    </aside>
  )
}

/** A titled part of the pane: "Points at", "Pointed at by". */
export function PaneSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}
