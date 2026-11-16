// #1230: the rows a data quality ticket covers, from the instance's Data Quality Row Table.
// Everyone who can see the ticket sees them. A row links to its affected record, and its status to its
// Data Quality Row record (where it is marked fixed), only for a viewer who may open each.
import { useState } from 'react'
import { RecordLink } from './record-link'
import { display } from './ticket-words'

export const COVERED_TABLE = 'Data Quality Row'
export type CoveredRow = { table: string; row: string; note: string | null; fixed_on: string | null; link: boolean; record: string | null }
export type Covered = { rows: CoveredRow[]; total: number; fixed: number }

const FIRST = 10
const rowWord = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`
export const coveredSummary = ({ total, fixed }: Covered) =>
  `${rowWord(total)} · ${fixed === total ? 'all fixed' : `${fixed} fixed`}`

export function CoveredRowsCard({ covered, setup }: { covered?: Covered; setup?: string }) {
  const [all, setAll] = useState(false)
  if (!covered?.rows.length) return setup ? <p className="fine covered-setup" role="note">{setup}</p> : null
  const shown = all ? covered.rows : covered.rows.slice(0, FIRST)
  return (
    <section className="card covered" aria-label="Rows this ticket covers">
      <div className="rules-heading">
        <h3>Rows this ticket covers</h3>
        <span className={covered.fixed === covered.total ? 'rules-left tone-text-positive' : 'rules-left'}>{coveredSummary(covered)}</span>
      </div>
      <ul className="covered-list">
        {shown.map((row) => (
          <li key={`${row.table}\u0000${row.row}`} className={row.fixed_on ? 'covered-row is-fixed' : 'covered-row'}>
            <div className="covered-what">
              <span className="covered-table">{row.table}</span>
              <RecordLink table={row.table} id={row.row} open={row.link} className="covered-name">{row.row}</RecordLink>
            </div>
            {row.note && <p className="covered-note">{row.note}</p>}
            <RecordLink table={COVERED_TABLE} id={row.record} open={!!row.record} label={`Data Quality Row for ${row.row}`}
              className={row.fixed_on ? 'covered-state tone-text-positive' : 'covered-state'}>
              {row.fixed_on ? `Fixed ${display(row.fixed_on)}` : 'Open'}
            </RecordLink>
          </li>
        ))}
      </ul>
      {covered.rows.length > FIRST && (
        <button type="button" className="secondary" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? `Show the first ${FIRST}` : `Show all ${covered.rows.length}`}
        </button>
      )}
    </section>
  )
}
