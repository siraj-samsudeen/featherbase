// NAM-001: edit a Table's id_pattern — the rule that names new rows. The four
// kinds mirror resolveName() in apps/server/src/document.ts; a series is split
// here into a prefix and a digit count so nobody has to type ".###".

export type NamingKind = 'series' | 'hash' | 'prompt' | 'field'

const KINDS: { value: NamingKind; label: string }[] = [
  { value: 'series', label: 'Series with prefix' },
  { value: 'hash', label: 'Random' },
  { value: 'prompt', label: 'Set by user' },
  { value: 'field', label: 'From a column' },
]

interface Parsed {
  kind: NamingKind
  prefix: string
  digits: number
  column: string
}

export function parseIdPattern(pattern: string): Parsed {
  const base: Parsed = { kind: 'hash', prefix: '', digits: 3, column: '' }
  if (pattern === 'prompt') return { ...base, kind: 'prompt' }
  if (pattern.startsWith('field:'))
    return { ...base, kind: 'field', column: pattern.slice('field:'.length) }
  // dot at 0 is a series whose prefix isn't filled in yet (the builder's
  // opening state) — composeIdPattern turns that back into 'hash', so an
  // empty prefix can never reach the server.
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

export function composeIdPattern(p: Parsed): string {
  if (p.kind === 'prompt') return 'prompt'
  if (p.kind === 'field') return p.column ? `field:${p.column}` : 'hash'
  if (p.kind === 'series') return p.prefix ? `${p.prefix}.${'#'.repeat(p.digits)}` : 'hash'
  return 'hash'
}

export function namingPreview(pattern: string): string {
  const p = parseIdPattern(pattern)
  if (p.kind === 'prompt') return 'You type each row’s name yourself'
  if (p.kind === 'field')
    return p.column
      ? `Each row is named after its ${p.column} value`
      : 'Pick the column to name rows after'
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

  return (
    <>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <select
          value={p.kind}
          onChange={(e) => {
            const kind = e.target.value as NamingKind
            set({ kind, prefix: kind === 'series' && !p.prefix ? defaultPrefix : p.prefix })
          }}
          data-testid={`${idPrefix}-naming`}
          className="fc-input w-48"
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        {p.kind === 'series' && (
          <>
            <input
              value={p.prefix}
              onChange={(e) => set({ prefix: e.target.value })}
              data-testid={`${idPrefix}-naming-prefix`}
              placeholder="Prefix, e.g. ZONE-"
              className="fc-input w-40"
            />
            <select
              value={p.digits}
              onChange={(e) => set({ digits: Number(e.target.value) })}
              data-testid={`${idPrefix}-naming-digits`}
              className="fc-input w-32"
            >
              {[1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {String(1).padStart(d, '0')}, {String(2).padStart(d, '0')}…
                </option>
              ))}
            </select>
          </>
        )}
        {p.kind === 'field' && (
          <select
            value={p.column}
            onChange={(e) => set({ column: e.target.value })}
            data-testid={`${idPrefix}-naming-column`}
            className="fc-input w-48"
          >
            <option value="">Choose a column…</option>
            {columns.map((c) => (
              <option key={c.column_name} value={c.column_name}>
                {c.label || c.column_name}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="text-xs text-gray-500" data-testid={`${idPrefix}-naming-preview`}>
        {namingPreview(value)}
      </p>
    </>
  )
}
