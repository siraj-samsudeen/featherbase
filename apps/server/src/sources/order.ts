import type { ListSpec } from './types'

/** ORDER BY for a source read: the key breaks ties, so reads at different
 *  offsets never repeat or skip a row that shares the sort value. */
export function orderClause(order: ListSpec['order'], pk: string, quote: (name: string) => string): string {
  const main = `${quote(order.column)} ${order.dir === 'desc' ? 'desc' : 'asc'}`
  return order.column === pk ? main : `${main}, ${quote(pk)} asc`
}
