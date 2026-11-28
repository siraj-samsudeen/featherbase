// Dropdowns that pick one, several or all, for the Charts page. Shop Floor has a single-choice Select but no
// multi-select, so this is built from its own parts, as the platform builds its menus: a trigger that looks
// like its Select, its menu surface and rows, lifted above the page with useTopLayer. No other dependency.
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Check, ChevronDown, Field, MENU_HEADING_CLASSES, TextInput, cx, inputClasses, menuClasses, menuItemClasses, useTopLayer } from '@featherbase/shop-floor'
import { parseDate, showDate } from './months'

/** A labelled trigger showing what is chosen; its panel opens below it, and closes on Escape or a click away. */
export function Dropdown({ label, summary, testId, className, children }: { label: string; summary: string; testId: string; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  useTopLayer(open, panel, trigger, 'below-start')
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      const target = event.target as Node
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape) }
  }, [open])
  return (
    <div className={cx('relative', className)}>
      <Field label={label}>
        <button ref={trigger} type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} data-testid={testId}
          className={inputClasses('relative flex items-center pr-9 text-left')}>
          <span className="truncate">{summary}</span>
          <ChevronDown aria-hidden size={16} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-subtle" />
        </button>
      </Field>
      {open && <div ref={panel} role="group" aria-label={label} className={menuClasses('absolute z-30 mt-1 max-h-[26rem] overflow-y-auto')} data-testid={`${testId}-panel`}>{children}</div>}
    </div>
  )
}

/** A row with a checkbox; `mixed` shows a part-chosen set (some stores of all). */
export function CheckRow({ checked, mixed = false, onChange, children, testId }: { checked: boolean; mixed?: boolean; onChange: (e: ChangeEvent<HTMLInputElement>) => void; children: ReactNode; testId?: string }) {
  return (
    <label className={menuItemClasses({ className: 'cursor-pointer' })} data-testid={testId}>
      <input type="checkbox" className="size-4 shrink-0 accent-[var(--color-action)]" checked={checked} onChange={onChange} ref={el => { if (el) el.indeterminate = mixed }} />
      <span>{children}</span>
    </label>
  )
}

/** A row that is one choice of several, ticked when chosen. */
export function ChoiceRow({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} onClick={onClick} className={menuItemClasses({ className: on ? 'font-semibold' : '' })} data-testid={testId}>
      <span className="flex w-4 shrink-0 justify-center text-action" aria-hidden="true">{on && <Check size={14} />}</span>{children}
    </button>
  )
}

export const Heading = ({ children }: { children: ReactNode }) => <div className={MENU_HEADING_CLASSES}>{children}</div>

/** A date typed as DD-Mon-YYYY (never a slash form), kept as YYYY-MM-DD; empty clears it. */
export function DateInput({ value, onChange, testId, ...rest }: { value: string; onChange: (iso: string) => void; testId?: string; id?: string; 'aria-describedby'?: string }) {
  const [text, setText] = useState(value ? showDate(value) : '')
  const bad = text.trim() !== '' && !parseDate(text)
  return <TextInput {...rest} value={text} placeholder="DD-Mon-YYYY" aria-invalid={bad || undefined} data-testid={testId}
    onChange={e => { setText(e.target.value); const iso = parseDate(e.target.value); if (iso || !e.target.value.trim()) onChange(iso ?? '') }} />
}
