// Why a day went off Feather Forecast (#1425; the 26-Nov day review mockup, Siraj's feedback that day): five causes,
// each with the detail a person picks under it and the evidence that settles it. The server checks a saved
// explanation against this list; the page draws it. A tag is stored as "Cause › Tag".

export interface Cause { name: string; color: string; tags: string[]; evidence: string }

export const CAUSES: Cause[] = [
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

export const TAG_JOIN = ' › '
export const tagOf = (cause: string, tag: string) => `${cause}${TAG_JOIN}${tag}`
export const causeOf = (tagOrCause: string) => CAUSES.find(c => tagOrCause === c.name || tagOrCause.startsWith(c.name + TAG_JOIN))

/** What is wrong with an explanation's causes and tags, or null: at least one cause, every cause on the list, and
 *  every tag under one of the picked causes. */
export function causesProblem(causes: string[], tags: string[]): string | null {
  if (!causes.length) return 'Pick at least one cause'
  const unknown = causes.find(c => !CAUSES.some(x => x.name === c))
  if (unknown) return `${unknown} is not one of the causes`
  for (const t of tags) {
    const c = causeOf(t)
    if (!c || !c.tags.includes(t.slice(c.name.length + TAG_JOIN.length))) return `${t} is not a tag of a cause`
    if (!causes.includes(c.name)) return `${t} is under ${c.name}, which is not picked`
  }
  return null
}

/** A Text column of one value a line, as a list. */
export const linesOf = (text: unknown) => String(text ?? '').split('\n').map(s => s.trim()).filter(Boolean)
