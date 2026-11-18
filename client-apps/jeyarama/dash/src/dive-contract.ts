// #1225: what Dash can pass a Dive about each reader, which of it a Dive reads, and the filter shape
// that follows. The keys are the Dash ↔ Dive contract's (data-warehouse docs/plans/
// dive_pickers_in_dive_contract.md): one store = plant_code + material_groups + whole_store;
// several stores = reach (+ store to open on); month = month. Detection only says what a Dive
// asks for; a Dive that reads `reach` and still offers every store is its owner's fault, which is
// why a store key alone (its own picker) never counts.

/** One thing Featherbase knows about a reader and the key a Dive reads it by. */
export interface PassedFilter { key: string; passes: string; example: string; group: 'one' | 'many' | 'month' }

export const PASSED_FILTERS: readonly PassedFilter[] = [
  { key: 'plant_code', passes: 'Their store, for a person with one store', example: '"1501"', group: 'one' },
  { key: 'material_groups', passes: 'Their subcategories in that store', example: '["101010101", "101010102"]', group: 'one' },
  { key: 'whole_store', passes: 'Whether they see the whole store or only part of it', example: 'true', group: 'one' },
  { key: 'reach', passes: 'Their stores and subcategories, for a person with several', example: '{ "1501": null, "1502": ["02", "101010101"] }', group: 'many' },
  { key: 'store', passes: 'The store to open on, among their stores', example: '"1501"', group: 'many' },
  { key: 'month', passes: 'The month to open on', example: '"this" or "last"', group: 'month' },
]

const ONE_STORE = ['plant_code', 'material_groups', 'whole_store']

/** Keys that pick a store without Dash: the Dive's own Store picker sets them. */
const OWN_STORE_KEYS = ['store', 'stores', 'store_code', 'store_codes', 'plant', 'plant_codes', 'site', 'site_code']

/**
 * The shape Dash picks from what a Dive reads.
 * - `stores`: it reads reach: each person sees their stores and picks among them in the Dive;
 * - `one_store`: it reads all three one-store keys: Dash's Store bar picks among the reader's stores;
 * - `partly`: it reads some one-store keys but not all: `missing` names the rest;
 * - `every_store`: it reads no key Dash fills for stores: everyone sees every store (`own_picker`
 *   when it has a Store picker of its own);
 * - `unknown`: Dash could not read its source.
 */
export type Fit =
  | { kind: 'stores'; month: boolean; openOn: boolean }
  | { kind: 'one_store'; month: boolean }
  | { kind: 'partly'; missing: string[] }
  | { kind: 'every_store'; ownPicker: string[] }
  | { kind: 'unknown' }

export function fitOf(reads: readonly string[] | null | undefined): Fit {
  if (!reads) return { kind: 'unknown' }
  const has = (key: string) => reads.includes(key)
  if (has('reach')) return { kind: 'stores', month: has('month'), openOn: has('store') }
  const oneStore = ONE_STORE.filter(has)
  if (oneStore.length === ONE_STORE.length) return { kind: 'one_store', month: has('month') }
  if (oneStore.length) return { kind: 'partly', missing: ONE_STORE.filter(key => !has(key)) }
  return { kind: 'every_store', ownPicker: reads.filter(key => OWN_STORE_KEYS.includes(key.toLowerCase())) }
}

/** What `dash.report` gets for that shape; null when Dash must not narrow it (same for everyone). */
export function reportShapeFor(fit: Fit): { filter_shape: string; store_key: string | null; subcategory_key: string | null; whole_store_key: string | null; pickers_in_dive: boolean } | null {
  if (fit.kind === 'stores') return { filter_shape: 'Stores and subcategories', store_key: 'reach', subcategory_key: null, whole_store_key: null, pickers_in_dive: fit.openOn }
  if (fit.kind === 'one_store') return { filter_shape: 'One store and subcategories', store_key: 'plant_code', subcategory_key: 'material_groups', whole_store_key: 'whole_store', pickers_in_dive: false }
  return null
}

/**
 * The Dive's address in MotherDuck: its title as words, then its id, as MotherDuck's own links are
 * (`/dives/fashion-jockey-women-store-skusize-stock-cover-<id>`). MotherDuck finds the Dive by id.
 */
export function diveLink(title: string, id: string): string {
  const words = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/[\s-]+/).filter(Boolean)
  let slug = ''
  for (const word of words) { if ((slug ? `${slug}-${word}` : word).length > 50) break; slug = slug ? `${slug}-${word}` : word }
  return `https://app.motherduck.com/dives/${slug ? `${slug}-` : ''}${id}`
}

/** The note for a Dive's owner, ready to paste: the exact keys to read so Dash can narrow it. */
export function ownerInstruction(title: string, link: string): string {
  return [
    `Please make the Dive "${title}" show each Dash reader only their stores.`,
    `Dive: ${link}`,
    '',
    'Dash sends these, set on the server when it opens the Dive:',
    '- reach: the reader\'s stores. { "1501": null, "1502": ["02", "101010101"] } — null is the whole store, a list is only those subcategories: each is a subcategory code or the start of one ("02" is every subcategory code starting 02), so match with starts_with.',
    '- store: the store to open on, always one of reach\'s.',
    '- month: "this" or "last".',
    '',
    'In the Dive:',
    "1. const [reach] = useDiveState('reach', null)  and  const [store, setStore] = useDiveState('store', …)",
    "2. The Store picker offers only reach's stores, and every query is limited to the chosen store and, where reach lists them, those subcategories.",
    '3. Empty or malformed reach: show nothing (never every store).',
    '4. Opened in MotherDuck by you, with no reach at all: keep offering every store, as today.',
    '',
    'Save it and tell the person who added it to Dash. Dash checks the Dive again and switches the report over.',
  ].join('\n')
}
