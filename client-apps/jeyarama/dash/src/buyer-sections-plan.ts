// #1246: the first Buyer Sections, planned from today's Merchandise Assignment Buyer rows. Pure: it
// reads exported rows and returns the plan; nothing here writes anywhere. One desk per region, buyer and
// category head; a Buyer row with no buyer (a vacancy) becomes a desk per region, category head and
// category, so vacancies stay as small as the business left them.
import { exact, holdsOn, text } from './values.ts'

type Row = Record<string, unknown>
export interface PlannedLine {
  buyer_section_id: string; buyer_section: string; region: string; buyer_code: string; buyer_name: string
  category_head_code: string; category_head_name: string; subcategory_code: string; subcategory_name: string; category: string; from_assignment: string
}
export interface PlanSummary {
  sections: number; vacant_sections: number; subcategories_placed: number
  /** Merchandise subcategories no open Buyer row names, per region that has any Buyer row. */
  no_buyer: Record<string, number>
  /** Open Buyer rows naming a level above subcategory, or for every region on an instance naming no region: left out, listed for a person to place. */
  wider_buyer_rows: string[]
  /** A subcategory with two open Buyer rows in one region: the first by id is planned, all are listed. */
  two_buyers: string[]
  /** A subcategory with two open category heads in one region: none is guessed. */
  two_heads: string[]
}

const REGION_CODE: Record<string, string> = { Kerala: 'KL', 'Tamil Nadu': 'TN' }

/** The category head for a subcategory in a region: the most specific open Category head row (subcategory, then category). */
function headFor(heads: Row[], sub: Row, region: string): { code: string; ambiguous: boolean } {
  const inRegion = heads.filter(h => !exact(h.operating_region) || exact(h.operating_region) === region)
  for (const match of [(h: Row) => exact(h.subcategory) === exact(sub.row_id), (h: Row) => !exact(h.subcategory) && exact(h.category) === exact(sub.category)]) {
    const found = [...new Set(inRegion.filter(match).map(h => exact(h.employee)))]
    if (found.length) return { code: found.length === 1 ? found[0] : '', ambiguous: found.length > 1 }
  }
  return { code: '', ambiguous: false }
}

export function planBuyerSections(input: { assignments: Row[]; subcategories: Row[]; employees: Row[]; regions?: string[] }, today: string): { lines: PlannedLine[]; summary: PlanSummary } {
  const open = input.assignments.filter(r => holdsOn(r, today))
  const buyerRows = open.filter(r => text(r.responsibility) === 'Buyer').sort((a, b) => exact(a.row_id).localeCompare(exact(b.row_id)))
  const heads = open.filter(r => text(r.responsibility) === 'Category head')
  const subs = new Map(input.subcategories.map(s => [exact(s.row_id), s]))
  const names = new Map(input.employees.map(e => [exact(e.row_id), text(e.name)]))
  const summary: PlanSummary = { sections: 0, vacant_sections: 0, subcategories_placed: 0, no_buyer: {}, wider_buyer_rows: [], two_buyers: [], two_heads: [] }

  const seen = new Map<string, string>()
  const groups = new Map<string, { region: string; buyer: string; head: string; rows: { row: Row; sub: Row }[] }>()
  for (const row of buyerRows) {
    const sub = subs.get(exact(row.subcategory))
    // A row for every region (blank) becomes a desk in each region the instance names (Codex, #1246):
    // a desk is matched by its region exactly, so a desk with no region would buy nowhere.
    const regions = exact(row.operating_region) ? [exact(row.operating_region)] : input.regions ?? []
    if (!exact(row.subcategory) || !sub || !regions.length) { summary.wider_buyer_rows.push(exact(row.row_id)); continue }
    for (const region of regions) {
      const key = `${region}|${exact(sub.row_id)}`
      if (seen.has(key)) { summary.two_buyers.push(`${exact(sub.row_id)} in ${region}: ${seen.get(key)} and ${exact(row.row_id)}`); continue }
      seen.set(key, exact(row.row_id))
      const head = headFor(heads, sub, region)
      if (head.ambiguous) summary.two_heads.push(`${exact(sub.row_id)} in ${region}`)
      const buyer = exact(row.employee)
      const group = `${region}|${buyer}|${head.code}|${buyer ? '' : exact(sub.category)}`
      if (!groups.has(group)) groups.set(group, { region, buyer, head: head.code, rows: [] })
      groups.get(group)!.rows.push({ row, sub })
    }
  }

  // A desk is named for what it buys: its category, two categories, or its subdivision when wider.
  const lines: PlannedLine[] = []
  const used = new Set<string>()
  const baseName = (g: { rows: { sub: Row }[] }) => {
    const categories = [...new Set(g.rows.map(r => text(r.sub.category)))].sort()
    const subdivisions = [...new Set(g.rows.map(r => text(r.sub.subdivision)))].sort()
    return categories.length <= 2 ? categories.join(' and ') : subdivisions.length === 1 ? subdivisions[0] : `${categories[0]} and ${categories.length - 1} more`
  }
  const groupList = [...groups.values()]
  // Named buyers first, vacancies last, so a vacancy, not a person's desk, carries the "(no buyer yet)" suffix.
  for (const g of [...groups.values()].sort((a, b) => a.region.localeCompare(b.region) || Number(!a.buyer) - Number(!b.buyer) || (names.get(a.buyer) ?? '').localeCompare(names.get(b.buyer) ?? ''))) {
    // A clashing name takes its buyer's name, and their code too where two clashing buyers share a name,
    // then a counter: the id is built from the name, so it must be unique (Codex, #1246).
    const base = baseName(g)
    const label = (x: typeof g) => x.buyer ? names.get(x.buyer) || x.buyer : 'no buyer yet'
    let name = base
    if (used.has(`${g.region}|${name}`)) {
      const shared = groupList.filter(x => x !== g && x.region === g.region && baseName(x) === base && label(x) === label(g)).length > 0
      name = shared && g.buyer ? `${base} (${label(g)}, ${g.buyer})` : `${base} (${label(g)})`
    }
    for (let n = 2, first = name; used.has(`${g.region}|${name}`); n++) name = `${first} ${n}`
    used.add(`${g.region}|${name}`)
    const id = `${REGION_CODE[g.region] ?? (g.region || 'ALL')}-${name}`
    summary.sections++
    if (!g.buyer) summary.vacant_sections++
    for (const { row, sub } of g.rows.sort((a, b) => text(a.sub.subcategory).localeCompare(text(b.sub.subcategory)) || exact(a.sub.row_id).localeCompare(exact(b.sub.row_id)))) {
      summary.subcategories_placed++
      lines.push({ buyer_section_id: id, buyer_section: name, region: g.region, buyer_code: g.buyer, buyer_name: names.get(g.buyer) ?? '',
        category_head_code: g.head, category_head_name: names.get(g.head) ?? '', subcategory_code: exact(sub.row_id), subcategory_name: text(sub.subcategory),
        category: text(sub.category), from_assignment: exact(row.row_id) })
    }
  }
  const regions = [...new Set([...buyerRows.map(r => exact(r.operating_region)).filter(Boolean), ...(buyerRows.some(r => !exact(r.operating_region)) ? input.regions ?? [] : [])])].sort()
  const merchandise = input.subcategories.filter(s => text(s.subcategory_type) === 'Merchandise')
  for (const region of regions) summary.no_buyer[region || 'both regions'] = merchandise.filter(s => !seen.has(`${region}|${exact(s.row_id)}`)).length
  return { lines, summary }
}

const quote = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
export function toCsv(lines: PlannedLine[]): string {
  const columns = ['buyer_section_id', 'buyer_section', 'region', 'buyer_code', 'buyer_name', 'category_head_code', 'category_head_name', 'subcategory_code', 'subcategory_name', 'category', 'from_assignment'] as const
  return [columns.join(','), ...lines.map(l => columns.map(c => quote(l[c])).join(','))].join('\n') + '\n'
}
