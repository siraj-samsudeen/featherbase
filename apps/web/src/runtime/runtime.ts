import { createContext, useContext } from 'react'
import type { PageActionName, PageDefinition, PagePart } from 'shared'
import type { PageModel, Row, Scope } from './grammar'

// #1410: what every part of a page being drawn shares: the definition, the
// model its paths read, how far each data source has come, and the two things
// a control may do (write a value back, fire an action).

/** How far one data source has come. */
export type SourceState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; rows: Row[]; total: number }

/** Where a part is drawn: at the top of the page, or in one row of a data source ("/data/lines/0"). */
export type Place = Pick<Scope, 'row' | 'at'>
export const TOP: Place = {}

/** What a control fires: every action of the catalog takes a context. */
export interface PageEvent { name: PageActionName; context: Record<string, unknown> }

export interface PageRuntime {
  definition: PageDefinition
  parts: Map<string, PagePart>
  model: PageModel
  sources: Record<string, SourceState>
  /** Change the page's own copy of a value: state goes to the address, a row's value stays on the page until saved. */
  write: (path: string, value: unknown, place: Place) => void
  /** Fire an action. It settles when the action is done, and says on the page how it went. */
  fire: (event: PageEvent, place: Place) => Promise<void>
}

const PageRuntimeContext = createContext<PageRuntime | null>(null)
export const PageRuntimeProvider = PageRuntimeContext.Provider

export function usePageRuntime(): PageRuntime {
  // Parts are only ever drawn by PageView, which provides this.
  return useContext(PageRuntimeContext)!
}
