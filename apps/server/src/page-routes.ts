import { Hono } from 'hono'
import { pageCatalog } from 'shared'
import { openPage, pagesFor } from './pages'
import { who, type Env } from './route-context'

// #1410: reading pages. Saving one is the normal row save of the Page Table.
export const pageRoutes = new Hono<Env>()

/** What a page can be made of: the parts, functions and actions, with a worked example. */
pageRoutes.get('/api/page_catalog', (c) => c.json(pageCatalog()))

pageRoutes.get('/api/pages', async (c) => c.json({ pages: await pagesFor(who(c)) }))

pageRoutes.get('/api/pages/:name', async (c) => c.json(await openPage(who(c), c.req.param('name'))))
