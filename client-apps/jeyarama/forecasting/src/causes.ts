// Why a day went off Feather Forecast (#1425; the 26-Nov day review mockup, Siraj's feedback that day): five causes
// for a day below the forecast and, since 28-Nov, five for a day above it, each with the detail a person picks under
// it and the evidence that settles it. The server checks a saved explanation against the set for its direction; the
// page draws it. A tag is stored as "Cause › Tag".

export interface Cause { name: string; color: string; tags: string[]; evidence: string }
/** Which way the day went: below the forecast, or above it. Stored with the explanation, so the warehouse can tell them apart. */
export type Direction = 'below' | 'above'

export const CAUSES_BELOW: Cause[] = [
  { name: 'Target too high or badly phased', color: '#7a4fd6', tags: ['Month target too high', 'Daily split wrong for the weekday', 'Festival or event on a different day'],
    evidence: 'The approved month target, its daily split, and the weekday and festival adjustments' },
  { name: 'Forecast missed the demand', color: '#2f6fdf', tags: ['Wrong demand prediction', 'Event not in the forecast', 'New store or new line, no history'],
    evidence: 'The forecast frozen before the day, with its version and when it was issued' },
  { name: 'Stock not available', color: '#b86e00', tags: ['Size or colour missing', 'Insufficient buying', 'Warehouse stock not dispatched', 'Vendor supply failure', 'Inaccurate stock'],
    evidence: 'Item, size and price-band availability in selling hours; replenishment; lost-sale evidence' },
  { name: 'Weak store execution', color: '#c23b3b', tags: ['Low footfall', 'Low conversion', 'Short of staff', 'Stock not displayed', 'Wrong pricing'],
    evidence: 'Footfall, conversion, staffing, display and shelf availability' },
  { name: 'Sales data incomplete', color: '#5b6575', tags: ['Day not fully loaded', 'Till or POS not synced', 'Missing sales data'],
    evidence: 'POS-to-report reconciliation and the completed-day cut-off' },
]

/** For a day that beat the forecast (Siraj, 28-Nov-2026). */
export const CAUSES_ABOVE: Cause[] = [
  { name: 'Festival or event', color: '#7a4fd6', tags: ['Festival earlier than usual', 'Local event or function', 'Salary day', 'Wedding season'],
    evidence: 'Festival calendar, local events, footfall' },
  { name: 'Promotion or offer', color: '#c2410c', tags: ['Store offer', 'Brand promotion', 'Clearance sale'],
    evidence: 'Offer dates, discount on the bills' },
  { name: 'New stock arrived', color: '#0f766e', tags: ['New range landed', 'Best seller restocked', 'Extra display'],
    evidence: 'Goods received, display changes' },
  { name: 'Outside reasons', color: '#b86e00', tags: ['Weather', 'Competitor closed or short', 'Bulk or corporate order'],
    evidence: 'A note on what happened; for bulk orders, the bill' },
  { name: 'Forecast too low', color: '#2f6fdf', tags: ['Missed a recent trend', 'Last year was unusually low', 'Sales caught up after a data gap'],
    evidence: "Recent weeks against the forecast; last year's same days" },
]

/** The causes a day is explained with: above the forecast, or below it. */
export const causesFor = (d: Direction) => (d === 'above' ? CAUSES_ABOVE : CAUSES_BELOW)
/** A day's direction from its % off the forecast. */
export const directionOf = (off: number): Direction => (off > 0 ? 'above' : 'below')

export const TAG_JOIN = ' › '
export const tagOf = (cause: string, tag: string) => `${cause}${TAG_JOIN}${tag}`
/** A cause, by its name or one of its tags, in either set (the names differ between them). */
export const causeOf = (tagOrCause: string) => [...CAUSES_BELOW, ...CAUSES_ABOVE].find(c => tagOrCause === c.name || tagOrCause.startsWith(c.name + TAG_JOIN))

/** What is wrong with an explanation's causes and tags, or null: at least one cause, every cause in the set for its
 *  direction, and every tag under one of the picked causes. */
export function causesProblem(direction: Direction, causes: string[], tags: string[]): string | null {
  const set = causesFor(direction)
  if (!causes.length) return 'Pick at least one cause'
  const unknown = causes.find(c => !set.some(x => x.name === c))
  if (unknown) return `${unknown} is not one of the causes for a day ${direction} the forecast`
  for (const t of tags) {
    const c = set.find(x => t.startsWith(x.name + TAG_JOIN))
    if (!c || !c.tags.includes(t.slice(c.name.length + TAG_JOIN.length))) return `${t} is not a tag of a cause`
    if (!causes.includes(c.name)) return `${t} is under ${c.name}, which is not picked`
  }
  return null
}

/** A Text column of one value a line, as a list. */
export const linesOf = (text: unknown) => String(text ?? '').split('\n').map(s => s.trim()).filter(Boolean)
