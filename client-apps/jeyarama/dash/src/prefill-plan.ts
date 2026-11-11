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

type Outcome = { employee: string; name: string; outcome: 'pre-filled' | 'skipped' | 'refused'; notes: string[]; department?: string; sections?: string[] }
/** Sends each store's plan to prefill_departments and adds up what happened; one store failing stops none of the rest. */
export async function runPrefill(plans: StorePlan[], post: (payload: StorePlan) => Promise<{ results: Outcome[] }>) {
  const totals = { 'pre-filled': 0, skipped: 0, refused: 0, failed_stores: 0 }
  const stores: ({ store: string; results: Outcome[] } | { store: string; error: string })[] = []
  for (const plan of plans) {
    try {
      const { results } = await post({ store: plan.store, managers: plan.managers })
      for (const result of results) totals[result.outcome]++
      stores.push({ store: plan.store, results })
    } catch (error) {
      totals.failed_stores++
      stores.push({ store: plan.store, error: (error as Error).message })
    }
  }
  return { totals, stores }
}
