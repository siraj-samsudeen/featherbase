// #1277: the action giving old grants to business roles, and the reads of the switch and the log. The steps are switch-over.ts.
import { ACCESS_SOURCE, accessSource } from './access-source.ts'
import { every, type Base } from './business-access.ts'
import { managesAccess, type AccessContext } from './report-access-server.ts'
import { SWITCH_OVER_LOG, giveOldGrantsToRoles, type Writer } from './switch-over.ts'
import { exact, text } from './values.ts'

const ONLY_SYSTEM_MANAGERS = 'Only a System Manager can give the old grants to business roles'
const ONLY_MANAGERS = 'Only a Report Access Manager or a System Manager can see what decides Dash access'

/**
 * Give the old grants to business roles, only when a System Manager asks: it decides which reports business roles
 * get, so it is kept to the people who may set the switch. It sets no switch.
 */
export async function giveOldGrantsAction(context: AccessContext) {
  if (!(context.roles ?? []).includes('System Manager')) context.reject!(ONLY_SYSTEM_MANAGERS)
  return giveOldGrantsToRoles(context.baseTables!, context.documents as unknown as Writer)
}

/** What decides Dash access now, and the switch row a System Manager changes to put the old rules back. */
export async function businessAccessSummary(context: AccessContext) {
  if (!managesAccess(context)) context.reject!(ONLY_MANAGERS)
  const base = context.baseTables as Base
  const rows = await every(base, ACCESS_SOURCE, ['source', 'updated_at'])
  return { source: await accessSource(base), switch_rows: rows.map(r => ({ id: exact(r.row_id), source: text(r.source), updated_at: exact(r.updated_at) })),
    can_switch: (context.roles ?? []).includes('System Manager') }
}

/** The switch-over's log, newest first. */
export async function switchOverLog(context: AccessContext) {
  if (!managesAccess(context)) context.reject!(ONLY_MANAGERS)
  const rows = await every(context.baseTables!, SWITCH_OVER_LOG, ['step', 'outcome', 'business_role', 'source_grant', 'detail', 'created_at'])
  return rows.map(r => ({ id: exact(r.row_id), step: text(r.step), outcome: text(r.outcome), detail: text(r.detail), business_role: exact(r.business_role) || null,
    source_grant: exact(r.source_grant) || null, at: exact(r.created_at) })).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
}
