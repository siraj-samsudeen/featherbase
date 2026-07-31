import { sql } from '../db'
import { AppError } from '../errors'
import { getBacklinks } from '../meta'
import { getDoc } from '../document'
import { tableName } from '../doctype-engine'
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
        const rows = await sql`
          select distinct parent from ${sql(tableName(bl.via))}
          where ${sql(bl.column)} = ${name} and parenttype = ${bl.table}
            and parent is not null
          limit 500`
        const parents = rows.map((r) => r.parent as string)
        const filters: Filter[] = [['name', 'in', parents]]
        const count = parents.length ? await countDocs(bl.table, filters, user.name) : 0
        connections.push({ table: bl.table, column: bl.column, via: bl.via, count, filters })
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
