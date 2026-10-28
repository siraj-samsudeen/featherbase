// #667: why does this person see nothing from an app's report? A System
// Manager's read: the provider's places for one person, and for each of the
// app's datasets which places it applies and which it drops, with the filter
// keys it cannot apply. Labels and keys only: no filter value, no row, no
// figure. It changes no one's access and feeds nothing else.
import type { PersonScope } from 'shared'
import { unappliableKeys } from './app-datasets'
import { NoPersonScope, resolvePersonScope } from './person-scope'
import { findScopeProvider, installedAppDatasets } from './runtime-packages'
import { sql } from './db'
import { AppError } from './errors'
import { logAccess } from './audit'

export interface ScopeExplanation {
  /** The instance's scope-providing app. */
  provider: { app: string; title: string } | null
  /** Why the person has no usable scope (every reason means no access): no
   *  provider (`configuration`), a provider that failed or answered the wrong
   *  shape (`provider`), or no places (`scope`). Null when they have places. */
  problem: NoPersonScope['reason'] | null
  /** Each place's label and the filter keys it names; never their values. */
  places: { label: string; filters: string[] }[]
  datasets: { name: string; applied: string[]; dropped: { place: string; keys: string[] }[] }[]
}

export async function explainPersonScope(asker: string, person: string, app: string): Promise<ScopeExplanation> {
  const datasets = await installedAppDatasets(app)
  if (!datasets) throw new AppError('NotFoundError', `App ${app} is not installed`)
  const [known] = await sql`select 1 from person where row_id = ${person}`
  if (!known) throw new AppError('NotFoundError', `Person ${person} not found`)
  // Who looked at whose places, for which app: the Access Log's own record.
  await logAccess(asker, 'view_person_scope', { table: 'Person', row_id: person, method: app, required: true })
  const binding = await findScopeProvider()
  // No usable scope is itself the answer: which of the fail-closed reasons.
  // "Not set up yet" still answers as such.
  let places: PersonScope = []
  let problem: ScopeExplanation['problem'] = null
  try {
    places = await resolvePersonScope(person, binding)
  } catch (error) {
    if (!(error instanceof NoPersonScope)) throw error
    problem = error.reason
  }
  return {
    provider: binding ? { app: binding.app, title: binding.title } : null,
    problem,
    places: places.map((place) => ({ label: place.label, filters: Object.keys(place.filters).sort() })),
    datasets: datasets.map((dataset) => ({
      name: dataset.name,
      applied: places.filter((place) => !unappliableKeys(dataset, place).length).map((place) => place.label),
      dropped: places.flatMap((place) => {
        const keys = unappliableKeys(dataset, place)
        return keys.length ? [{ place: place.label, keys }] : []
      }),
    })),
  }
}
