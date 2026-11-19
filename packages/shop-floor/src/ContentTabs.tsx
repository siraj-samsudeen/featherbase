import { useId, useRef, type ReactNode } from 'react'
import { cx } from './cx'

/** Content sections, not phone navigation. Hidden panels retain drafts and local search. */
export function ContentTabs({ label, tabs, value, onChange, className, actions }: {
  label: string
  tabs: { id: string; label: string; content: ReactNode }[]
  value: string
  onChange: (id: string) => void
  className?: string
  /** #1267: controls at the tab row's right end (a record's "✓ Saved" and View menu). Not tabs. */
  actions?: ReactNode
}) {
  const id = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div className={cx('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-3">
      {/* #1348 board 3: the tabs are a quiet track, the chosen one a blue tint; no underline rule. */}
      <div role="tablist" aria-label={label} className="flex min-w-0 gap-1 overflow-x-auto rounded-[10px] bg-subtle p-1">
        {tabs.map((tab, index) => (
          <button key={tab.id} ref={(el) => { buttons.current[index] = el }} type="button" role="tab"
            id={`${id}-tab-${tab.id}`} aria-controls={`${id}-panel-${tab.id}`} aria-selected={value === tab.id}
            tabIndex={value === tab.id ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                : event.key === 'ArrowRight' ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : null
              if (next === null) return
              event.preventDefault()
              onChange(tabs[next].id)
              buttons.current[next]?.focus()
            }}
            className={cx('min-h-[34px] shrink-0 rounded-lg px-3.5 text-control focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:min-h-control',
              value === tab.id ? 'bg-action-tint font-medium text-action' : 'text-ink-subtle hover:text-ink')}
          >{tab.label}</button>
        ))}
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2" data-testid="content-tabs-actions">{actions}</div>}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} id={`${id}-panel-${tab.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab.id}`}
          hidden={value !== tab.id} tabIndex={0}
          className="min-h-0 min-w-0 flex-1 overflow-auto pt-4 focus-visible:outline-2 focus-visible:outline-focus"
        >{tab.content}</div>
      ))}
    </div>
  )
}
