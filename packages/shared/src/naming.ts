// #855: the naming rule a new Table starts with when its maker picks none:
// plain numbers 1, 2, 3, counted per Table. The server's createTable and the
// web's builder and import wizard all read it from here.
export const DEFAULT_ID_PATTERN = 'integer'

// #858: the two rules that name a row after one of its own columns:
// `field:<column>` (the value alone) and `<prefix>{<column>}` (fixed text,
// then the value, e.g. PLANT-{plant_code} names a row PLANT-8151). The server
// resolves both; the builder, Naming page and form read them through here.
const PREFIXED = /^([^{}]+)\{([^{}]+)\}$/

export function namingColumn(pattern: string | null | undefined): { prefix: string; column: string } | null {
  if (!pattern) return null
  if (pattern.startsWith('field:')) return { prefix: '', column: pattern.slice('field:'.length) }
  const match = PREFIXED.exec(pattern)
  return match ? { prefix: match[1], column: match[2] } : null
}

export function columnNamingPattern(prefix: string, column: string): string {
  return prefix ? `${prefix}{${column}}` : `field:${column}`
}

// The id a value of the naming column gives, or null for a blank value.
export function idFromColumn(prefix: string, value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text ? prefix + text : null
}

// The rule after its naming column is renamed; any other rule is unchanged.
export function renameNamingColumn<P extends string | null | undefined>(pattern: P, from: string, to: string): P | string {
  const naming = namingColumn(pattern)
  return naming?.column === from ? columnNamingPattern(naming.prefix, to) : pattern
}
