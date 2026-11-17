// #1222: View as in the shared top bar. A View As Tester picks a person and
// every page shows what that person sees; the server keeps the state. While
// viewing, the page is marked (VIEWING_AS_ATTRIBUTE) so an app hides what
// would change something. Starting, switching and exiting reload the page, so
// nothing read as one person is ever shown as another.
//
// Two ways in to the same picker (owner, 17-Nov-2026: C and B): a "View as"
// button on the bar opens it as a dropdown, and Ctrl/⌘+Shift+K opens it as a
// window in the middle of the page. Dash's "What a person sees" offers a third
// (E), which starts View as directly.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api, getSessionUser } from '../lib/api'
import { historyPaused, pauseHistory } from '../lib/recents'
import { Eye, History, Search, Clock, UserRoundSearch, RecordLink, buttonClasses, cardClasses, iconButtonClasses, inputClasses } from '@featherbase/shop-floor'

export interface ViewAsPerson {
  person: string
  name: string
  code?: string | null
  jobs?: string[]
}
export interface ViewAsState {
  may: boolean
  viewing?: (ViewAsPerson & { expires_at: string }) | null
  recent?: ViewAsPerson[]
  frequent?: ViewAsPerson[]
  minutes?: number
  /** Whether the tester may open a person's record: the names link to it, else stay plain text. */
  person_link?: boolean
}

/** On the document's root while viewing, for an app's own page to hide what would change something. */
export const VIEWING_AS_ATTRIBUTE = 'data-featherbase-viewing-as'

/** Whether this person may view as someone, whom they view now, and their Recent and Frequently used. */
export function useViewAs() {
  return useQuery({
    queryKey: ['view-as'],
    queryFn: () => api.get<ViewAsState>('/api/view_as'),
    enabled: Boolean(getSessionUser()),
    staleTime: 30_000,
    // Asked again now and then and on return to the tab: View as can end on the server.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

/** Reloads the page when whom it shows changes under it (View as ended, or switched in another tab). */
function useReloadOnChange(state: ViewAsState | undefined, error: unknown) {
  const shown = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (error instanceof ApiError && error.status === 409) { window.location.reload(); return }
    if (!state) return
    const now = state.may ? state.viewing?.person ?? null : null
    // The history marker went stale (View as ended while this tab was away): fix it and redraw.
    if (historyPaused() !== (now !== null)) { pauseHistory(now !== null); window.location.reload(); return }
    if (shown.current !== undefined && shown.current !== now) window.location.reload()
    shown.current = now
  }, [state, error])
}

/** "KL-1234 · Team Leader · Lakeside", and how many more jobs. */
export function identityLine(person: ViewAsPerson): string {
  const jobs = person.jobs ?? []
  // #1216's words for someone with no staff record.
  return [person.code, jobs[0], jobs.length > 1 ? `+${jobs.length - 1} more` : null].filter(Boolean).join(' · ') || 'Not on the staff list'
}

/** Other tabs on this sign-in are told, and reload too, so no page mixes two people. */
const CHANGED_KEY = 'featherbase.view-as.changed'
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => { if (event.key === CHANGED_KEY) window.location.reload() })

async function changeView(path: string, body: unknown, onError: (message: string) => void) {
  try {
    await api.post(path, body)
    pauseHistory(path.endsWith('/start'))
    try { window.localStorage.setItem(CHANGED_KEY, String(Date.now())) } catch { /* private window: this tab only */ }
    window.location.reload()
  } catch (error) {
    onError(error instanceof ApiError ? error.message : 'Could not change the view. Try again.')
  }
}

/** One person: their record (a link when the tester may open it, #1227) and the button that views as them. */
function PersonRow({ person, onPick, linked }: { person: ViewAsPerson; onPick: (person: ViewAsPerson) => void; linked: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-action-tint" data-testid="view-as-person">
      <span className="min-w-0 flex-1 truncate text-sm">
        <RecordLink table="Person" rowId={person.person} name={person.name} detail={identityLine(person)} layout="two-lines" canOpen={linked} />
      </span>
      <button type="button" onClick={() => onPick(person)} aria-label={`View as ${person.name}`} data-testid="view-as-pick"
        className={buttonClasses({ variant: 'secondary', className: 'shrink-0 px-2 text-xs max-sm:min-h-11' })}>View as</button>
    </div>
  )
}

function Section({ title, icon, people, onPick, testid, linked }: { title: string; icon: ReactNode; people: ViewAsPerson[]; onPick: (p: ViewAsPerson) => void; testid: string; linked: boolean }) {
  if (!people.length) return null
  return (
    <div data-testid={testid}>
      <h3 className="flex items-center gap-1.5 px-2 pb-0.5 pt-2 text-xs font-medium text-ink-subtle">{icon}{title}</h3>
      {people.map((person) => <PersonRow key={person.person} person={person} onPick={onPick} linked={linked} />)}
    </div>
  )
}

/** The picker itself: search by name, employee code, or job and store, then Recent and Frequently used. */
export function ViewAsPicker({ state, autoFocus = false }: {
  state: ViewAsState
  autoFocus?: boolean
}) {
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 200)
    return () => clearTimeout(timer)
  }, [typed])
  const found = useQuery({
    queryKey: ['view-as-people', query],
    queryFn: () => api.get<ViewAsPerson[]>(`/api/view_as/people?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
  })
  const pick = (person: ViewAsPerson) => void changeView('/api/view_as/start', { person: person.person }, setError)
  const viewing = state.viewing?.person
  const cap = 5
  const recent = (state.recent ?? []).filter((p) => p.person !== viewing).slice(0, cap)
  // Like Featherbase's sidebar, someone can be both recent and frequent.
  const frequent = (state.frequent ?? []).filter((p) => p.person !== viewing).slice(0, cap)
  return (
    <div className="flex flex-col gap-1" data-testid="view-as-picker">
      <label htmlFor={inputId} className="sr-only">Find a person to view as</label>
      <div className="relative">
        <Search aria-hidden size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
        <input
          id={inputId}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && found.data?.[0]) pick(found.data[0]) }}
          placeholder="Name, code, or job and store"
          data-testid="view-as-search"
          className={inputClasses('w-full pl-8')}
        />
      </div>
      {error && <p role="alert" className="px-2 text-xs text-negative" data-testid="view-as-error">{error}</p>}
      <div className="max-h-[min(55vh,24rem)] overflow-y-auto">
        {query.length >= 2 ? (
          found.isPending ? <p className="px-2 py-2 text-xs text-ink-subtle">Looking…</p>
            : found.data && found.data.length > 0 ? (
              <div data-testid="view-as-results">
                {found.data.map((person) => <PersonRow key={person.person} person={person} onPick={pick} linked={Boolean(state.person_link)} />)}
              </div>
            ) : <p className="px-2 py-2 text-xs text-ink-subtle" data-testid="view-as-none">No one found. Try a name, an employee code, or a job and a store, like “Team Leader Lakeside”.</p>
        ) : (
          <>
            <Section title="Recent" icon={<History aria-hidden size={12} />} people={recent} onPick={pick} testid="view-as-recent" linked={Boolean(state.person_link)} />
            <Section title="Frequently used" icon={<Clock aria-hidden size={12} />} people={frequent} onPick={pick} testid="view-as-frequent" linked={Boolean(state.person_link)} />
            {!recent.length && !frequent.length && (
              <p className="px-2 py-2 text-xs text-ink-subtle">You haven’t viewed as anyone yet. Search by name, employee code, or job and store.</p>
            )}
          </>
        )}
      </div>
      <p className="mt-1 border-t border-border px-2 pt-2 text-xs text-ink-subtle">For looking only: you see what they see. Ends after {state.minutes ?? 60} minutes.</p>
    </div>
  )
}

/** Closes on a click outside (by the event's path: the bar is in a shadow root) or Escape. */
function useDismiss(open: boolean, close: () => void, inside: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (inside.current && !e.composedPath().includes(inside.current)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, close, inside])
}

/** The banner while viewing: who, for viewing only, Switch and Exit. */
export function ViewAsBanner() {
  const { data, error: stateError } = useViewAs()
  useReloadOnChange(data, stateError)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  useDismiss(switching, () => setSwitching(false), wrapper)
  const viewing = data?.may ? data.viewing : null
  // The page is marked while viewing, so an app's own page hides what would change something.
  useEffect(() => {
    const root = document.documentElement
    if (viewing) root.setAttribute(VIEWING_AS_ATTRIBUTE, '')
    else root.removeAttribute(VIEWING_AS_ATTRIBUTE)
  }, [viewing])
  // When its time is up the server reads as the tester again: reload, so nothing on the page mixes the two.
  const endsAt = viewing?.expires_at
  useEffect(() => {
    if (!endsAt) return
    const timer = setTimeout(() => window.location.reload(), Math.max(0, Math.min(Date.parse(endsAt) - Date.now() + 1000, 2 ** 31 - 1)))
    return () => clearTimeout(timer)
  }, [endsAt])
  if (!data || !viewing) return null
  const line = identityLine(viewing)
  return (
    <div ref={wrapper} role="status" data-testid="view-as-banner" className="relative z-30 shrink-0 bg-ink px-3 py-1.5 text-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Eye aria-hidden size={16} className="shrink-0" />
        <p className="min-w-0 flex-1 text-sm">
          Viewing as <strong data-testid="view-as-name"><RecordLink table="Person" rowId={viewing.person} name={viewing.name} canOpen={Boolean(data.person_link)} className="text-surface" /></strong>
          {line && <span className="opacity-80"> · {line}</span>}
          <span className="ml-2 inline-block rounded-full bg-caution px-2 py-0.5 align-middle text-xs font-semibold uppercase tracking-wide text-surface">For viewing only</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setSwitching((s) => !s)} aria-expanded={switching} data-testid="view-as-switch"
            className="rounded-control border border-surface/40 px-3 py-1 text-sm font-medium hover:bg-surface/10 max-sm:min-h-11">Switch</button>
          <button type="button" onClick={() => void changeView('/api/view_as/exit', {}, setError)} data-testid="view-as-exit"
            className="rounded-control bg-surface px-3 py-1 text-sm font-semibold text-ink hover:opacity-90 max-sm:min-h-11">Exit</button>
        </div>
      </div>
      {error && <p role="alert" className="mt-1 text-xs">{error}</p>}
      {switching && (
        <div className={cardClasses('absolute right-2 top-full z-40 mt-1 w-[min(26rem,calc(100vw-1rem))] p-2 text-ink')} data-testid="view-as-switch-panel">
          <ViewAsPicker state={data} autoFocus />
        </div>
      )}
    </div>
  )
}

/**
 * C: a "View as" button on the bar opens the picker under it. B: Ctrl/⌘+Shift+K opens the same
 * picker as a window in the middle of the page. Only someone who may view as anyone sees either.
 */
export function ViewAsButton({ compact, place = 'bar' }: {
  compact: boolean
  /** #1253: beside the bell at the sidebar's top (an icon, its list opening
   *  over the page), or in the rail; the top bar's form elsewhere. */
  place?: 'bar' | 'sidebar' | 'rail'
}) {
  const { data } = useViewAs()
  const [open, setOpen] = useState<'dropdown' | 'window' | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  useDismiss(open !== null, () => setOpen(null), panel)
  const may = Boolean(data?.may)
  useEffect(() => {
    if (!may) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen('window') }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [may])
  if (!may || !data) return null
  return (
    <div className="relative" ref={open === 'dropdown' ? panel : undefined}>
      {/* While viewing, the banner's Switch and Exit take its place; Ctrl+Shift+K still opens the picker. */}
      {!data.viewing && <button type="button" onClick={() => setOpen(open === 'dropdown' ? null : 'dropdown')} aria-expanded={open === 'dropdown'} data-testid="view-as-button"
        aria-label={place === 'bar' && !compact ? undefined : 'View as someone'}
        title="View as someone (Ctrl+Shift+K)"
        className={place === 'bar'
          ? buttonClasses({ variant: 'secondary', className: compact ? 'size-control px-0' : 'gap-1.5' })
          : iconButtonClasses(place === 'rail' ? 'size-10 text-ink-muted hover:bg-border/50 hover:text-ink' : 'size-8 text-ink-muted hover:bg-border/50 hover:text-ink')}>
        <UserRoundSearch aria-hidden size={place === 'rail' ? 18 : 16} />{place === 'bar' && !compact && <span>View as</span>}
      </button>}
      {open === 'dropdown' && (
        <div className={cardClasses(`absolute ${place === 'bar' ? 'right-0' : 'left-0'} top-full z-40 mt-1 w-[min(26rem,calc(100vw-1rem))] p-2`)} role="dialog" aria-label="View as" data-testid="view-as-dropdown">
          <ViewAsPicker state={data} autoFocus />
        </div>
      )}
      {open === 'window' && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim/40 px-2 pt-[12vh]" data-testid="view-as-palette">
          <div ref={panel} role="dialog" aria-modal="true" aria-label="View as" className={cardClasses('w-[min(36rem,100%)] p-3')}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><UserRoundSearch aria-hidden size={16} />View as someone</h2>
            <ViewAsPicker state={data} autoFocus />
          </div>
        </div>
      )}
    </div>
  )
}
