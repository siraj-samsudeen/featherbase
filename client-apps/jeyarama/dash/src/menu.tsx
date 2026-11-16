// #1225: a small menu (`⋯`, `+ New ▾`, `View ▾`) per the UI standard: a button that opens a list
// of actions or choices, closed by Escape, a click outside, or choosing. Shop Floor has none yet.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check } from '@featherbase/shop-floor'

export type MenuItem =
  | { label: ReactNode; onSelect: () => void; tone?: 'negative'; checked?: boolean; disabled?: boolean; testid?: string }
  | { heading: string }

export function Menu({ label, trigger, items, className, triggerClassName, testid }: {
  /** What the button is for, said to a screen reader. */
  label: string; trigger: ReactNode; items: MenuItem[]; className?: string; triggerClassName?: string; testid?: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return (
    <div ref={box} className={`relative inline-flex ${className ?? ''}`}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} data-testid={testid}
        className={triggerClassName ?? 'inline-flex min-h-control items-center gap-1 rounded-control border border-border-control bg-surface px-3 text-control font-medium text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus'}>
        {trigger}
      </button>
      {open && (
        <ul id={id} role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-52 rounded-control border border-border bg-surface py-1 shadow-lg" data-testid={testid ? `${testid}-items` : undefined}>
          {items.map((item, n) => 'heading' in item
            ? <li key={n} role="presentation" className="px-3 pb-1 pt-2 text-[13px] font-medium text-ink-muted">{item.heading}</li>
            : (
              <li key={n} role="presentation">
                <button type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={item.checked} disabled={item.disabled}
                  onClick={() => { setOpen(false); item.onSelect() }} data-testid={item.testid}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-start text-control hover:bg-subtle disabled:opacity-50 ${item.tone === 'negative' ? 'text-negative' : 'text-ink'}`}>
                  {item.checked !== undefined && <span className="inline-flex w-4">{item.checked && <Check aria-hidden size={16} />}</span>}
                  {item.label}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
