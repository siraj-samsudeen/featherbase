// #1409 (design D6): what stand-in rows a request served. The dataset engine
// notes each stand-in it answers from (app-datasets.ts); the /api middleware
// (index.ts) opens the scope and writes what was noted onto the response, so
// every route that served stand-in rows is marked by the platform and no app
// or route can forget to. Outside a request (a job) nothing is collected.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { StandInServed } from 'shared'

const served = new AsyncLocalStorage<Map<string, StandInServed>>()

/** Run one request, collecting the stand-ins it serves. */
export function collectingStandIns<T>(fn: () => T): T {
  return served.run(new Map(), fn)
}

/** Note that this request answered from a stand-in. */
export function noteStandInServed(standIn: StandInServed): void {
  served.getStore()?.set(`${standIn.app}.${standIn.dataset}`, standIn)
}

/** The stand-ins this request served so far, each dataset once. */
export function standInsServed(): StandInServed[] {
  return [...(served.getStore()?.values() ?? [])]
}
