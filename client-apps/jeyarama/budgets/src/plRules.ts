// The P&L's arithmetic, kept free of the server and the screen so both use the same sums.

export interface Line {
  row_id: string
  line_name: string
  level: 'Working' | 'Published'
  rolls_into: string | null
  line_order: number
  section: 'Sales' | 'Margin' | 'Store Opex' | 'Below Store EBITDA' | 'Below EBITDA'
  line_kind: 'Posted' | 'Allocated' | 'Standing Charge' | 'Subtotal' | 'Memo'
  sign: 'Income' | 'Cost'
  subtotal_rule: 'Running Total' | 'Section Total' | null
}

export interface StatementRow { line: Line; amount: number; working: { line: Line; amount: number }[] }

const byOrder = (a: Line, b: Line) => a.line_order - b.line_order
const paise = (amount: number) => Math.round(amount * 100) / 100

/**
 * The P&L for one set of amounts (a store and month, or any total of them): published lines
 * in order, each with its working lines, and every subtotal worked out. `amounts` is keyed by
 * line; a cost is a positive amount.
 */
export function statement(lines: Line[], amounts: ReadonlyMap<string, number>): StatementRow[] {
  const published = lines.filter(line => line.level === 'Published').sort(byOrder)
  const rows: StatementRow[] = published.map((line) => {
    const working = lines.filter(w => w.level === 'Working' && w.rolls_into === line.row_id).sort(byOrder)
      .map(w => ({ line: w, amount: amounts.get(w.row_id) ?? 0 }))
    const rolled = working.reduce((sum, w) => sum + (w.line.sign === line.sign ? w.amount : -w.amount), 0)
    return { line, working, amount: paise((amounts.get(line.row_id) ?? 0) + rolled) }
  })
  for (const [index, row] of rows.entries()) {
    if (row.line.line_kind !== 'Subtotal') continue
    const counted = rows.slice(0, index).filter(above => above.line.line_kind !== 'Subtotal' && above.line.line_kind !== 'Memo'
      && (row.line.subtotal_rule !== 'Section Total' || above.line.section === row.line.section))
    row.amount = paise(counted.reduce((sum, above) => sum + (above.line.sign === row.line.sign ? above.amount : -above.amount), 0))
  }
  return rows
}

export interface Version {
  row_id: string
  budget_kind: 'P&L' | 'Sales'
  operating_region: string | null
  covers_from: string
  covers_to: string
  version_state: 'Draft' | 'Approved' | 'Withdrawn'
  /** The instant it was approved: of two approved the same day, the later one is in force. */
  approved_at: string | null
}

const month = (day: string) => day.slice(0, 7)

/** The budget for a month: the latest approved version of that kind covering it, for the region or for every region. */
export function versionInForce<V extends Version>(versions: V[], kind: Version['budget_kind'], region: string | null, monthStart: string): V | undefined {
  return versions
    .filter(v => v.version_state === 'Approved' && v.budget_kind === kind && (!v.operating_region || v.operating_region === region)
      && month(v.covers_from) <= month(monthStart) && month(monthStart) <= month(v.covers_to))
    .sort((a, b) => (b.approved_at ?? '').localeCompare(a.approved_at ?? '') || b.row_id.localeCompare(a.row_id))[0]
}

/** Each month's version in force; a month no version covers is left out. */
export function budgetInForce(versions: Version[], kind: Version['budget_kind'], region: string | null, months: string[]): Map<string, string> {
  const result = new Map<string, string>()
  for (const monthStart of months) {
    const version = versionInForce(versions, kind, region, monthStart)
    if (version) result.set(monthStart, version.row_id)
  }
  return result
}

const first = (year: number, monthIndex: number) => `${year + Math.floor(monthIndex / 12)}-${String((monthIndex % 12) + 1).padStart(2, '0')}-01`

/** The twelve months, April to March, of the fiscal year a month falls in. */
export function fiscalMonths(monthStart: string): string[] {
  const [year, monthNo] = [Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7))]
  const start = monthNo >= 4 ? year : year - 1
  return Array.from({ length: 12 }, (_, i) => first(start, 3 + i))
}

/** Every month from one to another, both in. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  const [year, monthNo] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
  for (let i = 0; first(year, monthNo - 1 + i).slice(0, 7) <= to.slice(0, 7) && i < 240; i++) months.push(first(year, monthNo - 1 + i))
  return months
}

/** What is left of an adjustment once part of it is matched to an SAP posting. */
export function remaining(amount: number, matched: number | null): { remaining: number; settled: boolean } {
  const left = paise(amount - (matched ?? 0))
  return { remaining: left, settled: left === 0 }
}

export interface FigureRowData { id: string; label: string; values: Record<string, number>; strong?: boolean; quiet?: boolean; children?: FigureRowData[] }

/**
 * The statement across several columns (stores, months, versions): one row per published
 * line with a figure per column, its working lines folded under it, and, when `totalId` is
 * given, a column that adds the others. Each column's subtotals are worked out from that
 * column's own amounts, and the total's from the summed amounts, so every column foots.
 */
export function statementRows(lines: Line[], columns: { id: string; amounts: ReadonlyMap<string, number> }[], totalId?: string): FigureRowData[] {
  const all = totalId ? [...columns, { id: totalId, amounts: columns.reduce((sum, column) => add(sum, column.amounts), new Map<string, number>()) }] : columns
  const statements = all.map(column => ({ id: column.id, rows: statement(lines, column.amounts) }))
  return statements[0]?.rows.map((first, index) => {
    const values = Object.fromEntries(statements.map(s => [s.id, s.rows[index].amount]))
    const children = first.working
      .map((working, w) => ({ id: working.line.row_id, label: working.line.line_name, values: Object.fromEntries(statements.map(s => [s.id, s.rows[index].working[w].amount])) }))
      .filter(child => Object.values(child.values).some(amount => amount !== 0))
    return { id: first.line.row_id, label: first.line.line_name, values,
      ...(first.line.line_kind === 'Subtotal' ? { strong: true } : {}), ...(first.line.line_kind === 'Memo' ? { quiet: true } : {}),
      ...(children.length ? { children } : {}) }
  }) ?? []
}

function add(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): Map<string, number> {
  const sum = new Map(a)
  for (const [key, amount] of b) sum.set(key, paise((sum.get(key) ?? 0) + amount))
  return sum
}

/** One set of amounts less another, line by line: actual less budget, or one version less another. */
export function difference(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): Map<string, number> {
  const result = new Map<string, number>()
  for (const key of new Set([...a.keys(), ...b.keys()])) result.set(key, paise((a.get(key) ?? 0) - (b.get(key) ?? 0)))
  return result
}

export interface VersionLink { row_id: string; based_on: string | null; covers_from: string; covers_to: string }
export interface CellLike { budget_version: string; plant: string; budget_month: string; pl_line: string; amount: string | number }
export interface Figure { amount: number; from: string }

/** The versions a version reads through, itself first, then the one it is based on, and so on. */
export function chainOf(versions: VersionLink[], id: string): VersionLink[] {
  const chain: VersionLink[] = []
  for (let at = versions.find(v => v.row_id === id); at && !chain.includes(at); at = versions.find(v => v.row_id === at!.based_on)) chain.push(at)
  return chain
}

/**
 * Every figure of a version, keyed `plant|month|line`. A revision holds only the figures it
 * changes: for the months it covers, every other figure is the one of the version it is
 * based on. `from` says which version a figure is held on.
 */
export function figuresOf(versions: VersionLink[], cells: CellLike[], id: string): Map<string, Figure> {
  const chain = chainOf(versions, id)
  const figures = new Map<string, Figure>()
  if (!chain.length) return figures
  const [from, to] = [chain[0].covers_from.slice(0, 7), chain[0].covers_to.slice(0, 7)]
  // The oldest version first, so each later one writes over it.
  for (const version of [...chain].reverse())
    for (const cell of cells) {
      const month = String(cell.budget_month).slice(0, 7)
      if (cell.budget_version !== version.row_id || month < from || month > to) continue
      figures.set(`${cell.plant}|${month}-01|${cell.pl_line}`, { amount: Number(cell.amount), from: version.row_id })
    }
  return new Map([...figures].sort(([a], [b]) => a.localeCompare(b)))
}
