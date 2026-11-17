// The per-person settings records (`/api/user_settings/:name`, UI-013). One per
// Table for its list and form, and these that belong to no Table.

/** The person's navigation choices: where the drill pane sits, their recent
 *  walks (#910) and the shared saved views they starred into the sidebar (#1229).
 *  The web writes it and the server reads the stars from it, so both use this. */
export const NAVIGATION_SETTINGS = '__navigation'

/** #1259: the three ways to read a list. `table` opens a row on its own page;
 *  `split` is cards with the record beside them (List And Record); `panel` is
 *  the table with the record sliding over its right side (Table With Panel). */
export const LIST_LAYOUTS = ['table', 'split', 'panel'] as const
export type ListLayout = (typeof LIST_LAYOUTS)[number]
