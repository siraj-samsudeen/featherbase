// What the app hands each manager's page (Store Manager, category head, RB), and the header every one of them
// starts from: the newest real official Run in the app's tables, or the made-up chain when none is loaded (chainData.ts).
import type { Chain, ChainPerson } from './chainData'
import { day, monthOfRun, type Line } from './model'
import type { Header } from './review'

export interface ChainPageProps {
  /** What the page reviews: the real Run or the made-up chain. */
  chain: Chain
  /** Where a subcategory opens on its own: this page with it open (?line=<rowId>). */
  hrefFor: (l: Line) => string
  /** A subcategory to open on arrival (a link to it). */
  openLine: string | null
  /** The page opened or closed a subcategory: the app keeps it in the address. */
  onOpenLine: (rowId: string | null) => void
}

/** A manager's header: who, in what role, over what; the Run's month and sales cut-off. */
export const chainHeader = (chain: Chain, person: string, role: string, store = '', section = ''): Header =>
  ({ store, section, person, role, cutOff: day(chain.cutOff), month: monthOfRun(chain.horizon) })

/** The person in a role (the one named in the address, ?as=, when several hold it); the first otherwise. */
export function personIn(chain: Chain, role: string, test: (p: ChainPerson) => boolean = () => true): ChainPerson | undefined {
  const as = new URLSearchParams(window.location.search).get('as')
  const holders = chain.people.filter(p => p.role === role && test(p))
  return holders.find(p => p.name === as) ?? holders[0]
}
