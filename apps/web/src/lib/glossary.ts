import { useQuery } from '@tanstack/react-query'
import { api } from './api'

// #629: the glossary, as GET /api/glossary answers it: the terms of every
// installed, turned-on app, then the instance's own, and whether this person
// may edit them. Read once and shared by the Glossary page and every "?".

export interface GlossaryTerm {
  id: string
  term: string
  /** The app that ships the term, or null for the instance's own. */
  app: string | null
  appTitle: string | null
  definition: string
  examples: string[]
  avoid: { word: string; reason: string | null }[]
  /** columnLabel: the column's label, as forms show it. */
  describes: { table: string; column: string | null; columnLabel: string | null }[]
  /** An app's term someone here reworded. */
  editedHere: boolean
  /** …and the app has since shipped different wording of its own. */
  appWordingChanged: boolean
}

export interface Glossary {
  /** A write grant: rewording a term. */
  canEdit: boolean
  /** A create grant: adding one. */
  canAdd: boolean
  terms: GlossaryTerm[]
}

export const GLOSSARY_QUERY_KEY = ['glossary'] as const
export const GLOSSARY_PATH = '/featherbase/admin/glossary'
export const GLOSSARY_TABLE = 'Glossary Term'

export function useGlossary() {
  return useQuery({
    queryKey: GLOSSARY_QUERY_KEY,
    queryFn: () => api.get<Glossary>('/api/glossary'),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

/** The terms that describe `table` itself (no column given) or one of its
 *  columns. */
export function termsDescribing(terms: readonly GlossaryTerm[] | undefined, table: string, column?: string): GlossaryTerm[] {
  return (terms ?? []).filter((t) => t.describes.some((d) => d.table === table && d.column === (column ?? null)))
}

/** Does the term match a search? Its name, its words to avoid and its
 *  definition, ignoring case. */
export function termMatches(term: GlossaryTerm, query: string): boolean {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return true
  return [term.term, term.definition, ...term.avoid.map((a) => a.word)]
    .some((text) => text.toLocaleLowerCase().includes(q))
}

/** The terms in their groups, in the order the server sends them: each app
 *  under its title, then the instance's own. */
export function groupTerms(terms: readonly GlossaryTerm[]): { key: string; title: string; terms: GlossaryTerm[] }[] {
  const groups: { key: string; title: string; terms: GlossaryTerm[] }[] = []
  for (const term of terms) {
    const key = term.app ?? ''
    const group = groups.find((g) => g.key === key)
    if (group) group.terms.push(term)
    else groups.push({ key, title: term.appTitle ?? 'This instance', terms: [term] })
  }
  return groups
}

export function termAnchor(id: string): string {
  return `term-${id}`
}
