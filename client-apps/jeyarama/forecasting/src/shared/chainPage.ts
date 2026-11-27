// What the app hands each manager's page (Store Manager, category head, RB), and the header every one of them
// starts from. The pages run on the made-up chain (madeUpChain.ts) until the copied Run is in the app's tables.
import { CUT_OFF, HORIZON } from './madeUpChain'
import { day, monthOfRun, type Line } from './model'
import type { Header } from './review'

export interface ChainPageProps {
  /** Where a subcategory opens on its own: this page with it open (?line=<rowId>). */
  hrefFor: (l: Line) => string
  /** A subcategory to open on arrival (a link to it). */
  openLine: string | null
  /** The page opened or closed a subcategory: the app keeps it in the address. */
  onOpenLine: (rowId: string | null) => void
}

/** A manager's header: who, in what role, over what; the month and cut-off of the made-up Run. */
export const chainHeader = (person: string, role: string, store = '', section = ''): Header =>
  ({ store, section, person, role, cutOff: day(CUT_OFF), month: monthOfRun(HORIZON) })
