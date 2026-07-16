import { whitelist } from '../methods'
import { getList } from '../query'

// Reference whitelisted methods (API-003). Real apps add their own here.

// Echoes args back with the caller — proves argument passing + identity.
whitelist('ping', ({ args, user }) => ({
  pong: true,
  echo: args,
  user: user.name,
}))

// A method that does real work through the permission-checked query layer:
// count documents of a DocType the caller can read.
whitelist('count_docs', async ({ args, user }) => {
  const doctype = String(args.doctype ?? '')
  if (!doctype) throw new Error('doctype is required')
  const res = await getList(doctype, { limit_page_length: 1 }, user.name)
  return { doctype, total: res.total }
})
