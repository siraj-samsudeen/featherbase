import { useId, useRef, type ReactNode } from 'react'
import { cx } from './cx'

/** Content sections, not phone navigation. Hidden panels retain drafts and local search. */
export function ContentTabs({ label, tabs, value, onChange, className }: {
  label: string
  tabs: { id: string; label: string; content: ReactNode }[]
  value: string
  onChange: (id: string) => void
  className?: string
}) {
  const id = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div className={cx('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      <div role="tablist" aria-label={label} className="flex shrink-0 gap-4 overflow-x-auto border-b border-border">
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
            className={cx('min-h-control shrink-0 border-b-2 px-1 py-2 text-control font-semibold focus-visible:outline-2 focus-visible:outline-focus',
              value === tab.id ? 'border-action text-action' : 'border-transparent text-ink-muted hover:text-ink')}
          >{tab.label}</button>
        ))}
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
