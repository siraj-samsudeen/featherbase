import { AppError } from '../errors'
import { getBacklinks } from '../meta'
import { getDoc } from '../document'
import { countDocs, type Filter } from '../query'
import { permissionScope } from '../permissions'
import { registerCollectionAction, registerRowAction } from '../actions'

// Relational navigation (#100, pattern 1): every table that points at this
// row, with a permission-scoped count and a ready-to-use ListView filter.
//
//   GET /api/table/:table/:name:connections
//   → { connections: [{ table, column, via, count, filters }] }
//
// Direct backlink (Attendance.employee → Employee): filters is
// [[column, '=', name]] — droppable straight into /admin/:table?filters=.
// Via a sub-table (Item ← PO Line ← Purchase Order): `via` names the
// sub-table and filters is a compact 'related' relationship filter the
// list engine compiles to a scoped EXISTS server-side (NAV-002) — no name
// list, no cap.
//
// Tables the caller cannot read are omitted entirely — same posture as the
// sidebar, presentation scoping backed by real read checks on navigation.

export interface Connection {
  table: string
  column: string
  via: string | null
  count: number
  filters: Filter[]
}

// Table-level shape of the same map, no counts — what a pane-chain picker
// (Explore) or a relationship map needs before any row is chosen. Readable
// backlink tables only, same posture as :connections.
registerCollectionAction('backlinks', {
  effect: 'read',
  description: 'Tables whose Reference columns point at this table (no per-row counts).',
  handler: async ({ table, user }) => {
    if ((await permissionScope(user.row_id, table, 'read')) === 'none')
      throw new AppError('PermissionError', `No read permission on ${table} for ${user.row_id}`)
    const backlinks = []
    for (const bl of await getBacklinks(table))
      if ((await permissionScope(user.row_id, bl.table, 'read')) !== 'none') backlinks.push(bl)
    return { backlinks }
  },
})

registerRowAction('connections', {
  effect: 'read',
  description:
    'Tables whose Reference columns point at this row, with counts and ready-to-use list filters.',
  handler: async ({ table, name, user }) => {
    // Row-level read check (404/403 exactly like GET on the row itself).
    await getDoc(table, name, user.row_id)

    const connections: Connection[] = []
    for (const bl of await getBacklinks(table)) {
      if ((await permissionScope(user.row_id, bl.table, 'read')) === 'none') continue
      if (bl.via) {
        // NAV-002: the via-link filter is a compact relationship filter the
        // list engine evaluates server-side — no name list to disclose, no
        // 500-owner cap, and the shareable URL never goes stale.
        const filters: Filter[] = [
          ['name', 'related', { via: bl.via, column: bl.column, table, filters: [['name', '=', name]] }],
        ]
        connections.push({
          table: bl.table,
          column: bl.column,
          via: bl.via,
          count: await countDocs(bl.table, filters, user.row_id),
          filters,
        })
      } else {
        const filters: Filter[] = [[bl.column, '=', name]]
        connections.push({
          table: bl.table,
          column: bl.column,
          via: null,
          count: await countDocs(bl.table, filters, user.row_id),
          filters,
        })
      }
    }
    return { connections }
  },
})
