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
  return giveOldGrantsToRoles(context.baseTables!, context.documents as unknown as Writer, istToday(), new Map(reports.map(r => [exact(r.report_key), text(r.report_name)])), text(context.userName) || null)
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

/** Where a name is the record and not words about something else: the line's subject, or what it was
 *  given or mapped "to" ("Mapped the title Buyer to Buyer" names the role second); else its first mention. */
function mention(words: string, name: string, atStart: boolean): number {
  const all: number[] = []
  for (let at = words.indexOf(name); at >= 0; at = words.indexOf(name, at + 1)) all.push(at)
  return all.find(at => (at === 0 && atStart) || words.slice(0, at).endsWith('to ')) ?? all[0] ?? -1
}

/** #1282 H1–H4: a log line's own words, each named record in them a link. The words stay as they were
 *  written; a name changed since (or never in them) is left as plain words. */
export function linked(detail: string, records: { table: string; row: string; name: string }[]): Part[] {
  let parts: Part[] = [detail]
  for (const record of records.filter(r => r.name)) {
    let done = false
    parts = parts.flatMap((part, i) => {
      if (done || typeof part !== 'string') return [part]
      const at = mention(part, record.name, i === 0)
      if (at < 0) return [part]
      done = true
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
  const grants = new Map((await every(context.baseTables!, 'dash.report_access', ['report', 'report_bundle'])).map(r => [exact(r.row_id), r]))
  const reports = new Map((await context.documents!.list('dash.report', { fields: ['report_key', 'report_name'], limit_page_length: 500 })).map(r => [exact(r.report_key), text(r.report_name)]))
  // As the caller may read them (Codex adversarial round 2): a bundle they may not read is neither linked nor named by id.
  const bundles = new Map((await context.documents!.list('dash.report_bundle', { fields: ['row_id', 'bundle_name'], limit_page_length: 500 })).map(r => [exact(r.row_id), text(r.bundle_name)]))
  return rows.map(r => {
    const role = exact(r.business_role)
    const grant = grants.get(exact(r.source_grant))
    const [report, bundle] = [exact(grant?.report), exact(grant?.report_bundle)]
    const records = [
      ...(role && roles.has(role) ? [{ table: 'dash.business_role', row: role, name: roles.get(role)! }] : []),
      ...(report && reports.has(report) ? [{ table: 'dash.report', row: report, name: reports.get(report)! }] : []),
      ...(!report && bundle && bundles.has(bundle) ? [{ table: 'dash.report_bundle', row: bundle, name: bundles.get(bundle)! }] : []),
    ]
    return { id: exact(r.row_id), step: text(r.step), outcome: text(r.outcome), detail: text(r.detail), parts: linked(text(r.detail), records), business_role: role || null,
      source_grant: exact(r.source_grant) || null, at: exact(r.created_at) }
  }).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
}
