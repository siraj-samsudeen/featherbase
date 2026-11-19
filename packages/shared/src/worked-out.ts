import { z } from 'zod'

// #1282 C10–C11 (UI owner, option A): an app works out sections about a record of a Table it
// declares in its manifest's `workedOut` ("Apps They Can Open · worked out from their roles"),
// by one of its reads. The record panel (the Lens) draws them, and checks the answer against
// this one versioned shape first: an answer that is not it is refused whole, never half drawn.

/** The most an answer holds: a section the Lens shows whole, not a list to page through. */
export const WORKED_OUT_LIMITS = { sections: 4, rows: 50, via: 6, why: 8 } as const

const words = (max: number) => z.string().trim().min(1).max(max)
const record = z.object({ table: words(200), row: words(200) }).strict()
/** A named thing, a link where it is a record the viewer may open. */
const named = z.object({ name: words(120), record: record.optional() }).strict()

export const workedOutRowSchema = z.object({
  name: words(120),
  /** The record the row names, opened by its link. */
  record: record.optional(),
  /** The installed app the row names ("Dash"), by its name: its link opens the app, kept only for an app the viewer may open. */
  app: words(60).optional(),
  /** A second line: "at level Reader", or the area. */
  detail: words(120).optional(),
  /** The roles (or other records) that give it: "via Floor Manager", each a link. */
  via: z.array(named).max(WORKED_OUT_LIMITS.via),
  /** The one-line chain Why? opens: "Priya S. → Floor Manager (Store C · First floor) → Vendor Sales", part by part.
   *  A step's area is its detail parts, each a record the platform checks (Codex adversarial round 1): never free words,
   *  which could name a record the viewer may not read. The app gives the chain only to a viewer who may see why;
   *  without it the row offers no Why?. */
  why: z.array(named.extend({ detailParts: z.array(named).min(1).max(10).optional() }).strict()).min(2).max(WORKED_OUT_LIMITS.why).optional(),
}).strict()

export const workedOutSchema = z.object({
  version: z.literal(1),
  sections: z.array(z.object({
    /** Title Case, no pronoun to guess: "Apps They Can Open". */
    heading: words(60),
    /** After the count: "worked out from their roles". */
    note: words(60).optional(),
    /** The muted line when the section has no rows: "No apps from roles yet". */
    empty: words(80),
    rows: z.array(workedOutRowSchema).max(WORKED_OUT_LIMITS.rows),
  }).strict()).max(WORKED_OUT_LIMITS.sections),
}).strict()

export type WorkedOut = z.infer<typeof workedOutSchema>
export type WorkedOutRow = z.infer<typeof workedOutRowSchema>
/** GET /api/worked-out/:table/:row: the sections, checked and scrubbed for the viewer; none where no app works any out. */
export interface WorkedOutAnswer { sections: WorkedOut['sections'] }
