import { useEffect, useId, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cx, menuClasses, menuItemClasses } from '@featherbase/shop-floor'

// #1235 item 9 (UI standard §5): a row's destructive actions wait behind a ⋯
// button, never as a button on every row. Each item asks its own confirm
// question; this menu only opens, chooses and closes.

export interface RowMenuItem {
  label: string
  onSelect: () => void
  tone?: 'negative'
  disabled?: boolean
}

export function RowMenu({ name, items, className }: { name: string; items: RowMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={box} className={cx('relative shrink-0', className)}>
      <button
        type="button"
        aria-label={`More actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="inline-flex size-control items-center justify-center rounded-control text-ink-muted hover:bg-subtle hover:text-ink"
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal aria-hidden size={18} />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={`Actions for ${name}`} className={menuClasses('absolute right-0 top-full z-30 mt-1')}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={menuItemClasses({ tone: item.tone === 'negative' ? 'negative' : undefined })}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
