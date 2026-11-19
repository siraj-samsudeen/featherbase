import { type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * #1349 item 2, #1289 item 11 (board 3): the shared peek card. A moment after the pointer rests on its trigger, or
 * when the trigger takes focus, a small raised card opens under it; it stays while the pointer is over either, and
 * leaving, or Escape, closes it. What it holds is the caller's: a count's first rows and the way to all of them.
 * The children render only while it is open, so what they read is read only then.
 */
export function PeekCard({ label, trigger, children, delay = 250 }: {
  /** The card's name for assistive technology: "Plants in Bayside". */
  label: string
  trigger: ReactNode
  children: ReactNode
  delay?: number
}) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const later = (next: boolean, wait: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), wait)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <span className="relative inline-flex" data-testid="peek-card-anchor"
      onPointerEnter={() => later(true, delay)} onPointerLeave={() => later(false, 120)}
      onFocus={() => later(true, delay)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) later(false, 0) }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        e.stopPropagation()
        later(false, 0)
      }}>
      {trigger}
      {open && (
        <div role="dialog" aria-label={label}
          className="absolute left-0 top-full z-30 mt-1.5 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2.5 rounded-xl bg-raised px-4 py-3.5 shadow-raised">
          {children}
        </div>
      )}
    </span>
  )
}
