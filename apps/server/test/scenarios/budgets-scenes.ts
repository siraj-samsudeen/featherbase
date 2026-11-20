// What the Budgets scenario files share (#1380): the installed app with its made-up world, and
// the few questions and steps more than one scenario asks.
import type { Line, Version } from '../../../../client-apps/jeyarama/budgets/src/plRules'
import { versionInForce } from '../../../../client-apps/jeyarama/budgets/src/plRules'
import { setup, type Create, type Row } from '../jeyarama-budgets-world'

export type { Line, Row }
export const start = (createUser: unknown) => setup(createUser as Create)
export type World = Awaited<ReturnType<typeof start>>
export const figures = (w: World, version: string) => w.rows('pl_budget', [['budget_version', '=', version]])
export const manpowerInOctober = async (w: World, version: string) =>
  (await figures(w, version)).filter(row => row.plant === '9003' && row.pl_line === w.made.manpower.row_id && String(row.budget_month).startsWith('2026-10')).map(row => Number(row.amount))
export const approve = (w: World, version: string) => w.act(w.editor, 'approve_version', { version })
export const budgetFor = async (w: World, month: string) => {
  const versions = (await w.rows('budget_version')).map(v => ({ ...v, covers_from: String(v.covers_from).slice(0, 10), covers_to: String(v.covers_to).slice(0, 10), approved_at: v.approved_at ? new Date(String(v.approved_at)).toISOString() : null })) as unknown as (Version & Row)[]
  return versionInForce(versions, 'P&L', 'North', month)?.version_name
}
/** FY27 Revision 1, a draft for October to March, made a moment after the original was approved. */
export async function revision(w: World) {
  await approve(w, w.made.version.row_id)
  const { version } = await w.act<{ version: string }>(w.editor, 'revise_version', { version: w.made.version.row_id, version_name: 'FY27 Revision 1', covers_from: '2026-10-01', covers_to: '2027-03-01' })
  return version
}
