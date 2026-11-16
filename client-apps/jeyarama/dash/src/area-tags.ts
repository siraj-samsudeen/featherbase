// #1225: the business area a report belongs to (RB, 16-Nov-2026: "how many HR related, sales
// related, inventory related"), derived from its name by fixed words, never hand-typed. A report
// can sit in two areas; a name no rule places gets none rather than a guess. The rules are a
// starting point: once Dash stores tags on dash.report, these prefill them.

export const AREAS = ['Sales', 'Inventory', 'Buying', 'Operations', 'HR', 'Finance'] as const
export type Area = (typeof AREAS)[number]

/** The words that place a report in each area, matched as whole words, any case. */
const RULES: Record<Area, RegExp> = {
  Sales: /\b(sales|target|mtd|performance)\b/i,
  Inventory: /\b(stock|inventory|replenishment|assortment|ageing)\b/i,
  Buying: /\b(buyers?|buying|vendors?|p2p|purchase|procurement|category head|price ranges?)\b/i,
  Operations: /\b(operations|control tower|cockpit)\b/i,
  HR: /\b(attendance|cashiers?|staff|people|payroll|hr)\b/i,
  Finance: /(\bp&l\b|\bfinance\b|\bmargins?\b|\bcash\b|\bgst\b)/i,
}

export function areasOf(name: string): Area[] {
  return AREAS.filter(area => RULES[area].test(name))
}

/** A report as these functions read it: its name, and its areas when someone chose them on adding. */
type Named = { name: string; areas?: readonly Area[] | null }

/** The areas chosen for a report, else those its name gives. */
export function reportAreas(report: Named): Area[] {
  return report.areas ? AREAS.filter(area => report.areas!.includes(area)) : areasOf(report.name)
}

/** How many reports each area holds, in AREAS' order; areas with none are left out. */
export function areaCounts(reports: readonly Named[]): { area: Area; count: number }[] {
  return AREAS.map(area => ({ area, count: reports.filter(report => reportAreas(report).includes(area)).length })).filter(row => row.count > 0)
}

/** Whether a report is shown under the chosen area; no area chosen shows everything. */
export function inArea(report: Named, area: Area | null): boolean {
  return area === null || reportAreas(report).includes(area)
}

/** A bundle's areas: those of the reports in it, in AREAS' order. */
export function bundleAreas(keys: readonly string[], reports: readonly (Named & { key: string })[]): Area[] {
  const held = reports.filter(report => keys.includes(report.key)).flatMap(report => reportAreas(report))
  return AREAS.filter(area => held.includes(area))
}
