// Who a person is, beside their name (#1216): many staff share a name, so the Report access page
// shows each person's employee code and the jobs they hold today, with the site. Three layouts
// sit behind a toggle while the owner picks one; the choice is remembered in this browser only.
import { createContext, useContext, useState, type ReactNode } from 'react'
import { Segmented } from '@featherbase/shop-floor'
import { RECORD, RecordLink } from './record-link'

/** As report-access-server.ts's `whoIs` answers it. */
export type Who = { code: string | null; jobs: string[]; staff: 'current' | 'left' | 'none' }

/** What sits beside the name, without the code. */
function standing(who: Who): string {
  if (who.staff === 'none') return 'Not on the staff list'
  if (who.staff === 'left') return 'Left'
  return who.jobs.length ? who.jobs.join(', ') : 'No current job'
}

/** "E1001 · Team Leader · Lakeside", "E0900 · Left", "Not on the staff list". */
export function personDetail(who: Who | undefined): string {
  if (!who) return ''
  return [who.code, standing(who)].filter(Boolean).join(' · ')
}

/** A name in a sentence: "Kumar (E1001)". */
export function personWithCode(name: string, who: Who | undefined): string {
  return who?.code ? `${name} (${who.code})` : name
}

export type PeopleLayout = 'two-lines' | 'one-line' | 'code-first'
const LAYOUTS: { value: PeopleLayout; label: string }[] = [
  { value: 'two-lines', label: 'Two lines' }, { value: 'one-line', label: 'One line' }, { value: 'code-first', label: 'Code first' },
]
const KEY = 'dash.people-layout'

function remembered(): PeopleLayout {
  try {
    const value = localStorage.getItem(KEY)
    return LAYOUTS.some(layout => layout.value === value) ? (value as PeopleLayout) : 'two-lines'
  } catch { return 'two-lines' }
}

const Layout = createContext<{ layout: PeopleLayout; setLayout: (layout: PeopleLayout) => void }>({ layout: 'two-lines', setLayout: () => {} })

export function PeopleLayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setChosen] = useState<PeopleLayout>(remembered)
  const setLayout = (next: PeopleLayout) => {
    setChosen(next)
    try { localStorage.setItem(KEY, next) } catch { /* a private window keeps it for this visit only */ }
  }
  return <Layout.Provider value={{ layout, setLayout }}>{children}</Layout.Provider>
}

/** The toggle between the three layouts, while the owner picks one. */
/** #1225: the people display for a `View ▾` menu: the choice and its options. */
export function usePeopleLayout() {
  const { layout, setLayout } = useContext(Layout)
  return { layout, setLayout, options: LAYOUTS }
}

export function PeopleLayoutToggle() {
  const { layout, setLayout } = useContext(Layout)
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="people-layout">
      <span className="text-sm text-ink-muted">Show people as</span>
      <Segmented label="Show people as" options={LAYOUTS} value={layout} onChange={setLayout} />
    </div>
  )
}

/** A person's name with who they are, in the chosen layout. */
export function PersonName({ name, who, strong = false, id }: { name: string; who: Who | undefined; strong?: boolean
  /** #1225: their Employee record, so the name is a link when the viewer can open it. */
  id?: string | null }) {
  const { layout } = useContext(Layout)
  // Someone not on the staff list has no record to open: the name stays plain text.
  const named = <RecordLink table={RECORD.employee} id={who?.staff === 'none' ? null : id} className={strong ? 'font-semibold' : undefined}>{name}</RecordLink>
  if (!who) return named
  if (layout === 'code-first')
    return (
      <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2" data-testid="person-name" data-layout={layout}>
        {who.code && <span className="rounded-control border border-border bg-subtle px-1.5 font-mono text-xs text-ink" data-testid="person-code">{who.code}</span>}
        {named}
        <span className="text-sm text-ink-muted" data-testid="person-detail">{standing(who)}</span>
      </span>
    )
  if (layout === 'one-line')
    return (
      <span className="min-w-0" data-testid="person-name" data-layout={layout}>
        {named}<span className="text-sm text-ink-muted" data-testid="person-detail"> · {personDetail(who)}</span>
      </span>
    )
  return (
    <span className="inline-flex min-w-0 flex-col" data-testid="person-name" data-layout={layout}>
      {named}<span className="block text-sm text-ink-muted" data-testid="person-detail">{personDetail(who)}</span>
    </span>
  )
}

/** #1219: a reviewer the page names, with who they are, as my-sections.ts's `reviewersOf` answers it. */
export type Reviewer = { name: string; id?: string | null } & Who

/** A reviewer's name as a link to their Employee record; plain text for someone not on the staff list. */
export function ReviewerLink({ reviewer }: { reviewer: Reviewer }) {
  return <RecordLink table={RECORD.employee} id={reviewer.staff === 'none' ? null : reviewer.id}>{reviewer.name}</RecordLink>
}

/** Who the reviewer is, under the sentence that names them: one line each. `named`: the sentence names them
 *  only in words, so each line starts with the name as a link; with two or more it always does. */
export function ReviewerIdentity({ reviewers, named = true, testid = 'reviewer-identity', className = '' }:
  { reviewers: Reviewer[] | undefined; named?: boolean; testid?: string; className?: string }) {
  if (!reviewers?.length) return null
  const withName = named || reviewers.length > 1
  return (
    <span className={`flex flex-col text-sm text-ink-muted ${className}`} data-testid={testid}>
      {reviewers.map((reviewer, index) => <span key={`${reviewer.code ?? reviewer.name}-${index}`}>{withName && <><ReviewerLink reviewer={reviewer} /> · </>}{personDetail(reviewer)}</span>)}
    </span>
  )
}

/** Names as links in a sentence: "A", "A or B". */
export function ReviewerNames({ reviewers }: { reviewers: Reviewer[] }) {
  return <>{reviewers.map((reviewer, index) => <span key={`${reviewer.code ?? reviewer.name}-${index}`}>{index ? ' or ' : ''}<ReviewerLink reviewer={reviewer} /></span>)}</>
}

/** #1219: on a review card, whoever else may decide it, the viewer left out: a Master Data Editor sees the manager. */
export function AlsoWith({ reviewers }: { reviewers: Reviewer[] | undefined }) {
  if (!reviewers?.length) return null
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="also-with">
      <span className="text-ink-muted">Also with</span>
      {reviewers.map((reviewer, index) => <PersonName key={`${reviewer.code ?? reviewer.name}-${index}`} name={reviewer.name} who={reviewer} id={reviewer.id} />)}
    </div>
  )
}
