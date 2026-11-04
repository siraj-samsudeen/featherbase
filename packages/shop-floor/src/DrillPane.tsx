import type { ReactNode } from 'react'
import { iconButtonClasses } from './Button'
import { cx } from './cx'
import { X } from './icons'
import type { ResolvedPanePlace } from './PanePlace'

/**
 * The frame of the drill pane: the row's table (small, muted) above its name,
 * the pane's actions and a close button. Escape anywhere inside closes it.
 */
export function DrillPane({ kind, title, onClose, actions, children, place }: {
  kind: string
  title: string
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
  place: ResolvedPanePlace
}) {
  return (
    <aside aria-label={title} data-place={place} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
      className={cx('flex min-h-0 min-w-0 flex-col bg-surface focus:outline-none',
        place === 'right' ? 'h-full border-l border-border' : 'border-t border-border')}
    >
      <header className="flex shrink-0 items-start gap-3 px-4 pt-3 pb-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-ink-muted">{kind}</span>
          <h2 className="text-lg font-semibold text-ink wrap-anywhere">{title}</h2>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
        <button type="button" aria-label="Close" onClick={onClose} className={iconButtonClasses()}>
          <X aria-hidden size={18} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">{children}</div>
    </aside>
  )
}

/** A titled part of the pane: "Points at", "Pointed at by". */
export function PaneSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink-muted">{title}</h3>
      {children}
    </section>
  )
}
