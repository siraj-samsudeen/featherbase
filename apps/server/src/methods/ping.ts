import { whitelist } from '../methods'
import { getList } from '../query'
import { AppError } from '../errors'

// Reference whitelisted methods (API-003). Real apps add their own here.

// Echoes args back with the caller — proves argument passing + identity.
whitelist('ping', ({ args, user }) => ({
  pong: true,
  echo: args,
  user: user.row_id,
}), { effect: 'read' })

// A method that does real work through the permission-checked query layer:
// count rows of a Table the caller can read.
whitelist('count_docs', async ({ args, user }) => {
  const table = String(args.table ?? '')
  if (!table)
    throw new AppError('ValidationError', 'table is required', { table: 'Required' })
  const res = await getList(table, { limit_page_length: 1 }, user.row_id)
  return { table, total: res.total }
}, { effect: 'read' })
