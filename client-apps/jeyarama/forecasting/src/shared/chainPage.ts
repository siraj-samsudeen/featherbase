// What the app hands each manager's page (Store Manager, category head, RB), and the header every one of them
// starts from: the newest real official Run in the app's tables, or the made-up chain when none is loaded (chainData.ts).
import type { Chain, ChainPerson } from './chainData'
import { day, monthOfRun, type Line } from './model'
import type { Header } from './review'
// the signed-in person, as the server's signed_in read finds them on the org chart
import type { SignedIn } from '../signedIn'
export type { SignedIn }

export interface ChainPageProps {
  /** What the page reviews: the real Run or the made-up chain. */
  chain: Chain
  /** Where a subcategory opens on its own: this page with it open (?line=<rowId>). */
  hrefFor: (l: Line) => string
  /** A subcategory to open on arrival (a link to it). */
  openLine: string | null
  /** The page opened or closed a subcategory: the app keeps it in the address. */
  onOpenLine: (rowId: string | null) => void
  /** Whose page it is (ownerOf): the signed-in person's own, or the one an administrator views as; null when an
   *  administrator's view names nobody. */
  person: ChainPerson | null
  /** An administrator's view: it may open any store or person. */
  admin: boolean
  /** The page's own Day Review and Needs Your Attention, for a store or a region (#4935): tabs that open them. */
  pagesFor?: (reach: { store: string } | { region: string }) => PageLink[]
}
/** A tab that opens another page (the Team Leader's Day Review's "Review the month", the other way round). */
export interface PageLink { id: string; label: string; href: string }

/** A manager's header: who, in what role, over what; the Run's month and sales cut-off. */
export const chainHeader = (chain: Chain, person: string, role: string, store = '', section = ''): Header =>
  ({ store, section, person, role, cutOff: day(chain.cutOff), month: monthOfRun(chain.horizon) })

/** What a manager's page is about to open: whose it is (null: an administrator's view that names nobody, which the
 *  page fills in itself), or why the signed-in person has none. */
export type Owner = { person: ChainPerson | null } | { missing: { title: string; body: string } }
export type ChainView = 'store-review' | 'category-review' | 'rb-review'
const ROLE: Record<ChainView, string> = { 'store-review': 'Store Manager', 'category-review': 'Category Head', 'rb-review': 'Chief Executive' }
const MISSING: Record<ChainView, { title: string; body: string }> = {
  'store-review': { title: 'You have no Store Manager job on the org chart',
    body: 'Store Manager Review opens for a store\'s Store Manager, from their Job Assignment in Dash. If you manage a store, ask for your job to be set up there.' },
  'category-review': { title: 'You have no category head assignment on the org chart',
    body: 'Category Review opens for a category head, from their Merchandise Assignment in Dash. If you head a category, ask for your assignment to be set up there.' },
  'rb-review': { title: 'No Chief Executive job on the org chart',
    body: 'RB Review opens for the Managing Director or a Director, from their Job Assignment in Dash. If that is you, ask for your job to be set up there.' },
}
const NO_ORG_CHART = { title: 'This instance has no org chart',
  body: 'The review pages open from your job on the org chart, which this instance does not have. Only an administrator can view them here.' }
const NOT_LINKED = { title: 'Your sign-in is not linked to an employee',
  body: 'The review pages open from your job on the org chart, found through your employee record. Ask for your employee record to be linked to your sign-in in Dash.' }

/** One person from several chain entries (a Store Manager of two stores, or one person with an Employee row in each
 *  region): every place they cover. */
function merged(rows: ChainPerson[]): ChainPerson | null {
  if (!rows.length) return null
  if (rows.length === 1) return rows[0]
  const places = rows.flatMap(r => r.places)
  return { ...rows[0], place: [...new Set(rows.map(r => r.place))].join(', '), places }
}

/** Whose page this is (#1438). A signed-in person gets their own: matched by Employee row, never by name, and never
 *  the one the address names. Only an administrator views as someone, by their Employee row (?as=<id>); without one
 *  the page opens as it chooses (the Store Manager of the store shown, the biggest category head, the first Chief
 *  Executive). */
export function ownerOf(view: ChainView, chain: Chain, me: SignedIn, as: string | null): Owner {
  // RB Review's people are the Chief Executive jobs the server found (the made-up chain carries its own)
  // (a real one only on a real Run: a real Chief Executive is never shown the made-up chain under their name)
  const holders = view === 'rb-review'
    ? [...chain.people.filter(p => p.role === ROLE[view]), ...(chain.real ? me.chiefs : []).map((c): ChainPerson => ({ id: c.id, name: c.name, role: ROLE[view], place: c.job,
      places: [...new Set(chain.lines.map(l => l.store))].map(store => ({ store, codes: null })) }))]
    : chain.people.filter(p => p.role === ROLE[view])
  if (me.admin) {
    // a view as someone who holds no such job says so, rather than show someone else
    if (as) return (p => (p ? { person: p } : { missing: { title: `No one with employee row ${as} holds this job`,
      body: `Viewing as someone opens their page only when the org chart gives them this page's job. Check the employee row in the address (?as=).` } }))(merged(holders.filter(p => p.id === as)))
    // an administrator who holds the job opens on their own, else the page's first
    const own = merged(holders.filter(p => me.employees.includes(p.id)))
    if (own) return { person: own }
    if (view === 'store-review') return { person: null }
    return holders.length ? { person: holders[0] } : { missing: MISSING[view] }
  }
  if (!me.orgChart) return { missing: NO_ORG_CHART }
  const mine = merged(holders.filter(p => me.employees.includes(p.id)))
  if (mine) return { person: mine }
  return { missing: me.employees.length ? MISSING[view] : NOT_LINKED }
}
