import { useEffect, useRef, useState } from 'react'
import { buttonClasses, cardClasses, touchRowClasses } from './ui'
import { ChevronDown } from './ui/icons'

/** #820: a button that opens a list of a Choice column's choices to tick. The
 *  quick filter box and Add filter both use it. */
export function ChoiceTicks({
  label,
  choices,
  ticked,
  onChange,
  buttonText,
  testId,
  listTestId,
  className,
}: {
  /** The column's name, for the button's and the list's accessible names. */
  label: string
  choices: string[]
  ticked: string[]
  onChange: (ticked: string[]) => void
  buttonText: string
  testId: string
  listTestId: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // Closes on a click outside it, or on Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle(choice: string, on: boolean) {
    const next = new Set(ticked)
    if (on) next.add(choice)
    else next.delete(choice)
    onChange(choices.filter((c) => next.has(c)))
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`${label}: ${buttonText}`}
        data-testid={testId}
        className={buttonClasses({ className: `w-full justify-between font-normal ${className ?? ''}` })}
      >
        <span className="truncate">{buttonText}</span>
        <ChevronDown aria-hidden size={16} className={open ? 'rotate-180' : undefined} />
      </button>
      {open && (
        <div
          role="group"
          aria-label={`${label} choices`}
          data-testid={listTestId}
          className={cardClasses('absolute left-0 z-10 mt-1 max-h-72 w-56 max-w-[calc(100vw-2rem)] overflow-y-auto p-2')}
        >
          {choices.map((c) => (
            <label key={c} className={touchRowClasses('flex items-center gap-2 rounded px-2 py-1 text-sm text-ink')}>
              <input type="checkbox" checked={ticked.includes(c)} onChange={(e) => toggle(c, e.target.checked)} />
              {c}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
