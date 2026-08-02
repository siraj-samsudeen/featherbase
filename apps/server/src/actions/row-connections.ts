import { AppError } from '../errors'
import { getBacklinks } from '../meta'
import { getDoc } from '../document'
import { countDocs, relatedOwners, type Filter } from '../query'
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
// sub-table and filters is [['name', 'in', [...owning rows]]], because the
// owner's list can't be filtered by a column it doesn't have. Owner names
// are capped at 500 (the list API's page clamp); `count` is the true count.
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
    if ((await permissionScope(user.name, table, 'read')) === 'none')
      throw new AppError('PermissionError', `No read permission on ${table} for ${user.name}`)
    const backlinks = []
    for (const bl of await getBacklinks(table))
      if ((await permissionScope(user.name, bl.table, 'read')) !== 'none') backlinks.push(bl)
    return { backlinks }
  },
})

registerRowAction('connections', {
  effect: 'read',
  description:
    'Tables whose Reference columns point at this row, with counts and ready-to-use list filters.',
  handler: async ({ table, name, user }) => {
    // Row-level read check (404/403 exactly like GET on the row itself).
    await getDoc(table, name, user.name)

    const connections: Connection[] = []
    for (const bl of await getBacklinks(table)) {
      if ((await permissionScope(user.name, bl.table, 'read')) === 'none') continue
      if (bl.via) {
        // #102 review: owner names AND count come from one permission-scoped
        // query (see relatedOwners) — never from the raw child table, which
        // would disclose names of parents the caller cannot read.
        const { names, total } = await relatedOwners(bl.table, bl.via, bl.column, name, user.name)
        const filters: Filter[] = [['name', 'in', names]]
        connections.push({ table: bl.table, column: bl.column, via: bl.via, count: total, filters })
      } else {
        const filters: Filter[] = [[bl.column, '=', name]]
        connections.push({
          table: bl.table,
          column: bl.column,
          via: null,
          count: await countDocs(bl.table, filters, user.name),
          filters,
        })
      }
    }
    return { connections }
  },
})
