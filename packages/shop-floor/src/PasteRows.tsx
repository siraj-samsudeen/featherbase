import { useState } from 'react'
import { Button } from './Button'
import { Notice } from './Notice'
import { TABLE_CLASSES, cellClasses, headCellClasses } from './TableLook'
import { pastedCells } from './pasted'

export interface PastedRow { cells: string[]; problem?: string }
export interface PasteChecked<R extends PastedRow = PastedRow> { headings: string[]; rows: R[]; problem?: string }
/** The caller's rule for what was pasted: `cells` includes the heading row. */
export type PasteCheck<R extends PastedRow = PastedRow> = (cells: string[][]) => PasteChecked<R>

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
const titled = (noun: string) => noun.replace(/\b[a-z]/g, letter => letter.toUpperCase())

/**
 * Rows brought in from a spreadsheet: the person copies cells in Excel, headings included,
 * and pastes them into the box. What they pasted comes back as a table with each row's
 * problem said on that row, in the caller's words. Nothing is saved until every row is good,
 * so a sheet is never half in.
 *
 * The caller decides what the cells mean (`check`) and what saving does (`onSave`, which gets
 * the checked rows). `noun` names one saved thing, lower case ("amount", "adjustment").
 */
export function PasteRows<R extends PastedRow = PastedRow>({ label, hint, check, onSave, noun = 'row', saved = rows => rows.length }: {
  label: string
  hint: string
  check: PasteCheck<R>
  onSave: (rows: R[]) => Promise<unknown>
  noun?: string
  /** How many things a save of these rows makes, when it is not one per row. */
  saved?: (rows: R[]) => number
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const cells = pastedCells(text)
  const checked = cells.length ? check(cells) : null
  const bad = checked?.rows.filter(row => row.problem).length ?? 0
  const making = checked ? saved(checked.rows) : 0

  async function save() {
    setBusy(true); setError('')
    try {
      await onSave(checked!.rows)
      setDone(`Saved ${count(making, noun)}.`); setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
        {hint}
        <textarea aria-label={label} value={text} rows={checked ? 3 : 6} spellCheck={false}
          onChange={(event) => { setText(event.target.value); setError(''); setDone('') }}
          className="w-full rounded-control bg-fill px-3 py-2 font-mono text-[13px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus" />
      </label>
      {done && <Notice tone="positive">{done}</Notice>}
      {error && <Notice tone="negative">{error}</Notice>}
      {checked?.problem && <Notice tone="negative">{checked.problem}</Notice>}
      {checked && !checked.problem && <>
        {!error && (bad
          ? <Notice tone="negative">{`${bad} of ${count(checked.rows.length, 'row')} ${bad === 1 ? 'needs' : 'need'} fixing. Correct ${bad === 1 ? 'it' : 'them'} in the sheet and paste again; nothing is saved until every row is good.`}</Notice>
          : <Notice tone="info">{`${count(checked.rows.length, 'row')} ready.`}</Notice>)}
        <div className="max-h-96 max-w-full overflow-auto">
          <table aria-label={`${label}, as pasted`} className={TABLE_CLASSES}>
            <thead className="sticky top-0 z-10">
              <tr>
                <th scope="col" className={headCellClasses({ first: true })}>Row</th>
                {checked.headings.map((heading, index) => <th key={index} scope="col" className={headCellClasses({ last: !bad && index === checked.headings.length - 1 })}>{heading}</th>)}
                {bad > 0 && <th scope="col" className={headCellClasses({ last: true })}>Problem</th>}
              </tr>
            </thead>
            <tbody>
              {checked.rows.map((row, index) => (
                <tr key={index} className="group">
                  <td className={cellClasses({ density: 'compact', first: true, className: 'text-ink-subtle tabular-nums' })}>{index + 1}</td>
                  {checked.headings.map((_, column) => <td key={column} className={cellClasses({ density: 'compact', last: !bad && column === checked.headings.length - 1, className: 'whitespace-nowrap' })}>{row.cells[column] ?? ''}</td>)}
                  {bad > 0 && <td className={cellClasses({ density: 'compact', last: true, className: 'text-negative' })}>{row.problem ?? ''}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div><Button variant="primary" loading={busy} disabled={bad > 0 || !making} onClick={save}>{`Save ${making} ${titled(noun)}${making === 1 ? '' : 's'}`}</Button></div>
      </>}
    </div>
  )
}
