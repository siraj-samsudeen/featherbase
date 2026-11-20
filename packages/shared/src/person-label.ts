import { fmtDayIST } from './dates'

// #1345: the Person Label. Every surface that names a person reads who they are
// beside the name: `employee code · business role · place`. The server works the
// values out once (apps/server/src/person-labels.ts); these words are the one
// place they are put into a sentence, so every surface reads them alike.

/** A person's label, as the viewer may see it. Every part is optional. */
export interface PersonLabel {
  /** The main current employee code: the latest-joined current one. */
  code?: string
  /** Their other current codes, each with its record where the viewer may open it. */
  more_codes?: { code: string; table?: string; row_id?: string }[]
  role?: string
  place?: string
  standing?: 'current' | 'left' | 'consultant' | 'supplier'
  /** YYYY-MM-DD, with standing `left`. */
  left_on?: string
  company?: string
  email?: string
}

/** One part of the words beside a name, with what it is, so a narrow space can drop the role first. */
export interface PersonMetaPart {
  kind: 'code' | 'role' | 'place' | 'standing' | 'left' | 'company' | 'email'
  text: string
}

/** The #1280 badge words. */
const STANDING_WORDS = { left: 'Former Staff', consultant: 'Consultant', supplier: 'Supplier' } as const

/**
 * The words beside a person's name, in order:
 * - Former staff: `Former Staff · left 31-Aug-2026 · E1001`.
 * - A consultant or supplier: `Consultant · <company>`.
 * - Otherwise `code · role · place`, each where known; with none of them, the email.
 * `withEmail` adds the email where two people would otherwise read the same.
 */
export function personMeta(label: PersonLabel | undefined, { withEmail = false }: { withEmail?: boolean } = {}): PersonMetaPart[] {
  if (!label) return []
  const parts: PersonMetaPart[] = []
  const code = label.code ? [{ kind: 'code' as const, text: label.code }] : []
  if (label.standing === 'left') {
    parts.push({ kind: 'standing', text: STANDING_WORDS.left })
    if (label.left_on) parts.push({ kind: 'left', text: `left ${fmtDayIST(label.left_on)}` })
    parts.push(...code)
  } else if (label.standing === 'consultant' || label.standing === 'supplier') {
    parts.push({ kind: 'standing', text: STANDING_WORDS[label.standing] })
    if (label.company) parts.push({ kind: 'company', text: label.company })
  } else {
    parts.push(...code)
    if (label.role) parts.push({ kind: 'role', text: label.role })
    if (label.place) parts.push({ kind: 'place', text: label.place })
  }
  if (label.email && (withEmail || !parts.length)) parts.push({ kind: 'email', text: label.email })
  return parts
}

/** The same words as one line: `E1001 · Store Manager · Lakeside`. */
export function personMetaText(label: PersonLabel | undefined, options?: { withEmail?: boolean }): string {
  return personMeta(label, options).map((p) => p.text).join(' · ')
}

/** The short form for activity lines: `(E1001 · Lakeside)`, or nothing. */
export function personMetaShort(label: PersonLabel | undefined): string {
  const parts = personMeta(label).filter((p) => p.kind === 'code' || p.kind === 'place' || p.kind === 'standing')
  return parts.length ? `(${parts.map((p) => p.text).join(' · ')})` : ''
}

/** For a list of people: which of them need their email added so that no two read the same (item 11). */
export function needsEmail<T extends { title: string; person?: PersonLabel }>(people: readonly T[]): Set<T> {
  const seen = new Map<string, T[]>()
  for (const p of people) {
    const reads = `${p.title}\u0000${personMetaText(p.person)}`
    seen.set(reads, [...(seen.get(reads) ?? []), p])
  }
  return new Set([...seen.values()].filter((same) => same.length > 1).flat())
}
