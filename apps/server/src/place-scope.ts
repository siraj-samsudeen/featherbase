// #1454: a person's places (stores, sections, subcategories), as the instance's org-chart scope provider gives them,
// asked once per request. A Table whose row rule is `places` (#1459, row-rule.ts) is read only within them.
import type { PersonScope } from 'shared'
import { AsyncLocalStorage } from 'node:async_hooks'
import { NoPersonScope, resolvePersonScope } from './person-scope'

// runtime-packages is loaded when first needed: query.ts and document.ts import this module, and a static import
// would close a cycle through runtime-packages at start-up (as view-as.ts does).
const packages = () => import('./runtime-packages')

// One answer per person per request (an HTTP request, MCP's included, or one live update's delivery): a page's many
// reads, a save's several checks, ask the provider once. Only the places: nothing else is remembered here, and a
// request never outlives a change to the org chart by more than its own run.
const memo = new AsyncLocalStorage<Map<string, Promise<PersonScope>>>()
export function withPlacesMemo<T>(work: () => Promise<T>): Promise<T> {
  return memo.getStore() ? work() : memo.run(new Map(), work)
}

/** The person's places now, once per request: none when the instance has no scope provider, the provider fails or
 *  gives them nothing, so every scoped Table then answers only their own rows. */
export function placesOf(user: string): Promise<PersonScope> {
  const remembered = memo.getStore()
  const hit = remembered?.get(user)
  if (hit) return hit
  const read = resolvePlaces(user)
  remembered?.set(user, read)
  // a failed read is not remembered: the next check asks again
  read.catch(() => remembered?.delete(user))
  return read
}
async function resolvePlaces(user: string): Promise<PersonScope> {
  try {
    return await resolvePersonScope(user, await (await packages()).findScopeProvider())
  } catch (error) {
    if (error instanceof NoPersonScope) return []
    // a provider "not set up yet" (a missing identifier system) gives no one places either
    if ((error as { type?: string }).type === 'NotSetUpError') return []
    throw error
  }
}
