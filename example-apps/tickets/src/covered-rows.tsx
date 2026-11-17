// #1230: the rows a data quality ticket covers, from the instance's Data Quality Row Table.
// Everyone who can see the ticket sees them. A row links to its affected record, and its status to its
// Data Quality Row record (where it is marked fixed), only for a viewer who may open each.
// #1233 (UX spec 7, 10): a table grouped by Table, with progress, fixed rows folded away on a long list.
// #1252: a store user reads them as records to fix (sections, subcategories, assignments), not rows.
import { useState } from 'react'
import { RecordLink } from '@featherbase/shop-floor'
import { display } from './ticket-words'

export const COVERED_TABLE = 'Data Quality Row'
export type CoveredRow = { table: string; row: string; note: string | null; fixed_on: string | null; link: boolean; record: string | null }
export type Covered = { rows: CoveredRow[]; total: number; fixed: number }

/** Past this many rows, fixed ones are folded away until asked for. */
const LONG = 10
const recordWord = (n: number) => `${n} ${n === 1 ? 'record' : 'records'}`
const fixedWord = ({ total, fixed }: Covered) => (fixed === total ? 'all fixed' : `${fixed} fixed`)
export const coveredSummary = (covered: Covered) => `${recordWord(covered.total)} · ${fixedWord(covered)}`
/** The header's fact, under its label "Records To Fix": "14 · 4 fixed". */
export const coveredFact = (covered: Covered) => `${covered.total} · ${fixedWord(covered)}`

/** The rows by their Table, Tables A to Z, each open first then fixed (the server's order within a Table). */
function byTable(rows: CoveredRow[]) {
  const groups = new Map<string, CoveredRow[]>()
  for (const row of rows) groups.set(row.table, [...(groups.get(row.table) ?? []), row])
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export function CoveredRowsCard({ covered, setup }: { covered?: Covered; setup?: string }) {
  const long = (covered?.total ?? 0) > LONG
  const [showFixed, setShowFixed] = useState(!long)
  if (!covered?.rows.length) return setup ? <p className="fine covered-setup" role="note">{setup}</p> : null
  const shown = showFixed ? covered.rows : covered.rows.filter((row) => !row.fixed_on)
  const groups = byTable(covered.rows)
  return (
    <section className="card covered" id="covered-rows" aria-label="Records this ticket covers">
      <div className="covered-head">
        <h3>Records this ticket covers</h3>
        <span className={covered.fixed === covered.total ? 'rules-left tone-text-positive' : 'rules-left'}>{coveredSummary(covered)}</span>
        {covered.fixed > 0 && covered.fixed < covered.total && (
          <button type="button" className="link-button" aria-pressed={showFixed} onClick={() => setShowFixed(!showFixed)}>
            {showFixed ? 'Hide fixed' : `Show fixed (${covered.fixed})`}
          </button>
        )}
      </div>
      <div className="covered-progress" role="progressbar" aria-label="Records fixed" aria-valuemin={0} aria-valuemax={covered.total} aria-valuenow={covered.fixed}>
        <span style={{ width: `${(100 * covered.fixed) / covered.total}%` }} />
      </div>
      <table className="covered-table">
        {/* Fixed widths: the columns hold still when fixed rows are shown or hidden. */}
        <colgroup><col className="col-row" /><col /><col className="col-fixed" /></colgroup>
        <thead>
          <tr><th scope="col">Record</th><th scope="col">What Is Wrong</th><th scope="col">Fixed On</th></tr>
        </thead>
        {groups.map(([table, rows]) => {
          const visible = shown.filter((row) => row.table === table)
          const fixed = rows.filter((row) => row.fixed_on).length
          return (
            <tbody key={table}>
              <tr className="covered-group">
                <th colSpan={3} scope="rowgroup">{table} · {recordWord(rows.length)} · {fixed} fixed</th>
              </tr>
              {visible.map((row) => (
                <tr key={row.row} className={row.fixed_on ? 'covered-row is-fixed' : 'covered-row'}>
                  <td><RecordLink table={row.table} rowId={row.row} name={row.row} canOpen={row.link} className="covered-name" /></td>
                  <td className="covered-note">{row.note ?? ''}</td>
                  <td className="covered-state">
                    {/* The status opens the row's own Data Quality Row record, where it is marked fixed. */}
                    <RecordLink table={COVERED_TABLE} rowId={row.record ?? ''} name={row.fixed_on ? display(row.fixed_on) : 'Open'} canOpen={!!row.record}
                      className={row.fixed_on ? 'pill tone-positive fixed-on' : 'pill tone-caution'} />
                  </td>
                </tr>
              ))}
            </tbody>
          )
        })}
      </table>
    </section>
  )
}
