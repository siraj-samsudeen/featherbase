// The live rules for which given reports a reader is offered and whether Dash opens for them, in one
// place: server.ts decides with them today, and the business roles comparison (#1218) judges both of
// its sides with them, so the two can never drift.
import { ALL_STORES_ROLE, type Place } from './provider.ts'
import { TEAM_MANAGER } from './team-access.ts'
import { VIEW_AS_TESTER } from './view-as-people.ts'

/** #1282 (Siraj, 19-Nov-2026): the one role that changes what a business role can do, on Business Roles' grid. */
export const ROLE_PERMISSION_MANAGER = 'Role Permission Manager'

/** Dash's own roles (featherbase.json's `roles`): holding any of them opens Dash (#1172). */
export const DASH_ROLES = new Set([ALL_STORES_ROLE, 'Dash Reader', 'Report Access Manager', TEAM_MANAGER, VIEW_AS_TESTER, ROLE_PERMISSION_MANAGER])

/** reportsFor: someone whose job reaches nothing gets only a given report that takes no filter. */
export const openableByReach = (shape: string, reachesAny: boolean) => reachesAny || shape === 'No filter'

/** offeredReports: a whole-stores report is offered only to someone holding a whole store (#967 point 1). */
export const offeredByPlaces = (shape: string, places: readonly Place[]) => shape !== 'Whole stores' || places.some(place => !place.filters.subcategory)

/** A given report, offered to someone holding these places. */
export const offered = (shape: string, places: readonly Place[]) => openableByReach(shape, places.length > 0) && offeredByPlaces(shape, places)

/** can_open: a Dash role, or a System Manager (who manages access), or any report offered. */
export const opensDashFor = (roles: readonly string[], offeredCount: number) =>
  roles.some(role => role === 'System Manager' || DASH_ROLES.has(role)) || offeredCount > 0

/** The roles the `report` and `embed_session` reads require (featherbase.json's readRoles, enforced by the platform): a
 *  report taking a filter opens only for a holder; one taking none opens through report_open, which requires none. */
export const READ_ROLES: readonly string[] = [ALL_STORES_ROLE, 'Dash Reader']
export const readableByRoles = (shape: string, roles: readonly string[]) => shape === 'No filter' || roles.some(role => READ_ROLES.includes(role))
