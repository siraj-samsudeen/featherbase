// ATK tagging plan rules shared by the server and the screens.

export const TAG_PATTERN = /^JRA-\d{6}$/
export const TAG_STATUSES = ['Tagged', 'Needs a tag', 'Bulk count, no tag', 'Third-party, not tagged', 'No sticker, recorded by area'] as const
export const GROUP_OWNED = 'Group owned'

export const isTag = (value: unknown) => typeof value === 'string' && TAG_PATTERN.test(value)
export const tagNumber = (tag: string) => Number(tag.slice(4))
export const tagFor = (number: number) => `JRA-${String(number).padStart(6, '0')}`

interface Roll { row_id: string; first_no: number; last_no: number; roll_state?: string }

/** The issued roll whose number range holds this tag. */
export function rollOf<T extends Roll>(rolls: T[], tag: string): T | undefined {
  if (!isTag(tag)) return undefined
  const number = tagNumber(tag)
  return rolls.find(roll => Number(roll.first_no) <= number && number <= Number(roll.last_no))
}

/** A roll's line in the tag roll log. */
export function rollSummary(roll: Roll, usedTags: string[], events: { tag_no: string; event_kind: string }[]) {
  const inRoll = (tag: string) => isTag(tag) && Number(roll.first_no) <= tagNumber(tag) && tagNumber(tag) <= Number(roll.last_no)
  const issued = Number(roll.last_no) - Number(roll.first_no) + 1
  const used = new Set(usedTags.filter(inRoll)).size
  const spoiled = new Set(events.filter(event => ['Spoiled', 'Skipped'].includes(event.event_kind) && inRoll(event.tag_no)).map(event => event.tag_no)).size
  const reprinted = events.filter(event => event.event_kind === 'Reprinted' && inRoll(event.tag_no)).length
  const returned = roll.roll_state === 'Returned' ? issued - used - spoiled : 0
  return { issued, used, spoiled, reprinted, returned, unaccounted: roll.roll_state === 'Returned' ? 0 : issued - used - spoiled }
}

export type SapStatus = 'Found' | 'Not found yet' | 'Check tag no.' | `Found ${number} of ${number}`

/** A SAP record against the tags matched to it: every unit found, some, none, or a tag from elsewhere. */
export function sapStatus(record: { quantity?: number | null; plant?: string | null }, matched: { plant?: string | null }[]): SapStatus {
  if (!matched.length) return 'Not found yet'
  if (record.plant && matched.some(tag => tag.plant && tag.plant !== record.plant)) return 'Check tag no.'
  const units = Math.max(1, Number(record.quantity ?? 1))
  return matched.length >= units ? 'Found' : `Found ${matched.length} of ${units}`
}

const NEEDS_TAG = new Set(['Tagged', 'Needs a tag'])

/** The reconciliation figures for one plant's book and count. */
export function reconciliation({ book, matches, assets, exceptions }: {
  book: { row_id: string; book_value: number | string | null; quantity?: number | null }[]
  matches: { sap_book: string; asset: string }[]
  assets: { row_id: string; tag_status: string | null }[]
  exceptions: { exception_state: string }[]
}) {
  const perRecord = new Map<string, number>()
  for (const match of matches) perRecord.set(match.sap_book, (perRecord.get(match.sap_book) ?? 0) + 1)
  let found = 0, valueNotFound = 0
  for (const record of book) {
    const units = Math.max(1, Number(record.quantity ?? 1))
    const tags = Math.min(units, perRecord.get(record.row_id) ?? 0)
    if (tags >= units) found++
    valueNotFound += Number(record.book_value ?? 0) * (units - tags) / units
  }
  const matchedAssets = new Set(matches.map(match => match.asset))
  const taggable = assets.filter(asset => NEEDS_TAG.has(String(asset.tag_status)))
  return {
    matchRate: book.length ? Math.round((found / book.length) * 100) : 0,
    valueNotFound: Math.round(valueNotFound),
    foundNotInBooks: assets.filter(asset => asset.tag_status === 'Tagged' && !matchedAssets.has(asset.row_id)).length,
    tagCoverage: taggable.length ? Math.round((taggable.filter(asset => asset.tag_status === 'Tagged').length / taggable.length) * 100) : 0,
    openExceptions: exceptions.filter(exception => exception.exception_state !== 'Closed').length,
  }
}

/** Every line at or over the value threshold, plus a random share of the rest (rounded up). */
export function recountSample(lines: { row_id: string; book_value?: number | string | null }[], { percent, threshold }: { percent: number; threshold?: number | null }, random: () => number): string[] {
  const over = threshold ? lines.filter(line => Number(line.book_value ?? 0) >= threshold) : []
  const rest = lines.filter(line => !over.includes(line))
  const shuffled = rest.map(line => ({ line, key: random() })).sort((a, b) => a.key - b.key).map(entry => entry.line)
  const share = Math.ceil((rest.length * percent) / 100)
  return [...over, ...shuffled.slice(0, share)].map(line => line.row_id)
}
