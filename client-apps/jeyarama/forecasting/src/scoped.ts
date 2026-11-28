// Who reads which rows (#1454, rama_dw #4935): exactly as Dash. Every Forecasting Table about places (the read-only
// copies, by their datasets' filters; the review Tables, by scopedTables) is read only within each person's places,
// as the instance's org-chart scope provider (Dash's) gives them, by the platform on every read path: section staff
// their section, a Team Leader theirs, a Store Manager the store, a category head their subcategories at their
// region's stores. A row a person wrote is always theirs. This file only says whether someone has any place, so the
// app can tell someone with none that they have no access, instead of showing empty pages.

/** What a reader with no places is told; the page knows it by these words. */
export const NO_PLACES = 'You have no store, section or subcategory on the org chart'

/** `my_places`: how many places the person has (a person_scope read, which the platform refuses with no places). */
export function myPlaces(ctx: { authorization: { places?: readonly unknown[] }; reject(message: string): never }): { places: number } {
  if (!ctx.authorization.places?.length) ctx.reject(NO_PLACES)
  return { places: ctx.authorization.places.length }
}

/** #1461: the plant codes the reader's places name (each place's `store` filter holds plant codes, as a Run's lines do). */
export function plantsIn(places: readonly { filters?: Readonly<Record<string, readonly string[]>> }[] | undefined): string[] {
  return [...new Set((places ?? []).flatMap(p => p.filters?.store ?? []))]
}
