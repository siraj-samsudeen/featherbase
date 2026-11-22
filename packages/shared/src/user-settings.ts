import { z } from 'zod'

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

/** #1251: what the person has learnt of the keyboard shortcuts, and whether
 *  they quieted the tips. The web writes and reads it; the server only stores it. */
export const SHORTCUT_SETTINGS = '__shortcuts'

/** #1282 A4: the parts of a person's view of a list that a Table's default can set, as the list stores them in
 *  the person's settings: the layout, the columns switched on and off on top of the Table's list columns, the sort,
 *  compact rows and how the Links tab reads. A person's own value for a key wins; the Table's default fills the rest. */
const columnName = z.string().min(1).max(140)
export const tableViewSettingsSchema = z.object({
  layout: z.enum(LIST_LAYOUTS).optional(),
  shownCols: z.array(columnName).max(300).optional(),
  hiddenCols: z.array(columnName).max(300).optional(),
  sort: z.object({ field: columnName, dir: z.enum(['asc', 'desc']) }).strict().nullable().optional(),
  compact: z.boolean().optional(),
  links: z.object({ as: z.enum(['sections', 'tree']).optional(), fields: z.boolean().optional() }).strict().optional(),
}).strict()
export type TableViewSettings = z.infer<typeof tableViewSettingsSchema>
/** The keys "Reset to the Table's Default" clears from a person's own settings for a Table: the view the default
 *  sets, and the person-only Show Retired, board grouping and hidden Click To Narrow. Their form arrangement stays. */
export const VIEW_SETTING_KEYS = ['layout', 'shownCols', 'hiddenCols', 'sort', 'compact', 'links', 'showRetired', 'groupBy', 'narrowHidden'] as const

/** GET /api/table_view_default/:table: the Table's default view, or none; who set it and when. */
export interface TableViewDefault { id: string; settings: TableViewSettings; by: string; at: string; undoes?: string }
