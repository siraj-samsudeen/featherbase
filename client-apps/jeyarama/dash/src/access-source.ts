// #1277 (J5): one switch says what decides Dash access: business roles, or the old rules (jobs, Dash Reader
// and Dash All-Stores Reader, grants to jobs and roles). It is a row of dash.access_source, a Table that decides
// scope, so only a System Manager changes it, from Admin, with no deploy; the scope provider and every read
// look at it fresh on each request. No row (as every instance starts; owner, 18-Nov-2026) or any row not saying business
// roles means the old rules: when in doubt, the rules production ran before.
import { reachOf, type NoReach, type Place } from './provider.ts'
import type { Model } from './business-roles.ts'
import { businessAccess, businessModel, every, readsDesignations, type Base, type BusinessAccess } from './business-access.ts'
import { istToday } from './report.ts'
import { exact, text } from './values.ts'

export const ACCESS_SOURCE = 'dash.access_source'
export const BUSINESS_ROLES = 'business_roles'
export const LEGACY = 'legacy'
export type AccessSource = typeof BUSINESS_ROLES | typeof LEGACY
/** The basis every place from business roles carries; the page shows no reason for it. */
export const PLACED_BY_BUSINESS_ROLES = 'business_roles'
/**
 * Which rules gave a read its places, when it has any: the switch can change between the platform working out the
 * places and the read deciding reports (Codex adversarial round 6), and a read must never mix the two.
 */
export const placesSource = (places: readonly Place[]): AccessSource | null =>
  !places.length ? null : places.every(p => (p.basis ?? '').split(', ').includes(PLACED_BY_BUSINESS_ROLES)) ? BUSINESS_ROLES : LEGACY

/** What decides Dash access now. Unreadable fails the caller, as any access read does. */
export async function accessSource(docs: Base): Promise<AccessSource> {
  const rows = await every(docs, ACCESS_SOURCE, ['source'])
  return rows.length && rows.every(row => text(row.source) === BUSINESS_ROLES) ? BUSINESS_ROLES : LEGACY
}

/** One person's Dash access by business roles, read fresh: only their own hand changes and designations are read. */
export async function liveBusinessAccess(docs: Base, person: string, on: string): Promise<{ access: BusinessAccess; model: Model }> {
  const { model, hand } = await businessModel(docs, on, person)
  return { access: await businessAccess(docs, person, on, { model, hand, designations: await readsDesignations(docs) }), model }
}

/** What a person reaches now, by whichever rules decide: their places, and why they reach nothing when they don't. */
export async function liveReach(docs: Base, person: string, roles: readonly string[], on: string, source?: AccessSource): Promise<{ source: AccessSource; places: Place[]; problems: NoReach[]; access?: BusinessAccess }> {
  if ((source ?? await accessSource(docs)) === LEGACY) return { source: LEGACY, ...await reachOf(docs, person, on, roles) }
  const { access } = await liveBusinessAccess(docs, person, on)
  // Why someone reaches nothing is the old rules' words; with no Dash role at all, they hold no job that gives Dash.
  return { source: BUSINESS_ROLES, places: access.places, problems: access.places.length ? [] : (await reachOf(docs, person, on, [])).problems, access }
}

interface ProviderContext {
  readonly person: { readonly id: string; readonly roles?: readonly string[] }
  readonly documents: Base
}

/**
 * Dash's scope provider: the places a person covers, by whichever rules the switch names. The platform calls it
 * fresh on every person_scope request; an empty answer is no access.
 */
export function dashScopeProvider({ today = istToday }: { today?: () => string } = {}) {
  return async function orgChart({ person, documents }: ProviderContext): Promise<Place[]> {
    const on = today()
    if (await accessSource(documents) === LEGACY) return (await reachOf(documents, person.id, on, person.roles)).places
    // Each place says it came from business roles, so a read can tell which rules gave it its places (placesSource).
    return (await liveBusinessAccess(documents, exact(person.id), on)).access.places
      .map(place => ({ ...place, basis: [...new Set([...(place.basis ?? '').split(', ').filter(Boolean), PLACED_BY_BUSINESS_ROLES])].sort().join(', ') }))
  }
}
