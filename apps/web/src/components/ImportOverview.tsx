import { countDataRows, type ParsedSheet } from '../lib/parse-file'

// #199/#200 (issue #197): the step before any column work. A 17-sheet
// workbook used to open straight onto 17 full column grids; this answers
// "what is in this file?" first, and nothing else.
//
// Two rules the owner set, and the reasons they are rules:
//
//  - **Nothing is selected when this opens.** The wizard used to include
//    every sheet by default, which is how one import created eleven unwanted
//    Tables. Leaving a sheet alone is now how you exclude it — there is no
//    skip to find.
//  - **Hidden sheets are shown, not filtered.** In their own section, saying
//    so, because they are usually lookups and scratch calculations. The
//    section collapses (and starts collapsed) so they cost no screen space
//    until wanted.

const SHAPE_HINT_COLUMNS = 6 // headers named inline before eliding the rest

export interface OverviewProps {
  fileName: string
  sheets: ParsedSheet[]
  selected: boolean[]
  onSelect: (next: boolean[]) => void
  onContinue: () => void
  refused: boolean
}

function shapeHint(headers: string[]): string {
  const named = headers.filter((h) => h.trim()).slice(0, SHAPE_HINT_COLUMNS)
  const more = headers.length - named.length
  if (!named.length) return 'no column names in the header row'
  return named.join(' · ') + (more > 0 ? ` · +${more} more` : '')
}

function SheetRow({
  sheet,
  index,
  on,
  onToggle,
}: {
  sheet: ParsedSheet
  index: number
  on: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <label
      className="flex cursor-pointer items-start gap-2 border-t border-[var(--color-border)] px-3 py-2 hover:bg-[var(--color-subtle)]"
      data-testid={`iw-ov-row-${index}`}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onToggle(e.target.checked)}
        data-testid={`iw-ov-sheet-${index}`}
        className="mt-1 shrink-0 accent-[var(--color-brand)]"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-ink)]">
          {sheet.sheetName}
          {sheet.visibility !== 'visible' && (
            <span className="fc-pill border border-[var(--color-border-strong)] bg-[var(--color-subtle)] text-[var(--color-ink-muted)]">
              {sheet.visibility === 'very-hidden' ? 'very hidden' : 'hidden'}
            </span>
          )}
          <span className="text-xs font-normal text-[var(--color-ink-muted)] tabular-nums">
            {countDataRows(sheet.rows).toLocaleString()} rows · {sheet.headers.length} columns
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-[var(--color-ink-faint)]">
          {shapeHint(sheet.headers)}
        </span>
      </span>
    </label>
  )
}

// One section of the list. `defaultOpen` is false for the hidden group: it is
// usually noise, and a collapsed section still reports its count.
function Section({
  kind,
  label,
  entries,
  selected,
  onSet,
  defaultOpen,
}: {
  kind: 'visible' | 'hidden'
  label: string
  entries: { sheet: ParsedSheet; index: number }[]
  selected: boolean[]
  onSet: (next: boolean[]) => void
  defaultOpen: boolean
}) {
  if (!entries.length) return null
  const allOn = entries.every((e) => selected[e.index])
  const rows = entries.reduce((n, e) => n + countDataRows(e.sheet.rows), 0)

  function setGroup(on: boolean) {
    const next = [...selected]
    entries.forEach((e) => {
      next[e.index] = on
    })
    onSet(next)
  }

  return (
    <details open={defaultOpen} data-testid={`iw-ov-section-${kind}`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-3 py-2 hover:bg-[var(--color-subtle)]">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          {label} ({entries.length})
        </span>
        <span className="text-xs text-[var(--color-ink-muted)] tabular-nums">
          {rows.toLocaleString()} rows
        </span>
        <button
          type="button"
          // Inside a <summary>, so a plain click would also toggle the
          // disclosure — the button acts, the disclosure stays put.
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setGroup(!allOn)
          }}
          data-testid={`iw-ov-all-${kind}`}
          className="fc-btn ml-auto py-0.5 text-xs"
        >
          {allOn ? 'Clear all' : 'Select all'}
        </button>
      </summary>
      {kind === 'hidden' && (
        <p className="px-3 pb-1 text-xs text-[var(--color-ink-faint)]">
          These were hidden in the workbook.
        </p>
      )}
      {entries.map((e) => (
        <SheetRow
          key={e.index}
          sheet={e.sheet}
          index={e.index}
          on={selected[e.index]}
          onToggle={(on) => {
            const next = [...selected]
            next[e.index] = on
            onSet(next)
          }}
        />
      ))}
    </details>
  )
}

export function ImportOverview({
  fileName,
  sheets,
  selected,
  onSelect,
  onContinue,
  refused,
}: OverviewProps) {
  const entries = sheets.map((sheet, index) => ({ sheet, index }))
  const visible = entries.filter((e) => e.sheet.visibility === 'visible')
  const hidden = entries.filter((e) => e.sheet.visibility !== 'visible')
  const chosen = selected.filter(Boolean).length
  const chosenRows = entries.reduce(
    (n, e) => n + (selected[e.index] ? countDataRows(e.sheet.rows) : 0),
    0,
  )

  return (
    <div className="fc-card" data-testid="iw-overview">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[var(--color-ink)]">
          <input
            type="checkbox"
            checked={chosen === sheets.length && sheets.length > 0}
            // Tri-state: a partial selection reports itself rather than
            // pretending to be one of the two extremes.
            ref={(el) => {
              if (el) el.indeterminate = chosen > 0 && chosen < sheets.length
            }}
            onChange={(e) => onSelect(sheets.map(() => e.target.checked))}
            data-testid="iw-ov-master"
            className="accent-[var(--color-brand)]"
          />
          Select all
        </label>
        <span
          className="ml-auto text-xs text-[var(--color-ink-muted)] tabular-nums"
          data-testid="iw-ov-count"
        >
          {chosen} of {sheets.length} sheets selected
        </span>
      </div>

      {/* Visible first and expanded; hidden below and collapsed. When a
          workbook has no hidden sheets the second section renders nothing at
          all, so the sectioning appears only when it carries information. */}
      <Section
        kind="visible"
        label={hidden.length ? 'Visible sheets' : 'Sheets'}
        entries={visible}
        selected={selected}
        onSet={onSelect}
        defaultOpen
      />
      <Section
        kind="hidden"
        label="Hidden sheets"
        entries={hidden}
        selected={selected}
        onSet={onSelect}
        defaultOpen={false}
      />

      {/* The action bar follows the list down: a 17-row list must not put its
          own controls below the fold. */}
      <div className="sticky bottom-0 rounded-b-[var(--radius-card)] border-t border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[0_-6px_16px_rgba(25,39,52,0.09)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-2 text-xs text-[var(--color-ink-muted)] tabular-nums">
          <span data-testid="iw-ov-tally">
            <strong className="text-[var(--color-ink)]">{chosen}</strong> selected ·{' '}
            <strong className="text-[var(--color-ink)]">{chosenRows.toLocaleString()}</strong> rows
            will be imported ·{' '}
            <strong className="text-[var(--color-ink)]">{sheets.length - chosen}</strong> left out
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-3 py-3">
          <button
            type="button"
            onClick={onContinue}
            data-testid="iw-ov-continue"
            className="fc-btn-primary"
          >
            Continue to columns →
          </button>
          {refused ? (
            <span className="text-sm text-[var(--color-danger)]" data-testid="iw-ov-refusal">
              Pick at least one sheet to import.
            </span>
          ) : (
            <span className="text-xs text-[var(--color-ink-muted)]">
              {chosen === 0
                ? `Nothing from ${fileName} is selected yet.`
                : 'Sheets you leave unselected are not imported.'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
