// #1277 (J2, J3, D4): which reports business roles give a person, and whether Dash opens for them, when
// business roles decide. A report reaches someone given it directly or through a business role they hold;
// grants to a job or to a platform role (Dash Reader) give nothing here. A filtered report still needs a
// place, and a whole-stores one a whole store (report-eligibility.ts, as the old rules).
import { businessReportsReaching, type AccessRow, type BundleMember, type NewWhy } from './report-access.ts'
import { offered, opensDashFor } from './report-eligibility.ts'
import type { Place } from './provider.ts'

export { businessReportsReaching, type NewWhy }

/** The reports offered to one person under business roles, with why each reaches them. `shapes`: report key to filter shape. */
export function businessReports(person: string, access: { roles: readonly string[]; places: readonly Place[] }, rows: readonly AccessRow[],
  members: readonly BundleMember[], shapes: ReadonlyMap<string, string>): { offered: string[]; why: Map<string, NewWhy[]> } {
  const why = businessReportsReaching({ person, roles: access.roles }, rows, members)
  return { offered: [...why.keys()].filter(key => shapes.has(key) && offered(shapes.get(key)!, access.places)).sort(), why }
}

/**
 * Platform roles that still open Dash under business roles: they manage access (giving reports, View as), so they
 * need the app open even with no business role. Dash Reader and Dash All-Stores Reader open nothing by themselves here.
 */
export const MANAGING_ROLES: ReadonlySet<string> = new Set(['System Manager', 'Report Access Manager', 'Team Report Manager', 'View As Tester'])

/** What business roles alone would say: a business role holding a Dash permission, a managing role, or any report offered. */
export const businessRolesOpen = (roles: readonly string[], opensByRole: boolean, offeredCount: number) =>
  opensByRole || roles.some(role => MANAGING_ROLES.has(role)) || offeredCount > 0

/**
 * can_open under business roles. The platform still lets into Dash only someone holding one of Dash's own roles (or
 * System Manager), who may read its entry Table: that is the door, and business roles decide what is behind it. So
 * Dash Reader alone no longer opens Dash, and a business role alone does not either until its holder has the door.
 */
export const opensDashByBusinessRoles = (roles: readonly string[], opensByRole: boolean, offeredCount: number) =>
  opensDashFor(roles, 0) && businessRolesOpen(roles, opensByRole, offeredCount)
