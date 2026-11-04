// The people rules a single row cannot check (featherbase#928). Employment:
// a person's stints at one company never overlap, and one company's employee
// number names one person; refused at save (validators.ts). Time: a person's
// job assignments never take more than all of their time; listed on the
// conflict list like the org chart's other rules across rows (conflicts.ts).
import { checked, day, exact, holdsOn, text } from './values.ts'

type Row = Record<string, unknown>
export interface Problem { message: string; field: string }

const FOREVER = '9999-12-31'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** A calendar day as people read it: 01-Aug-2026. */
export function shown(on: string): string {
  const [y, m, d] = on.split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}
const sameRow = (a: Row, b: Row) => !!exact(a.row_id) && exact(a.row_id) === exact(b.row_id)

/** Employment: what is wrong with `row` given the person's other stints and the company's rows with its number. */
export function employmentProblem(row: Row, others: Row[]): Problem | null {
  const rest = others.filter(o => !sameRow(o, row))
  const company = exact(row.legal_company)
  const start = day(row.joined_on)
  const end = day(row.left_on) || FOREVER
  for (const other of rest) {
    if (exact(other.employee) !== exact(row.employee) || exact(other.legal_company) !== company) continue
    const [os, oe] = [day(other.joined_on), day(other.left_on) || FOREVER]
    if (start < oe && os < end)
      return { field: 'joined_on', message: `This overlaps the person's stint at ${company} from ${shown(os)}${oe === FOREVER ? ', still current' : ` to ${shown(oe)}`}: a rejoin starts on or after the day the last stint ended` }
  }
  const number = exact(row.employee_number)
  if (rest.some(o => exact(o.legal_company) === company && exact(o.employee_number) === number && exact(o.employee) !== exact(row.employee)))
    return { field: 'employee_number', message: `Employee number ${number} at ${company} already belongs to another person` }
  return null
}

const share = (row: Row) => Number(row.percentage ?? 0)
const EPSILON = 1e-9
const round = (n: number) => Math.round(n * 100) / 100
export type TimeProblemKind = 'several_primary_assignments' | 'time_over_100_percent' | 'deployment_over_primary_share'

/**
 * A person's time on `on`, from all their job assignment rows in any store: at most one Primary;
 * Primary and Secondary together at most 100%; temporary deployments at most the Primary's share,
 * which they are taken out of. Acting cover is on top of a person's own job and takes no share,
 * and a row with no assignment type (written before there was one) is left out.
 */
export function timeProblem(rows: Row[], on: string): { kind: TimeProblemKind; message: string; rows: Row[] } | null {
  const current = rows.filter(r => !checked(r.acting) && holdsOn(r, on) && text(r.assignment_type))
  const of = (type: string) => current.filter(r => text(r.assignment_type) === type)
  const sum = (list: Row[]) => list.reduce((total, r) => total + share(r), 0)
  const primary = of('Primary')
  if (primary.length > 1)
    return { kind: 'several_primary_assignments', rows: primary, message: `has ${primary.length} Primary assignments on ${shown(on)}: one home assignment at a time` }
  const standing = [...primary, ...of('Secondary')]
  if (sum(standing) > 100 + EPSILON)
    return { kind: 'time_over_100_percent', rows: standing, message: `has Primary and Secondary assignments taking ${round(sum(standing))}% of their time on ${shown(on)}: at most 100%` }
  const deployed = of('Temporary deployment')
  if (sum(deployed) > sum(primary) + EPSILON)
    return { kind: 'deployment_over_primary_share', rows: [...primary, ...deployed], message: primary.length
      ? `has temporary deployments taking ${round(sum(deployed))}% of their time on ${shown(on)}, more than the ${round(sum(primary))}% of the Primary assignment they are taken from`
      : `is on a temporary deployment on ${shown(on)} with no Primary assignment to be deployed from` }
  return null
}
