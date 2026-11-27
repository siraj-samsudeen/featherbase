import type { MouseEvent } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { fmtDayIST } from 'shared'
import { fmtDate } from '@featherbase/shop-floor'
import { useCapabilities } from '../lib/session'
import { DATASETS_PATH, useStandIns } from '../lib/stand-in-mark'
import { useGoTo } from './go-to'

// #1409 (design D6): the line that says a page's figures are sample data. The
// platform draws it, under the top bar, on any page that received stand-in
// rows (lib/stand-in-mark.ts remembers which): the Admin shell and the shared
// bar over an app's own page both render this, so no app draws it or can
// forget it. It goes when the same data is read again and is no longer a
// stand-in. Looks like the health banner: a tinted line, no box.

/** The line for the page at `pathname`; nothing when that page received no stand-in rows. */
export function StandInLine({ pathname }: { pathname: string }) {
  const standIns = useStandIns(pathname)
  // A System Manager can act on a stand-in, so the dataset opens the Datasets page.
  const canManage = useCapabilities()?.manage === true
  const go = useGoTo()
  if (!standIns.length) return null
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    // A modified click (new tab, new window) stays the browser's.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    go(DATASETS_PATH)
  }
  return (
    <div
      data-testid="stand-in-line"
      role="status"
      className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-0 bg-caution-tint px-3 py-1 text-sm font-medium text-caution"
    >
      {standIns.map((standIn) => (
        <span key={`${standIn.app}.${standIn.dataset}`} data-testid="stand-in" data-dataset={standIn.dataset}>
          Sample data:{' '}
          {canManage
            ? <a href={DATASETS_PATH} onClick={open} className="rounded-control underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus">{standIn.dataset}</a>
            : standIn.dataset}
          {' '}is a stand-in, loaded {fmtDayIST(standIn.loaded_at)}.
          {standIn.expected_by && ` Real data expected by ${fmtDate(standIn.expected_by)}.`}
          {standIn.note && ` ${standIn.note}`}
        </span>
      ))}
    </div>
  )
}

/** The line in the Admin. Its router moves the document's address, so each
 *  move draws the line again for the page now open; the page is named by the
 *  document's own address, as it was when its answers were remembered. */
export function AdminStandInLine() {
  useRouterState({ select: (state) => state.location.href })
  return <StandInLine pathname={window.location.pathname} />
}
