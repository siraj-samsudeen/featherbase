// Who may act where, on the made-up org chart (madeUp.ts PEOPLE). A person enters, applies, approves,
// promotes or withdraws numbers only inside their own area, and sees everything else read only. The page
// and the server hook (server.ts) both ask this. Real enforcement needs the signed-in person, not the
// made-up "Viewing as" one: that is the platform's side.
import { CHART_SUBS, PEOPLE, inScope, type Person, type Scope, type Sub } from './madeUp'

/** A Category Head's categories, by the place on their record. */
const CATEGORIES: Record<string, string[]> = { 'Womenswear & Girls': ['Women Ethnic Wear', 'Girls Bottom'] }

const placeSets = new WeakMap<Person, { whole: Set<string>; codes: Set<string> }>()
/** A loaded Run's person: their places (Dash's reach), as sets; no places is every store. */
function reaches(p: Person, s: Sub) {
  if (!p.places!.length) return true
  let sets = placeSets.get(p)
  if (!sets) {
    sets = { whole: new Set(p.places!.filter(x => !x.codes).map(x => x.store)), codes: new Set(p.places!.flatMap(x => (x.codes ?? []).map(c => `${x.store}|${c}`))) }
    placeSets.set(p, sets)
  }
  return sets.whole.has(s.store) || sets.codes.has(`${s.store}|${s.code}`)
}
/** Whether one store's subcategory is in a person's area. */
export function inArea(p: Person, s: Sub): boolean {
  if (p.places) return reaches(p, s)
  switch (p.role) {
    case 'Team Leader': { const [store, section] = p.place.split(' · '); return s.store === store && s.section === section }
    case 'Department Manager': case 'Store Manager': return s.store === p.place
    case 'Category Head': return (CATEGORIES[p.place] ?? []).includes(s.category)
    default: return true // Forecast Lead, Operations Head, Chief Executive: everywhere
  }
}
/** A scope is in a person's area when every subcategory in it is. */
export function covers(p: Person, sc: Pick<Scope, 'store' | 'level' | 'name'>) {
  const subs = CHART_SUBS.filter(s => inScope(s, sc))
  return subs.length > 0 && subs.every(s => inArea(p, s))
}
/** "Lakeside · Girls Bottoms", "Lakeside", "Women Ethnic Wear and Girls Bottom, any store", "every store". */
export function areaText(p: Person) {
  if (p.places) {
    if (!p.places.length) return 'every store'
    const stores = [...new Set(p.places.map(x => x.store))], whole = p.places.every(x => !x.codes)
    const list = stores.length > 3 ? `${stores.slice(0, 3).join(', ')} and ${stores.length - 3} more` : stores.join(', ')
    return whole ? list : `their subcategories at ${list}`
  }
  switch (p.role) {
    case 'Team Leader': case 'Department Manager': case 'Store Manager': return p.place
    case 'Category Head': return `${(CATEGORIES[p.place] ?? []).join(' and ')}, any store`
    default: return 'every store'
  }
}
/** The made-up person a row names, if any. */
export const personNamed = (name: unknown) => PEOPLE.find(p => p.name === name)
