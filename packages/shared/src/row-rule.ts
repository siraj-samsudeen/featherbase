import { z } from 'zod'

// #1459: who reads which rows of a Table. Every Table declares one rule from this closed set; a Table that declares
// none is read by System Managers only. A grant still decides who reaches the Table and with which operations; the
// rule decides which of its rows. Places (#1454) are one kind among these.

const column = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const distinct = (values: string[]) => new Set(values).size === values.length
/** Roles that read every row whatever the rule says (a head-office role on a Table about places, say). */
const wholeFor = z.array(z.string().min(1)).min(1).refine(distinct, 'Each role is named once').optional()

export const rowRuleSchema = z.discriminatedUnion('kind', [
  /** Every row, to whoever a grant reaches. */
  z.object({ kind: z.literal('all') }).strict(),
  /** The rows a person created, and those naming them in one of `columns` (References to Person). */
  z.object({ kind: z.literal('own'), columns: z.array(column).min(1).refine(distinct, 'Each column is named once').optional(), whole_for: wholeFor }).strict(),
  /** The rows within the person's places on the org chart: scope filter → column. A row they wrote is theirs too. */
  z.object({
    kind: z.literal('places'),
    columns: z.record(column, column).refine((columns) => Object.keys(columns).length > 0, 'Map at least one scope filter to a column'),
    whole_for: wholeFor,
  }).strict(),
  /** The rows whose `column` (a Reference) names a row the person can read. */
  z.object({ kind: z.literal('through'), column, whole_for: wholeFor }).strict(),
  /** System Managers only. */
  z.object({ kind: z.literal('administrators') }).strict(),
])
export type RowRule = z.infer<typeof rowRuleSchema>
export const ROW_RULE_KINDS = ['all', 'own', 'places', 'through', 'administrators'] as const

/** The rule in a few words, for the screens and reports that list Tables' rules. */
export function rowRuleWords(rule: RowRule | null | undefined): string {
  if (!rule) return 'No rule: System Managers only'
  const whole = 'whole_for' in rule && rule.whole_for?.length ? `; every row for ${rule.whole_for.join(', ')}` : ''
  switch (rule.kind) {
    case 'all': return 'Every row'
    case 'own': return `Own rows${rule.columns?.length ? ` (created, or named in ${rule.columns.join(', ')})` : ''}${whole}`
    case 'places': return `Within the person's places (${Object.entries(rule.columns).map(([filter, col]) => `${filter}: ${col}`).join(', ')})${whole}`
    case 'through': return `Through ${rule.column}${whole}`
    case 'administrators': return 'System Managers only'
  }
}
