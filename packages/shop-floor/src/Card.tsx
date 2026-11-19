import { useId, type HTMLAttributes, type ReactNode } from 'react'
import { recipe } from './cx'

/** #1348: a group inside a page is a quiet-fill block, told apart by its fill, never a line or a shadow. */
export function cardClasses(className?: string): string {
  return recipe('rounded-card bg-subtle', className)
}

/** #1348: a page's one white panel on the canvas, radius 14, lifted by a faint shadow. */
export function panelClasses(className?: string): string {
  return recipe('rounded-card bg-surface shadow-panel', className)
}

/** #1348: a surface that floats over the page (a menu, a popover, the pane, a hover card): shadow, no border. */
export function raisedClasses(className?: string): string {
  return recipe('rounded-card bg-surface shadow-raised', className)
}

/** A surface for related content. A titled card is a named region. */
export function Card({
  title,
  actions,
  className,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, 'title'> & { title?: ReactNode; actions?: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={title ? id : undefined} className={cardClasses(className)} {...rest}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3">
          <h2 id={id} className="text-base font-semibold text-ink">
            {title}
          </h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}
