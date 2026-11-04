import { DEFAULT_ID_PATTERN, columnNamingPattern, namingColumn } from 'shared'
import { inputClasses } from '@featherbase/shop-floor'
// NAM-001: edit a Table's id_pattern — the rule that names new rows. The
// kinds mirror resolveRowId() in apps/server/src/document.ts; a series is split
// here into a prefix and a digit count so nobody has to type ".###".


type NamingKind = 'integer' | 'series' | 'hash' | 'prompt' | 'field'

// The generated kinds. 'field' is deliberately absent: naming a row after a
// column IS picking that column, so the columns appear as options in this same
// select rather than behind a second one. One dropdown, one decision.
const KINDS: { value: NamingKind; label: string }[] = [
  { value: 'integer', label: 'Numbers 1, 2, 3' },
  { value: 'series', label: 'Series with prefix' },
  { value: 'hash', label: 'Random id' },
  { value: 'prompt', label: 'Set by user' },
]

interface Parsed {
  kind: NamingKind
  prefix: string
  digits: number
  column: string
}

function parseIdPattern(pattern: string): Parsed {
  const base: Parsed = { kind: 'hash', prefix: '', digits: 3, column: '' }
  if (pattern === 'integer') return { ...base, kind: 'integer' }
  if (pattern === 'prompt') return { ...base, kind: 'prompt' }
  // #858: a column rule may put fixed text before the value (PLANT-{plant_code}).
  const naming = namingColumn(pattern)
  if (naming) return { ...base, kind: 'field', ...naming }
  // dot at 0 is a series whose prefix isn't filled in yet (the user cleared it
  // to type another). It stays a series here; the server refuses it on save
  // and says the prefix is missing.
  const dot = pattern.indexOf('.')
  if (dot >= 0 && /^#+$/.test(pattern.slice(dot + 1)))
    return {
      kind: 'series',
      prefix: pattern.slice(0, dot),
      digits: pattern.length - dot - 1,
      column: '',
    }
  return base
}

function composeIdPattern(p: Parsed): string {
  if (p.kind === 'prompt') return 'prompt'
  if (p.kind === 'hash') return 'hash'
  if (p.kind === 'field' && p.column) return columnNamingPattern(p.prefix, p.column)
  if (p.kind === 'series') return `${p.prefix}.${'#'.repeat(p.digits)}`
  return DEFAULT_ID_PATTERN
}

function namingPreview(pattern: string, labelOf: (column: string) => string): string {
  const p = parseIdPattern(pattern)
  if (p.kind === 'integer') return 'Rows will be numbered 1, 2, 3 …'
  if (p.kind === 'prompt') return 'You type each row’s id yourself'
  if (p.kind === 'field')
    return !p.column
      ? 'Pick the column to take ids from'
      : p.prefix
        ? `Ids look like ${p.prefix}‹${labelOf(p.column)}›`
        : `Each row takes its id from ${labelOf(p.column)}`
  if (p.kind === 'series' && !p.prefix) return 'Type the prefix every id starts with'
  if (p.kind === 'series')
    return `First rows: ${[1, 2, 3].map((n) => p.prefix + String(n).padStart(p.digits, '0')).join(', ')}…`
  return 'Rows get a random id, e.g. a0373bac75'
}

export function NamingControl({
  value,
  onChange,
  columns,
  defaultPrefix,
  idPrefix = 'dt',
}: {
  value: string
  onChange: (pattern: string) => void
  columns: { column_name: string; label: string }[]
  // Used when the user switches to a series and no prefix exists yet.
  defaultPrefix: string
  idPrefix?: string
}) {
  const p = parseIdPattern(value)
  const set = (patch: Partial<Parsed>) => onChange(composeIdPattern({ ...p, ...patch }))
  // A column pick is encoded in the same select as the kinds.
  const selected = p.kind === 'field' && p.column ? `field:${p.column}` : p.kind

  return (
    <>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => {
            const v = e.target.value
            // A series prefix is not carried into a column rule; another
            // column of the same rule keeps its prefix.
            if (v.startsWith('field:'))
              return set({ kind: 'field', column: v.slice('field:'.length), prefix: p.kind === 'field' ? p.prefix : '' })
            const kind = v as NamingKind
            set({ kind, prefix: kind === 'series' && !p.prefix ? defaultPrefix : p.prefix })
          }}
          data-testid={`${idPrefix}-naming`}
          className={inputClasses('w-52')}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
          {columns.length > 0 && (
            <optgroup label="From a column">
              {columns.map((c) => (
                <option key={c.column_name} value={`field:${c.column_name}`}>
                  {c.label || c.column_name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {p.kind === 'field' && p.column && (
          <input
            value={p.prefix}
            onChange={(e) => set({ prefix: e.target.value })}
            data-testid={`${idPrefix}-naming-prefix`}
            placeholder="Prefix, optional, e.g. PLANT-"
            aria-label="Prefix before the column value"
            className={inputClasses('w-48')}
          />
        )}
        {p.kind === 'series' && (
          <>
            <input
              value={p.prefix}
              onChange={(e) => set({ prefix: e.target.value })}
              data-testid={`${idPrefix}-naming-prefix`}
              placeholder="Prefix, e.g. ZONE-"
              className={inputClasses('w-40')}
            />
            <select
              value={p.digits}
              onChange={(e) => set({ digits: Number(e.target.value) })}
              data-testid={`${idPrefix}-naming-digits`}
              className={inputClasses('w-32')}
            >
              {[1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {String(1).padStart(d, '0')}, {String(2).padStart(d, '0')}…
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <p className="text-xs text-ink-muted" data-testid={`${idPrefix}-naming-preview`}>
        {namingPreview(value, (column) => columns.find((c) => c.column_name === column)?.label || column)}
      </p>
    </>
  )
}
