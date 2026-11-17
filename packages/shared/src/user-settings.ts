// The per-person settings records (`/api/user_settings/:name`, UI-013). One per
// Table for its list and form, and these that belong to no Table.

/** The person's navigation choices: where the drill pane sits, their recent
 *  walks (#910) and the shared saved views they starred into the sidebar (#1229).
 *  The web writes it and the server reads the stars from it, so both use this. */
export const NAVIGATION_SETTINGS = '__navigation'

/** #1251: what the person has learnt of the keyboard shortcuts, and whether
 *  they quieted the tips. The web writes and reads it; the server only stores it. */
export const SHORTCUT_SETTINGS = '__shortcuts'
