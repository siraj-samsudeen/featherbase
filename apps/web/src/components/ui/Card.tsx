import { useId, type HTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

export function cardClasses(className?: string): string {
  return cx('rounded-card border border-border bg-surface shadow-sm', className)
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
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
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
