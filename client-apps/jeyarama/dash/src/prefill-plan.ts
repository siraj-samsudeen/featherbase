// The reviewed pre-fill list (#1205), one row per manager and section, read into one
// prefill_departments call per store. Which rows count is the list's own `proposal` column.

/** What each proposal says to do with its row. */
const PROPOSALS: Record<string, 'section' | 'flagged' | 'left_out' | 'no_team'> = {
  'pre-filled': 'section',
  'shared, majority: pre-filled, flagged': 'flagged',
  'shared, minority: left out': 'left_out',
  'section in another store: left out': 'left_out',
  'no team with sections: set-up card': 'no_team',
}
const NEEDED = ['store', 'dm_employee', 'section', 'proposal']

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks. */
function rows(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); out.push(row); row = []; field = '' }
    else field += c
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); out.push(row) }
  return out.filter(r => r.some(cell => cell.trim()))
}

export interface StorePlan { store: string; managers: { employee: string; sections: string[]; flagged: string[] }[] }

export function planFromCsv(text: string) {
  const [header, ...body] = rows(text)
  const at = Object.fromEntries(header.map((name, i) => [name.trim(), i]))
  if (NEEDED.some(name => !(name in at))) throw new Error(`The list needs the columns ${NEEDED.join(', ')}`)
  const counts = { rows: body.length, sections: 0, flagged: 0, left_out: 0, no_team: 0, managers: 0 }
  const stores = new Map<string, Map<string, StorePlan['managers'][number]>>()
  body.forEach((cells, i) => {
    const kind = PROPOSALS[cells[at.proposal].trim()]
    if (!kind) throw new Error(`Row ${i + 1}: unknown proposal "${cells[at.proposal]}"`)
    if (kind === 'left_out' || kind === 'no_team') { counts[kind]++; return }
    const store = cells[at.store].trim()
    const employee = cells[at.dm_employee].trim()
    const section = cells[at.section].trim()
    const managers = stores.get(store) ?? new Map()
    stores.set(store, managers)
    const manager = managers.get(employee) ?? { employee, sections: [], flagged: [] }
    managers.set(employee, manager)
    manager.sections.push(section)
    counts.sections++
    if (kind === 'flagged') { manager.flagged.push(section); counts.flagged++ }
  })
  const plans: StorePlan[] = [...stores].map(([store, managers]) => ({ store, managers: [...managers.values()] }))
  counts.managers = plans.reduce((n, p) => n + p.managers.length, 0)
  return { stores: plans, counts }
}

type Outcome = { employee: string; name: string; outcome: 'pre-filled' | 'would pre-fill' | 'skipped' | 'refused'; notes: string[]; department?: string; sections?: string[]
  bundle?: string; created?: { department: string | null; links: (string | null)[]; proposals: string[] } }
type Report = { totals: Record<string, number>; stores: ({ store: string; results: Outcome[] } | { store: string; error: string })[] }

/** Sends each store's plan to prefill_departments (a dry run when asked) and adds up what happened;
 *  one store failing stops none of the rest. */
export async function runPrefill(plans: StorePlan[], post: (payload: StorePlan & { dry_run?: true }) => Promise<{ results: Outcome[] }>, dryRun = false): Promise<Report> {
  const totals = { 'pre-filled': 0, 'would pre-fill': 0, skipped: 0, refused: 0, failed_stores: 0 }
  const stores: Report['stores'] = []
  for (const plan of plans) {
    try {
      const { results } = await post({ store: plan.store, managers: plan.managers, ...(dryRun ? { dry_run: true as const } : {}) })
      for (const result of results) totals[result.outcome]++
      stores.push({ store: plan.store, results })
    } catch (error) {
      totals.failed_stores++
      stores.push({ store: plan.store, error: (error as Error).message })
    }
  }
  return { totals, stores }
}

/** Each store's own counts, or why it failed. */
export function perStore(report: Report) {
  return report.stores.map(entry => {
    if ('error' in entry) return { store: entry.store, error: entry.error }
    const count = (outcome: Outcome['outcome']) => entry.results.filter(r => r.outcome === outcome).length
    return { store: entry.store, 'pre-filled': count('pre-filled'), 'would pre-fill': count('would pre-fill'), skipped: count('skipped'), refused: count('refused') }
  })
}

/** What a run created, row by row: kept beside the load, and all undo_prefill needs. */
export function createdRecord(report: Report) {
  const rows = report.stores.flatMap(entry => ('results' in entry ? entry.results : [])
    .filter(r => r.outcome === 'pre-filled')
    .map(r => ({ store: entry.store, employee: r.employee, name: r.name, department: r.department!, bundle: r.bundle!, created: r.created! })))
  return { bundles: rows.map(r => r.bundle), rows }
}

/** Takes a whole load back, fifty pre-fills a call. */
export async function runUndo(record: { bundles: string[] }, post: (payload: { bundles: string[] }) => Promise<{ results: { bundle: string; outcome: string }[] }>) {
  const tally = { undone: 0, not_open: 0 }
  for (let i = 0; i < record.bundles.length; i += 50) {
    const { results } = await post({ bundles: record.bundles.slice(i, i + 50) })
    for (const result of results) if (result.outcome === 'undone') tally.undone++; else tally.not_open++
  }
  return tally
}
