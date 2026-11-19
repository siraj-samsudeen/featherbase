import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { buttonClasses, ChevronDown, menuClasses } from '@featherbase/shop-floor'
import { menuAlign, visibleSpan, type MenuAlign } from './menuPlacement'

/** Ordinary links/buttons keep their native keyboard behavior inside the disclosure. */
export function ActionDisclosure({ label, ariaLabel, compact = false, children, open: controlledOpen, onOpenChange }: {
  label: string
  /** The button's name when its label is only a symbol (the sidebar rail's "+", #1248). */
  ariaLabel?: string
  /** No chevron: the button is a square (the sidebar rail, #1248). */
  compact?: boolean
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const button = useRef<HTMLButtonElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [align, setAlign] = useState<MenuAlign>('end')
  // #1242 (verifier, round 3): the menu is placed fixed under its button, so a
  // scrolling or clipping ancestor (the list's column) never cuts it off; a
  // long menu scrolls inside the window instead.
  const [place, setPlace] = useState<{ top: number; left?: number; right?: number; maxHeight: number }>()
  const id = useId()
  // #1185: measured before the browser paints, so the menu never shows on the clipped side first.
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      // Both are there while it is open: the listeners leave with the menu.
      const box = root.current!.getBoundingClientRect()
      const side = menuAlign(box, menu.current!.getBoundingClientRect().width, visibleSpan(root.current!))
      setAlign(side)
      const top = box.bottom + 4
      setPlace({ top, maxHeight: Math.max(160, window.innerHeight - top - 8), ...(side === 'end' ? { right: window.innerWidth - box.right } : { left: box.left }) })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])
  return (
    <div
      ref={root}
      className="relative"
      onBlur={(e) => {
        // A dialog opened from this menu renders inside it: closing the menu
        // would take the dialog and anything it has to say with it.
        if (e.currentTarget.querySelector('[role="dialog"]')) return
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        setOpen(false)
        button.current?.focus()
        e.stopPropagation()
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
        className={buttonClasses()}
      >
        {label}
        {!compact && <ChevronDown aria-hidden data-chevron size={18} />}
      </button>
      {open && (
        <div
          id={id}
          ref={menu}
          role="group"
          aria-label={ariaLabel ?? label}
          data-align={align}
          style={place ? { position: 'fixed', top: place.top, left: place.left, right: place.right, maxHeight: place.maxHeight } : undefined}
          className={menuClasses(`${place ? '' : `absolute ${align === 'end' ? 'right-0' : 'left-0'} mt-1 `}z-40 overflow-y-auto`)}
        >
          {children}
        </div>
      )}
    </div>
  )
}
