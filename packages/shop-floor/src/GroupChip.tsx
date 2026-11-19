import { cx } from './cx'
import { fmtCount } from './format'

/** One group of related rows with its count ("Shelf 3"); pressed while chosen. A group with no rows stays listed, quieter. */
// #1348 board 3: a count chip is a blue tint, never a box; an empty group is a quiet grey one.
export function GroupChip({ label, count, selected = false, onSelect }: {
  label: string
  count?: number
  selected?: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} data-empty={count === 0 || undefined}
      className="[&[data-empty]:not([aria-pressed=true])]:bg-fill [&[data-empty]:not([aria-pressed=true])]:text-ink-subtle inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-action-tint px-3.5 text-control font-medium text-action transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus aria-pressed:bg-action aria-pressed:text-action-ink pointer-coarse:min-h-control motion-reduce:transition-none"
    >
      {label}
      {count != null && <>{' '}<span className="font-normal">{fmtCount(count)}</span></>}
    </button>
  )
}

/**
 * #1349 item 3 (board 4b): the groups with no rows, folded behind one muted pill, "+ 9 tables with none". Opened, it
 * reads "Hide 9 tables with none" and the caller shows them. A grey fill, never a box, as #1348 draws a quiet control.
 */
export function NoneFold({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  const tables = `${fmtCount(count)} ${count === 1 ? 'table' : 'tables'} with none`
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} data-testid="none-fold"
      className="inline-flex min-h-[30px] items-center gap-1.5 rounded-full bg-fill px-3 text-[13px] text-ink-subtle transition-colors hover:bg-fill-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:min-h-control motion-reduce:transition-none">
      {open ? `Hide ${tables}` : `+ ${tables}`}
    </button>
  )
}

/**
 * #1349 item 1 (boards 3 and 4b): one count in the row under a record's title, the number first: "3 Plants", and
 * "5 Divisions through Sections" for a hop. With rows it is a link to them (a plain click is the caller's
 * `onNavigate`, a new-tab click the `href`) or, with no `href`, a button; with none it is a quiet grey chip that
 * leads nowhere. The page's row is `page` size, the pane's `pane`.
 */
export function CountChip({ count, label, through, href, onNavigate, onSelect, size = 'page' }: {
  count: number
  label: string
  through?: string
  href?: string
  onNavigate?: () => void
  onSelect?: () => void
  size?: 'page' | 'pane'
}) {
  const words = <>
    <span className="font-semibold">{fmtCount(count)}</span>{' '}{label}
    {through && <>{' '}<span className="text-xs font-normal text-ink-subtle">through {through}</span></>}
  </>
  const base = cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg',
    size === 'pane' ? 'min-h-[34px] px-3 text-[13.5px]' : 'min-h-9 px-3.5 text-control')
  if (count === 0) return <span data-empty className={cx(base, 'bg-subtle text-ink-subtle')}>{words}</span>
  const look = cx(base, 'bg-action-tint text-action transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:min-h-control motion-reduce:transition-none')
  if (!href) return <button type="button" onClick={onSelect} className={look}>{words}</button>
  return (
    <a href={href} className={look} onClick={(e) => {
      if (!onNavigate || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      onNavigate()
    }}>{words}</a>
  )
}
