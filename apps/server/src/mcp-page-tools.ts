// #1410: the page tools of /mcp. Like every tool here each call is inner /api
// requests with the agent's own token (ADR 0021), so a page an agent saves is
// checked and refused exactly as a person's is: save_page is the normal row
// save of the Page Table.
import * as z from 'zod'
import { PAGE_STATUSES, pageHref } from 'shared'
import { AppError } from './errors'
import { ALTERS, READS, tablePath, type Api, type Json, type RegisterTool } from './mcp-common'

const nameArg = z.string().min(1).describe('The page\'s name, which is its address: lower-case words joined by hyphens, e.g. "reorder-plan"')
const READ_FIRST = 'This page exists. Read it first (get_page) and pass the updated_at it gave'
const pagePath = (name: string) => `/api/pages/${encodeURIComponent(name)}`
const given = (values: Json): Json => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))

export function registerPageTools(tool: RegisterTool, api: Api) {
  tool('list_parts',
    'What a page can be made of: every part with its settings, the named functions and actions, how a page reads its data, '
    + 'and one whole page that works. A page is a screen saved as data and drawn inside Featherbase. Read this before save_page.',
    {}, READS, () => api('GET', '/api/page_catalog'))

  tool('list_pages', 'The pages you can open, with each one\'s module and whether it is a Draft or Published.',
    {}, READS, () => api('GET', '/api/pages'))

  tool('get_page', 'One page: its definition, and its updated_at, the version save_page takes to change it.',
    { name: nameArg }, READS, ({ name }) => api('GET', pagePath(name)))

  tool('save_page',
    'Save a page: a new one, or a change to one that exists (then pass updated_at as get_page gave it; only what you name changes). '
    + 'The definition is checked first, against the parts list_parts gives and against the Tables and columns it names. '
    + 'A wrong page is refused with one line per mistake, each saying where it is, and nothing is saved. '
    + 'A new page is a Draft, which only people who may build Tables can open, until status is "Published". '
    + 'Needs the right to build Tables. Returns the page\'s address.',
    {
      name: nameArg,
      title: z.string().min(1).optional().describe('The page\'s heading in lists and menus; needed for a new page'),
      module: z.string().min(1).optional().describe('The group the page is listed under, beside the Tables of the same module'),
      status: z.enum(PAGE_STATUSES).optional(),
      description: z.string().optional(),
      definition: z.record(z.string(), z.unknown()).optional().describe('The page, as list_parts describes it: version, state, data, components'),
      updated_at: z.string().optional().describe('For a page that exists: its updated_at as get_page gave it; refused if someone changed the page since'),
    },
    ALTERS,
    async ({ name, updated_at, ...values }) => {
      // A Draft the caller may not open is not in their list; adding one of the same name is then refused by the save itself.
      const { pages } = (await api('GET', '/api/pages')) as { pages: { name: string }[] }
      const existing = pages.some((page) => page.name === name)
      if (existing && !updated_at) throw new AppError('ValidationError', READ_FIRST)
      const saved = existing
        ? await api('PATCH', `${tablePath('Page')}/${encodeURIComponent(name)}`, { ...given(values), updated_at })
        : await api('POST', tablePath('Page'), { row_id: name, ...given(values) })
      return { name, address: pageHref(name), title: saved.title, module: saved.module, status: saved.status, updated_at: saved.updated_at }
    })
}
