import { z } from 'zod'

// #1340: an installed app describes rows of a Table it declares in its manifest's
// `records`, by one of its reads, run as the viewer. The generic list draws the
// facts as columns after the Table's own and the actions as its Record actions;
// the generic record page draws the header line and the Links groups. The
// platform checks the answer against this one versioned shape first: an answer
// that is not it is refused whole, and the page is drawn as if there were none.

// A group's lines: a role's people, all of them (a page shows the first ten, then Show all).
export const RECORD_FACTS_LIMITS = { rows: 500, columns: 8, groups: 8, lines: 2000, actions: 6, parts: 24 } as const

const words = (max: number) => z.string().trim().min(1).max(max)
const record = z.object({ table: words(200), row: words(200), name: words(200) }).strict()

/** The tones a fact or chip may take: each repeats what its words say. */
export const RECORD_FACT_TONES = ['neutral', 'quiet', 'positive', 'caution', 'negative', 'opportunity', 'missing'] as const
const tone = z.enum(RECORD_FACT_TONES)

/** One part of a sentence: words, a record (a link), or a muted chip (a reach). */
export const sentencePartSchema = z.union([
  z.string().max(300),
  z.object({ record }).strict(),
  z.object({ chip: words(40) }).strict(),
])
const sentence = z.array(sentencePartSchema).min(1).max(RECORD_FACTS_LIMITS.parts)

/** A list cell: words, shown as a status pill when it has a tone. */
export const recordFactSchema = z.object({ text: words(120), tone: tone.optional() }).strict()

/** One line of a group: a sentence, a quiet note under it, and a chip on its right (where it came from). */
export const recordLineSchema = z.object({
  parts: sentence,
  note: sentence.optional(),
  chip: z.object({ label: words(40), tone: tone.optional() }).strict().optional(),
}).strict()

const link = z.object({ label: words(60), href: z.string().regex(/^\/[^\s]*$/, 'an address on this site') }).strict()

/**
 * A Links group. With `table`, it stands for the platform's own group of that Table's rows pointing at the
 * record: the app gives its heading, a line for each of its rows (by row id), and for a tick list a note for each
 * far-side choice (by its row id). Without `table`, it is the app's own group of `lines`, with `count` (the whole
 * number, when only the first lines are sent), and where to see them all.
 */
export const recordGroupSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
  heading: words(60),
  table: words(200).optional(),
  rows: z.record(words(200), recordLineSchema).optional(),
  // A note is words, or a sentence whose records are links ("Also given to [Floor Manager] and [Buyer]").
  notes: z.record(words(200), z.union([words(200), sentence])).optional(),
  lines: z.array(recordLineSchema).max(RECORD_FACTS_LIMITS.lines).optional(),
  count: z.number().int().min(0).optional(),
  /** Where every line is, beside the first ones ("Show all 25"). */
  all: link.optional(),
  /** A Check column of the group's Table that marks a row taken away (the app keeps it for its history): such a row is
   *  neither shown nor ticked; unticking sets it, and ticking that choice again clears it. */
  removedColumn: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).optional(),
  /** For a tick list: the only fields a tick asks for (none: a tick gives the link at once). */
  tickFields: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)).max(8).optional(),
  /** Other ways to see the group: Open as grid, Open as list. */
  links: z.array(link).max(3).optional(),
}).strict().refine((g) => !(g.table && g.lines), { message: 'A group stands for a link group or has its own lines, not both' })

/** A list's Record action: run one of the app's actions in place, or open a page. */
export const recordActionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
  label: words(60),
  /** One line saying what it does. */
  explain: words(200),
  /** One of the app's actions, run with an empty payload. */
  run: z.string().regex(/^[a-z][a-z0-9_]{0,60}$/).optional(),
  /** A page: the platform's preview of an action (`/featherbase/admin/table/<t>/run/<action>`) or any address. */
  href: link.shape.href.optional(),
}).strict().refine((a) => Boolean(a.run) !== Boolean(a.href), { message: 'An action runs or opens a page, one of the two' })

export const recordFactsSchema = z.object({
  version: z.literal(1),
  columns: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), label: words(40) }).strict())
    .max(RECORD_FACTS_LIMITS.columns).optional(),
  rows: z.record(words(200), z.object({
    facts: z.record(z.string(), recordFactSchema).optional(),
    header: words(200).optional(),
    groups: z.array(recordGroupSchema).max(RECORD_FACTS_LIMITS.groups).optional(),
  }).strict()),
  actions: z.array(recordActionSchema).max(RECORD_FACTS_LIMITS.actions).optional(),
}).strict()

export type RecordFacts = z.infer<typeof recordFactsSchema>
export type RecordFact = z.infer<typeof recordFactSchema>
export type RecordLine = z.infer<typeof recordLineSchema>
export type RecordGroup = z.infer<typeof recordGroupSchema>
export type RecordAction = z.infer<typeof recordActionSchema>

/** What the server answers: the app that described the rows (to run its actions), and the checked facts, or none. */
export interface RecordFactsAnswer { app: string; version: string; facts: RecordFacts }

// #1340: the preview of an action, before it runs: one sentence, rows a filter can narrow, and nothing saved.
const cell = z.union([recordFactSchema, z.object({ parts: sentence }).strict()])
export const actionPreviewSchema = z.object({
  version: z.literal(1),
  title: words(80),
  status: words(200),
  sentence,
  runLabel: words(30),
  // `count`: how many lines of the whole plan fall under the filter, when the rows sent are only the first ones.
  filters: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), label: words(40), count: z.number().int().min(0).optional() }).strict()).max(6),
  /** How many lines the whole plan has, when only the first ones are sent. */
  total: z.number().int().min(0).optional(),
  // `nowrap`: a column of short names or chips kept on one line, so a longer column beside it takes the wrap.
  columns: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), label: words(40), nowrap: z.boolean().optional() }).strict()).min(1).max(8),
  rows: z.array(z.object({ filter: z.string(), cells: z.record(z.string(), cell) }).strict()).max(RECORD_FACTS_LIMITS.rows),
  note: words(300).optional(),
}).strict()
export type ActionPreview = z.infer<typeof actionPreviewSchema>
export interface ActionPreviewAnswer { app: string; version: string; label: string; preview: ActionPreview }

// #1340: what a run did, in the app's words, a record named in them a link (the run kept, say). Other keys pass through.
export const actionDoneSchema = z.object({ said: sentence })
export type ActionDone = z.infer<typeof actionDoneSchema>
