import type { MouseEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { UNSEEN_ROW, rowNameText, useLinkTitle, useRowName } from './relations'

/** A linked row by its name, then the code people use (D5): "Enchakkal
 *  Supermarket · 1503". Never its id: while the name is on its way an ellipsis
 *  stands in, and a row the viewer cannot read is named neutrally. */
export function RowName({ table, rowId }: { table: string; rowId: string }) {
  const name = useRowName(table, rowId)
  if (name.state === 'loading') return <span className="text-ink-subtle">…</span>
  return <>{rowNameText(name)}</>
}

/** A link to a row, read by its name (D5). A row the viewer cannot read is
 *  neutral text instead: no link, no action, its id nowhere (#910 D3). */
export function RowLink({ table, rowId, onClick, className = 'text-action hover:underline' }: {
  table: string
  rowId: string
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  className?: string
}) {
  const name = useRowName(table, rowId)
  if (name.state === 'unreadable') return <span className="text-ink-muted">{rowNameText(name)}</span>
  return (
    <Link to="/featherbase/admin/table/$table/row/$name" search={{ prefill: undefined }}
      params={{ table, name: rowId }} onClick={onClick} className={className}>
      {name.state === 'loading' ? <span className="text-ink-subtle">…</span> : rowNameText(name)}
    </Link>
  )
}

/** A linked row by its title alone, where a code would crowd the line (a
 *  filter chip, a card): an ellipsis while it loads, neutral words for a row
 *  the viewer cannot read, never its id. */
export function LinkedTitle({ table, rowId }: { table: string; rowId: string }) {
  const title = useLinkTitle(table, rowId)
  if (title.state === 'loading') return <span className="text-ink-subtle">…</span>
  return <>{title.state === 'unreadable' ? UNSEEN_ROW : title.title}</>
}
