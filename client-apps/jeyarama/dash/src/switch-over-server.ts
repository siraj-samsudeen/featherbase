// #1277: the action giving old grants to business roles, and the reads of the switch and the log. The steps are switch-over.ts.
import { ACCESS_SOURCE, accessSource } from './access-source.ts'
import { every, type Base } from './business-access.ts'
import { managesAccess, type AccessContext } from './report-access-server.ts'
import { SWITCH_OVER_LOG, giveOldGrantsToRoles, type Writer } from './switch-over.ts'
import { exact, text } from './values.ts'
import { istToday } from './report.ts'

const ONLY_SYSTEM_MANAGERS = 'Only a System Manager can give the old grants to business roles'
const ONLY_MANAGERS = 'Only a Report Access Manager or a System Manager can see what decides Dash access'

/**
 * Give the old grants to business roles, only when a System Manager asks: it decides which reports business roles
 * get, so it is kept to the people who may set the switch. It sets no switch.
 */
export async function giveOldGrantsAction(context: AccessContext) {
  if (!(context.roles ?? []).includes('System Manager')) context.reject!(ONLY_SYSTEM_MANAGERS)
  const reports = await context.documents!.list('dash.report', { fields: ['report_key', 'report_name'], limit_page_length: 500 })
  return giveOldGrantsToRoles(context.baseTables!, context.documents as unknown as Writer, istToday(), new Map(reports.map(r => [exact(r.report_key), text(r.report_name)])))
}

/** What decides Dash access now, and the switch row a System Manager changes to put the old rules back. */
export async function businessAccessSummary(context: AccessContext) {
  if (!managesAccess(context)) context.reject!(ONLY_MANAGERS)
  const base = context.baseTables as Base
  const rows = await every(base, ACCESS_SOURCE, ['source', 'updated_at'])
  return { source: await accessSource(base), switch_rows: rows.map(r => ({ id: exact(r.row_id), source: text(r.source), updated_at: exact(r.updated_at) })),
    can_switch: context.roles!.includes('System Manager') }
}

type Part = string | { record: { table: string; row: string; name: string } }

/** #1282 H1–H4: a log line's own words, each named record in them a link. The words stay as they were
 *  written; a name changed since (or never in them) is left as plain words. */
export function linked(detail: string, records: { table: string; row: string; name: string }[]): Part[] {
  let parts: Part[] = [detail]
  for (const record of records.filter(r => r.name)) {
    parts = parts.flatMap(part => {
      if (typeof part !== 'string' || !part.includes(record.name)) return [part]
      const at = part.indexOf(record.name)
      return [part.slice(0, at), { record }, part.slice(at + record.name.length)].filter(p => p !== '')
    })
  }
  return parts
}

/** The switch-over's log, newest first: each line's words, with the role and the report it names as links. */
export async function switchOverLog(context: AccessContext) {
  if (!managesAccess(context)) context.reject!(ONLY_MANAGERS)
  const rows = await every(context.baseTables!, SWITCH_OVER_LOG, ['step', 'outcome', 'business_role', 'source_grant', 'detail', 'created_at'])
  const roles = new Map((await every(context.baseTables!, 'dash.business_role', ['role_name'])).map(r => [exact(r.row_id), text(r.role_name)]))
  const grants = new Map((await every(context.baseTables!, 'dash.report_access', ['report'])).map(r => [exact(r.row_id), exact(r.report)]))
  const reports = new Map((await context.documents!.list('dash.report', { fields: ['report_key', 'report_name'], limit_page_length: 500 })).map(r => [exact(r.report_key), text(r.report_name)]))
  return rows.map(r => {
    const [role, report] = [exact(r.business_role), grants.get(exact(r.source_grant)) ?? '']
    const records = [
      ...(role && roles.has(role) ? [{ table: 'dash.business_role', row: role, name: roles.get(role)! }] : []),
      ...(report && reports.has(report) ? [{ table: 'dash.report', row: report, name: reports.get(report)! }] : []),
    ]
    return { id: exact(r.row_id), step: text(r.step), outcome: text(r.outcome), detail: text(r.detail), parts: linked(text(r.detail), records), business_role: role || null,
      source_grant: exact(r.source_grant) || null, at: exact(r.created_at) }
  }).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
}
