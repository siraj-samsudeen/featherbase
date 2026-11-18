import { z } from 'zod'

// #1282 (Why mode, E6–E7): an app explains a record of a Table it declares in its
// manifest's `why`, by one of its reads. The platform draws that answer as
// columns of boxes joined by edges, and checks it against this one versioned
// shape first: an answer that is not it is refused whole, never half drawn.

/** The most a Why map holds: past about 30 boxes a map stops being readable (design). */
export const WHY_LIMITS = { columns: 6, boxesPerColumn: 12, boxes: 40, edges: 200 } as const

/** The words on the toggle when the app gives none (Title Case, no pronoun to guess). */
export const WHY_DEFAULT_LABEL = 'Why: Access'

/** A Why label reads "Why: …" in Title Case: each word starts with a capital (or is a number). */
export const WHY_LABEL = /^Why: [A-Z0-9][\w'’-]*( (?:[A-Z0-9][\w'’-]*|·))*$/

const words = (max: number) => z.string().trim().min(1).max(max)

export const whyBoxSchema = z.object({
  id: words(80),
  name: words(120),
  /** A second line: the area, the level, the app. */
  detail: words(120).optional(),
  /** Where a role came from: HR's title, or given by hand. */
  source: z.enum(['hr', 'hand']).optional(),
  /** How far a permission reaches: Own, Team, Area or All. */
  reach: words(20).optional(),
  /** The record the box names, opened by its link. */
  record: z.object({ table: words(200), row: words(200) }).strict().optional(),
  /** A detail that names records (an area: "Sarees · Lakeside"), part by part, each record a link. The platform
   *  shows it only to someone who may read every record in it. A box has a detail or detail parts, not both. */
  detailParts: z.array(z.object({
    name: words(80),
    record: z.object({ table: words(200), row: words(200) }).strict().optional(),
  }).strict()).min(1).max(10).optional(),
}).strict().refine((b) => !(b.detail && b.detailParts), { message: 'A box has a detail or detail parts, not both' })

export const whyAnswerSchema = z.object({
  version: z.literal(1),
  columns: z.array(z.object({
    heading: words(60),
    boxes: z.array(whyBoxSchema).min(1).max(WHY_LIMITS.boxesPerColumn),
  }).strict()).min(1).max(WHY_LIMITS.columns),
  /** [from box id, to box id]: from a column to one further right. */
  edges: z.array(z.tuple([words(80), words(80)])).max(WHY_LIMITS.edges),
}).strict().superRefine((answer, ctx) => {
  const column = new Map<string, number>()
  answer.columns.forEach((c, i) => c.boxes.forEach((b) => {
    if (column.has(b.id)) ctx.addIssue({ code: 'custom', message: `Two boxes are both ${b.id}` })
    column.set(b.id, i)
  }))
  if (column.size > WHY_LIMITS.boxes) ctx.addIssue({ code: 'custom', message: `More than ${WHY_LIMITS.boxes} boxes` })
  for (const [from, to] of answer.edges) {
    const a = column.get(from)
    const b = column.get(to)
    if (a === undefined || b === undefined) ctx.addIssue({ code: 'custom', message: `An edge joins a box that is not there: ${from} → ${to}` })
    else if (a >= b) ctx.addIssue({ code: 'custom', message: `An edge must lead to a column further right: ${from} → ${to}` })
  }
})

export type WhyBox = z.infer<typeof whyBoxSchema>
export type WhyAnswer = z.infer<typeof whyAnswerSchema>

/** What the platform says about explaining one record: whether it may, and the toggle's words. */
export interface WhyOffer {
  offer: { label: string } | null
}

/** A checked explanation, its named records scrubbed for the viewer. */
export interface WhyExplained {
  label: string
  answer: WhyAnswer
}
