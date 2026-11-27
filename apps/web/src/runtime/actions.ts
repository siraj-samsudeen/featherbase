import { pageHref, rowHref, type PageActionName } from 'shared'
import { api } from '../lib/api'

// #1410: what a page's control may do, and nothing else. Every save is the
// row's normal save, as the person looking: the Table's checks run and its
// grants decide.

/** What the page itself does for an action. */
export interface ActionHost {
  /** Read the page's rows again, so a saved value shows. */
  refresh: () => Promise<unknown>
  /** A row was saved: what was typed into it is no longer waiting. */
  saved: (table: string, row: string) => void
  /** Go to an address inside Featherbase, with the state a page should open in. */
  go: (href: string, state?: Record<string, unknown>) => void
  /** Change this page's state. */
  setState: (values: Record<string, unknown>) => void
}

type Context = Record<string, unknown>
const SAVED = 'Saved'
const tableUrl = (table: unknown) => `/api/table/${encodeURIComponent(String(table))}`

/** Each action of the catalog. An action the catalog gains must be added here. It answers what to tell the person, if anything. */
const ACTIONS: Record<PageActionName, (context: Context, host: ActionHost) => Promise<string | void> | void> = {
  save_row: async ({ table, row, updated_at, values }, host) => {
    await api.patch(`${tableUrl(table)}/${encodeURIComponent(String(row))}`, { ...(values as Context), updated_at })
    await host.refresh()
    host.saved(String(table), String(row))
    return SAVED
  },
  create_row: async ({ table, values }, host) => {
    await api.post(tableUrl(table), values)
    await host.refresh()
    return SAVED
  },
  open_record: ({ table, row }, host) => host.go(rowHref(String(table), String(row))),
  open_page: ({ page, state }, host) => host.go(pageHref(String(page)), state as Context | undefined),
  set_state: ({ values }, host) => host.setState(values as Context),
}

/** Run one action with its resolved context. A refusal is thrown, in the server's own words. */
export async function runAction(name: PageActionName, context: Context, host: ActionHost): Promise<string | void> {
  return ACTIONS[name](context, host)
}
