import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { buttonClasses, cardClasses, ChevronDown } from '@featherbase/shop-floor'
import { menuAlign, visibleSpan, type MenuAlign } from './menuPlacement'

/** Ordinary links/buttons keep their native keyboard behavior inside the disclosure. */
export function ActionDisclosure({ label, children, open: controlledOpen, onOpenChange }: {
  label: string
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
  const id = useId()
  // #1185: measured before the browser paints, so the menu never shows on the clipped side first.
  useLayoutEffect(() => {
    if (!open) return
    setAlign(menuAlign(root.current!.getBoundingClientRect(), menu.current!.getBoundingClientRect().width, visibleSpan(root.current!)))
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
        className={buttonClasses()}
      >
        {label}
        <ChevronDown aria-hidden data-chevron size={18} />
      </button>
      {open && (
        <div
          id={id}
          ref={menu}
          role="group"
          aria-label={label}
          data-align={align}
          className={cardClasses(`absolute ${align === 'end' ? 'right-0' : 'left-0'} z-20 mt-1 flex w-full flex-col items-stretch gap-1 p-2 sm:w-64`)}
        >
          {children}
        </div>
      )}
    </div>
  )
}
