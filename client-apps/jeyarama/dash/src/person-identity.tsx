// Who a person is, beside their name (#1216): many staff share a name, so the Report access page
// shows each person's employee code and the jobs they hold today, with the site. Three layouts
// sit behind a toggle while the owner picks one; the choice is remembered in this browser only.
import { createContext, useContext, useState, type ReactNode } from 'react'
import { Segmented } from '@featherbase/shop-floor'

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
export function PersonName({ name, who, strong = false }: { name: string; who: Who | undefined; strong?: boolean }) {
  const { layout } = useContext(Layout)
  const named = <span className={strong ? 'font-semibold' : undefined}>{name}</span>
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
