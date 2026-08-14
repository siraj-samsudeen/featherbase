// List editing, List mode (owner-ratified 2026-08-14, prototype variant A):
// clicking a row opens the row's ordinary FormView in a slide-over drawer —
// read and edit without losing your place in the list. One generic FormView
// serves every Table (invariant #3); this is a window onto it, not a fork.
import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { FormView } from './FormView'

export function PeekDrawer({
  doctype,
  name,
  onClose,
}: {
  doctype: string
  name: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden="true" />
      <aside
        data-testid="peek-drawer"
        role="dialog"
        aria-label={`${doctype} ${name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-[620px] max-w-[92vw] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
          <span className="truncate text-sm font-medium text-[var(--color-ink-muted)]">
            {doctype} · {name}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Link
              to="/admin/$doctype/$name"
              params={{ doctype, name }}
              search={{ prefill: undefined }}
              className="fc-btn text-xs"
              data-testid="peek-full-page"
            >
              Open full page ↗
            </Link>
            <button onClick={onClose} aria-label="Close" className="fc-btn text-xs" data-testid="peek-close">
              ✕
            </button>
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <FormView key={name} doctype={doctype} name={name} />
        </div>
      </aside>
    </>
  )
}
