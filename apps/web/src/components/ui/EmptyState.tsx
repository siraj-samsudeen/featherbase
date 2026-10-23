import type { ReactNode } from 'react'
import { cx } from './cx'
import { Inbox, type LucideIcon } from './icons'

/**
 * What an empty screen says: a title plus an explanation, a way forward, or
 * both. A title alone does not type-check, because the usable-on-any-device
 * promise is that an empty screen always offers the way forward.
 */
export type EmptyDescriptor = { title: ReactNode } & (
  | { body: ReactNode; action?: ReactNode }
  | { action: ReactNode; body?: ReactNode }
)

/** What is empty, why, and the way forward — never a blank space. */
export function EmptyState({
  icon: Icon = Inbox,
  className,
  ...empty
}: EmptyDescriptor & { icon?: LucideIcon; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center gap-2 px-4 py-10 text-center', className)}>
      <Icon aria-hidden size={28} className="text-ink-subtle" />
      <h3 className="text-base font-semibold text-ink">{empty.title}</h3>
      {empty.body && <p className="max-w-sm text-sm text-ink-muted">{empty.body}</p>}
      {empty.action && <div className="mt-2">{empty.action}</div>}
    </div>
  )
}
