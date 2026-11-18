import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * The top of a page (#1288), the same on every page: Quiet Canvas, so no border or rule; spacing alone sets it
 * apart from the content.
 *
 * - `breadcrumb`: optional, on its own small, muted line. Every record named in it is a link.
 * - `title`: in Title Case, one size everywhere.
 * - `count`: optional, beside the title, small and muted, worded by the page ("146 total", "5 can still sign
 *   in"). Small facts about the list (a layout switch, a column total, a source badge) sit with it.
 * - `actions`: optional, the page's own actions on the title's row at the right, with More last. At most one
 *   primary (blue) button, placed before More. When the window is narrow they wrap under the title, together.
 * - `status`: optional, at most one muted line under the title for the page's state (a job, a check time). It
 *   says a number only if the count does not already say it: say each number once.
 */
export function PageHeader({ breadcrumb, title, count, actions, status, className }: {
  breadcrumb?: ReactNode
  title: ReactNode
  count?: ReactNode
  actions?: ReactNode
  status?: ReactNode
  /** The page's own spacing below the header. */
  className?: string
}) {
  return (
    <header className={cx('flex flex-col gap-1', className)} data-testid="page-header">
      {breadcrumb && <div className="text-xs text-ink-subtle" data-testid="page-header-breadcrumb">{breadcrumb}</div>}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          {count && <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted" data-testid="page-header-count">{count}</div>}
        </div>
        {actions && <div className="ml-auto flex flex-wrap items-center justify-end gap-2" data-testid="page-header-actions">{actions}</div>}
      </div>
      {status && <div className="text-sm text-ink-muted" data-testid="page-header-status">{status}</div>}
    </header>
  )
}
