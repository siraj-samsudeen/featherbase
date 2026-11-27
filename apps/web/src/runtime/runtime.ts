import { createContext, useContext } from 'react'
import type { PageActionName, PageDefinition, PagePart } from 'shared'
import { readPath, type PageModel, type Row, type Scope } from './grammar'

// #1410: what every part of a page being drawn shares: the definition, the
// model its paths read, how far each data source has come, and the two things
// a control may do (write a value back, fire an action).

/** How far one data source has come. */
export type SourceState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; rows: Row[]; total: number }

/** Where a part is drawn: at the top of the page, or in one row of a data source ("/data/lines/0"). */
export interface Place { at?: string }
export const TOP: Place = {}

/** What paths read at a place, in one of the page's two models. */
export function scopeAt(model: PageModel, place: Place): Scope {
  return { model, at: place.at, row: place.at === undefined ? undefined : readPath(place.at, { model }) as Row }
}

/** What a control fires: every action of the catalog takes a context. */
export interface PageEvent { name: PageActionName; context: Record<string, unknown> }

export interface PageRuntime {
  definition: PageDefinition
  parts: Map<string, PagePart>
  /** The page as last read from the server: what everything the page SHOWS reads (a text, a column, a total, a link). */
  model: PageModel
  /** The same with what was typed laid over it: what a box shows, and what an action is fired with. Typing changes nothing else until it is saved. */
  typed: PageModel
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
