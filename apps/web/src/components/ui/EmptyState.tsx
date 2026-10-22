import type { ReactNode } from 'react'
import { cx } from './cx'
import { Inbox, type LucideIcon } from './icons'

/** What is empty, why, and the way forward — never a blank space. */
export function EmptyState({
  title,
  icon: Icon = Inbox,
  action,
  className,
  children,
}: {
  title: ReactNode
  icon?: LucideIcon
  action?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cx('flex flex-col items-center gap-2 px-4 py-10 text-center', className)}>
      <Icon aria-hidden size={28} className="text-ink-subtle" />
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children && <p className="max-w-sm text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
