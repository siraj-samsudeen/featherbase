import { ShownName } from './people'
import { rowNameText, useRowName } from './relations'

/** A linked row by its name, then the code people use (D5): "Enchakkal
 *  Supermarket · 1503". While the name loads, the id stands in (a person's
 *  opaque id reads as their name); a row the viewer cannot read is named
 *  neutrally, never by its id. */
export function RowName({ table, rowId }: { table: string; rowId: string }) {
  const name = useRowName(table, rowId)
  if (name.state === 'loading') return <ShownName id={rowId} />
  return <>{rowNameText(name)}</>
}
