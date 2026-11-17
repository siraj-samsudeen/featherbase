// #1246: who buys a subcategory. A Buyer Section (a buying Buyer Section: its buyer, its category head, the
// subcategories it buys) is where buyers are kept. Until every subcategory has one, the transition rule
// holds: a subcategory a Buyer Section covers takes its buyer from there; only where none covers it does
// today's Merchandise Assignment Buyer row still answer. With no Buyer Sections (or no such Tables on the
// instance yet) every answer is today's.
import { exact } from './values.ts'
import { all, type Row } from './my-sections.ts'
import { holdsOn } from './values.ts'

export const BUYER_SECTION = 'Buyer Section'
export const BUYER_SECTION_SUBCATEGORY = 'Buyer Section Subcategory'
/** The Tables Dash reads buyers from (#1246), besides Merchandise Assignment. */
export const BUYER_TABLES: readonly string[] = [BUYER_SECTION, BUYER_SECTION_SUBCATEGORY]
export const BUYER_SECTION_FIELDS = ['buyer_section_id', 'name', 'operating_region', 'buyer', 'category_head', 'purchasing_group', 'starts_on', 'ends_on']
export const BUYER_LINK_FIELDS = ['buyer_section_subcategory_id', 'buyer_section', 'subcategory', 'starts_on', 'ends_on']

/** The Buyer Sections open on a day, by id, and their open subcategory links. */
export interface BuyerSections { sections: Map<string, Row>; links: Row[] }
export const NO_BUYER_SECTIONS: BuyerSections = { sections: new Map(), links: [] }

type Ctx = Parameters<typeof all>[0]

/** The Buyer Sections open on `today`, and their links open that day. None while the instance lacks the Tables. */
export async function openBuyerSections(ctx: Ctx, today: string): Promise<BuyerSections> {
  const has = ctx.baseTables.available
  if (!has || !(await has(BUYER_SECTION)) || !(await has(BUYER_SECTION_SUBCATEGORY))) return NO_BUYER_SECTIONS
  const sections = new Map((await all(ctx, BUYER_SECTION, BUYER_SECTION_FIELDS, [])).filter(r => holdsOn(r, today)).map(r => [exact(r.row_id), r]))
  if (!sections.size) return NO_BUYER_SECTIONS
  const links = (await all(ctx, BUYER_SECTION_SUBCATEGORY, BUYER_LINK_FIELDS, [['buyer_section', 'in', [...sections.keys()]]]))
    .filter(r => holdsOn(r, today) && sections.has(exact(r.buyer_section)))
  return { sections, links }
}

/** Every region named on the instance: by its sites, its open Buyer Sections and its Buyer rows. */
export function knownRegions(...lists: unknown[][]): string[] {
  return [...new Set(lists.flat().map(v => exact(v)).filter(Boolean))].sort()
}

/** The open Buyer Sections covering `subcategory` in `region`. */
export function buyerSectionsCovering(open: BuyerSections, subcategory: string, region: string): Row[] {
  return open.links.filter(l => exact(l.subcategory) === subcategory).map(l => open.sections.get(exact(l.buyer_section))!)
    .filter(d => d && exact(d.operating_region) === region)
}

/** Does a Buyer row still answer for `subcategory` in `region` (null: in at least one region it applies to)?
 *  A row applies to its region, or (blank) to every region in `regions`. Where a Buyer Section covers the
 *  subcategory, the Buyer Section answers there and the row does not. */
export function rowAnswers(row: Row, subcategory: string, region: string | null, open: BuyerSections, regions: string[]): boolean {
  const own = exact(row.operating_region)
  if (region && own && own !== region) return false
  return region ? !buyerSectionsCovering(open, subcategory, region).length : answersWhere(row, subcategory, open, regions).length > 0
}

/** The regions where a Buyer row still answers for `subcategory`: its own region, or for a both-regions row
 *  each region in `regions` no Buyer Section covers (null standing for "every region" when none is known). */
export function answersWhere(row: Row, subcategory: string, open: BuyerSections, regions: string[]): (string | null)[] {
  const own = exact(row.operating_region)
  const applies = own ? [own] : regions.length ? regions : [null]
  return applies.filter(r => r === null || !buyerSectionsCovering(open, subcategory, r).length)
}

/** How a both-regions row's remaining scope reads: null when it still answers everywhere it applies. */
export function onlyIn(row: Row, subcategory: string, open: BuyerSections, regions: string[]): string | null {
  if (exact(row.operating_region)) return null
  const where = answersWhere(row, subcategory, open, regions)
  return where.includes(null) || where.length === regions.length ? null : (where as string[]).join(' and ')
}

/** Where `subcategory`'s buyer comes from, in `region` (null: every region), by the transition rule.
 *  `buyerRows` are the Merchandise Assignment Buyer rows open that day; `covers` says whether one covers
 *  the subcategory. A row answers only where no Buyer Section covers the subcategory (rowAnswers). */
export function buyerSources(subcategory: string, region: string | null, open: BuyerSections, buyerRows: Row[], covers: (row: Row) => boolean, regions: string[] = []):
  { sections: { section: Row; link: Row }[]; assignments: Row[] } {
  const sections = open.links.filter(l => exact(l.subcategory) === subcategory)
    .map(link => ({ link, section: open.sections.get(exact(link.buyer_section))! }))
    .filter(({ section }) => section && (!region || exact(section.operating_region) === region))
  const assignments = buyerRows.filter(row => covers(row) && rowAnswers(row, subcategory, region, open, regions))
  return { sections, assignments }
}
