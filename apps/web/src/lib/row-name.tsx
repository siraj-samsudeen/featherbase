import { rowNameText, useRowName } from './relations'

/** A linked row by its name, then the code people use (D5): "Enchakkal
 *  Supermarket · 1503". Never its id: while the name is on its way an ellipsis
 *  stands in, and a row the viewer cannot read is named neutrally. */
export function RowName({ table, rowId }: { table: string; rowId: string }) {
  const name = useRowName(table, rowId)
  if (name.state === 'loading') return <span className="text-ink-subtle">…</span>
  return <>{rowNameText(name)}</>
}
