// #1378: what is open in Tickets lives in its address, so a copied address
// reopens it: the view is the path (/tickets/, /tickets/mine, /tickets/assigned),
// a ticket is added under it (/tickets/all/<ticket>), the New ticket form is
// /tickets/new, and the filters are ?search=, ?type= and ?state=. Other query
// keys (the shared bar's) are left as they are.

export const APP_ROOT = '/tickets/'
export const VIEWS = ['all', 'mine', 'assigned'] as const
export type View = (typeof VIEWS)[number]

export interface Address {
  view: View
  ticket: string
  creating: boolean
  search: string
  type: string
  state: string
}

const FILTERS = { search: 'search', type: 'type', state: 'state' } as const

export function parseAddress(pathname: string, search: string): Address {
  const path = pathname.startsWith(APP_ROOT) ? pathname.slice(APP_ROOT.length) : pathname.replace(/^\/+/, '')
  const [first = '', second = ''] = path.split('/').filter(Boolean).map((segment) => {
    try { return decodeURIComponent(segment) } catch { return segment }
  })
  const query = new URLSearchParams(search)
  const view = (VIEWS as readonly string[]).includes(first) ? (first as View) : 'all'
  return {
    view,
    // Dash still links a ticket as /tickets/?ticket=<id> while Dash is on hold (#1378);
    // its link moves to the path form with Dash's next version, and this line goes.
    ticket: first === view ? second : first ? '' : query.get('ticket') ?? '',
    creating: first === 'new',
    search: query.get(FILTERS.search) ?? '',
    type: query.get(FILTERS.type) ?? '',
    state: query.get(FILTERS.state) ?? '',
  }
}

/** The address as a path and query, keeping the query keys Tickets does not own. */
export function formatAddress(address: Address, search: string): string {
  const path = address.creating
    ? 'new'
    : address.ticket
      ? `${address.view}/${encodeURIComponent(address.ticket)}`
      : address.view === 'all' ? '' : address.view
  const query = new URLSearchParams(search)
  query.delete('ticket')
  for (const [key, name] of Object.entries(FILTERS)) {
    const value = address[key as keyof typeof FILTERS]
    if (value) query.set(name, value)
    else query.delete(name)
  }
  const rest = query.toString()
  return `${APP_ROOT}${path}${rest ? `?${rest}` : ''}`
}
