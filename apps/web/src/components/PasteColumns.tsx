// #151: type (or paste) the columns as a list — the way you'd write a
// spreadsheet header row — instead of adding grid rows one by one. First
// line = column labels (comma-, tab- or newline-separated); further lines
// are sample rows fed to the same type inference the CSV import uses.
import { useMemo, useState } from 'react'
import { inferColumnType } from 'shared'
import { slugify } from '../lib/column-rules'

export interface PastedColumn {
  label: string
  column_name: string
  column_type: string
}

function splitLine(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : ','
  return line.split(sep).map((s) => s.trim()).filter(Boolean)
}

// #151: shown as the placeholder, filled by Tab or "Try a sample" — so the
// inference can be SEEN working before the user commits their own columns.
const SAMPLE = [
  'Employee Name, Date of Birth, Salary, Department',
  'Ravi Kumar, 12/03/1990, 45000, Stores',
  'Meena S, 04/11/1988, 52000, Accounts',
].join('\n')

export function PasteColumns({ onBuild }: { onBuild: (cols: PastedColumn[]) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  const preview = useMemo<PastedColumn[]>(() => {
    const lines = text.split('\n').filter((l) => l.trim())
    if (!lines.length) return []
    const headers = splitLine(lines[0])
    const samples = lines.slice(1).map(splitLine)
    return headers.map((h, i) => ({
      label: h,
      column_name: slugify(h),
      column_type: samples.length
        ? inferColumnType(samples.map((r) => r[i]).filter((v) => v !== undefined))
        : 'Data',
    }))
  }, [text])

  if (!open)
    return (
      <button
        data-testid="dt-paste-open"
        onClick={() => setOpen(true)}
        className="mb-3 text-xs text-[var(--color-ink-muted)] underline decoration-[var(--color-border-strong)] underline-offset-2 hover:text-[var(--color-brand)]"
      >
        Or paste the columns as a list — like a spreadsheet header row
      </button>
    )

  return (
    <div className="fc-card mb-4 p-4" data-testid="dt-paste">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
          Columns from a list
        </span>
        <button
          aria-label="Close paste box"
          onClick={() => {
            setOpen(false)
            setText('')
          }}
          className="rounded px-1.5 text-sm text-[var(--color-ink-faint)] transition hover:bg-[var(--color-subtle)]"
        >
          ✕
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Tab completes the placeholder sample while the box is empty —
          // one keypress shows the inference working end to end.
          if (e.key === 'Tab' && !text.trim()) {
            e.preventDefault()
            setText(SAMPLE)
          }
        }}
        rows={4}
        data-testid="dt-paste-text"
        placeholder={SAMPLE}
        className="fc-input font-mono text-sm"
        autoFocus
      />
      <p className="mt-1 flex items-center gap-2 text-xs text-[var(--color-ink-faint)]">
        <span>
          First line: the column names. Optional further lines: sample data, used to guess each type.
        </span>
        {text.trim() ? (
          <button
            data-testid="dt-paste-clear"
            onClick={() => setText('')}
            className="shrink-0 font-medium text-[var(--color-ink-muted)] underline hover:text-[var(--color-brand)]"
          >
            Clear
          </button>
        ) : (
          <button
            data-testid="dt-paste-sample"
            onClick={() => setText(SAMPLE)}
            className="shrink-0 font-medium text-[var(--color-ink-muted)] underline hover:text-[var(--color-brand)]"
          >
            Try a sample (or press Tab)
          </button>
        )}
      </p>
      {preview.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {preview.map((p, i) => (
            <span key={i} className="fc-pill border border-[var(--color-border-strong)] text-[var(--color-ink-muted)]">
              {p.label}&ensp;·&ensp;{p.column_type}
            </span>
          ))}
        </div>
      )}
      <button
        data-testid="dt-paste-build"
        onClick={() => {
          onBuild(preview)
          setOpen(false)
          setText('')
        }}
        disabled={!preview.length}
        className="fc-btn mt-3"
      >
        Add these columns →
      </button>
    </div>
  )
}
