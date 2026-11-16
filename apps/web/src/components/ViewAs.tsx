// #1222: View as in the shared top bar. A View As Tester picks a person and
// every page shows what that person sees; the server keeps the state. While
// viewing, the page is marked (VIEWING_AS_ATTRIBUTE) so an app hides what
// would change something. Starting, switching and exiting reload the page, so
// nothing read as one person is ever shown as another.
//
// Two ways to pick, behind a toggle while the owner chooses one (remembered
// in this browser): from the avatar menu, or from a command-palette window.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api, getSessionUser } from '../lib/api'
import { Eye, History, Search, Clock, UserRoundSearch, Segmented, buttonClasses, cardClasses, inputClasses } from '@featherbase/shop-floor'

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
}

export type PickerStyle = 'menu' | 'palette'
const PICKER_KEY = 'featherbase.view-as.picker'
/** On the document's root while viewing, for an app's own page to hide what would change something. */
export const VIEWING_AS_ATTRIBUTE = 'data-featherbase-viewing-as'
const CHOICE_EVENT = 'featherbase:view-as-choice'

/** A choice kept in this browser, shared by every part of the bar. */
function useChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const read = () => {
    try {
      const stored = window.localStorage.getItem(key) as T | null
      return stored && allowed.includes(stored) ? stored : fallback
    } catch { return fallback }
  }
  const [value, setValue] = useState<T>(read)
  useEffect(() => {
    const sync = () => setValue(read())
    window.addEventListener(CHOICE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(CHOICE_EVENT, sync); window.removeEventListener('storage', sync) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return [value, (next: T) => {
    try { window.localStorage.setItem(key, next) } catch { /* private window: this page only */ }
    setValue(next)
    window.dispatchEvent(new Event(CHOICE_EVENT))
  }]
}
export const usePickerStyle = () => useChoice<PickerStyle>(PICKER_KEY, 'menu', ['menu', 'palette'])

/** Whether this person may view as someone, whom they view now, and their Recent and Frequently used. */
export function useViewAs() {
  return useQuery({
    queryKey: ['view-as'],
    queryFn: () => api.get<ViewAsState>('/api/view_as'),
    enabled: Boolean(getSessionUser()),
    staleTime: 60_000,
  })
}

/** "KL-1234 · Team Leader · Lakeside", and how many more jobs. */
export function identityLine(person: ViewAsPerson): string {
  const jobs = person.jobs ?? []
  return [person.code, jobs[0], jobs.length > 1 ? `+${jobs.length - 1} more` : null].filter(Boolean).join(' · ')
}

async function changeView(path: string, body: unknown, onError: (message: string) => void) {
  try {
    await api.post(path, body)
    window.location.reload()
  } catch (error) {
    onError(error instanceof ApiError ? error.message : 'Could not change the view. Try again.')
  }
}

function PersonRow({ person, onPick, icon }: { person: ViewAsPerson; onPick: (person: ViewAsPerson) => void; icon?: ReactNode }) {
  const line = identityLine(person)
  return (
    <button
      type="button"
      onClick={() => onPick(person)}
      data-testid="view-as-person"
      className="flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left hover:bg-action-tint focus-visible:outline-2 focus-visible:outline-focus max-sm:min-h-11"
    >
      {icon && <span className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden="true">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{person.name}</span>
        {line && <span className="block truncate text-xs text-ink-subtle">{line}</span>}
      </span>
    </button>
  )
}

function Section({ title, icon, people, onPick, testid }: { title: string; icon: ReactNode; people: ViewAsPerson[]; onPick: (p: ViewAsPerson) => void; testid: string }) {
  if (!people.length) return null
  return (
    <div data-testid={testid}>
      <h3 className="flex items-center gap-1.5 px-2 pb-0.5 pt-2 text-xs font-medium text-ink-subtle">{icon}{title}</h3>
      {people.map((person) => <PersonRow key={person.person} person={person} onPick={onPick} />)}
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
  const frequent = (state.frequent ?? []).filter((p) => p.person !== viewing && !recent.some((r) => r.person === p.person)).slice(0, cap)
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
                {found.data.map((person) => <PersonRow key={person.person} person={person} onPick={pick} />)}
              </div>
            ) : <p className="px-2 py-2 text-xs text-ink-subtle" data-testid="view-as-none">No one found. Try a name, an employee code, or a job and a store, like “Team Leader Lakeside”.</p>
        ) : (
          <>
            <Section title="Recent" icon={<History aria-hidden size={12} />} people={recent} onPick={pick} testid="view-as-recent" />
            <Section title="Frequently used" icon={<Clock aria-hidden size={12} />} people={frequent} onPick={pick} testid="view-as-frequent" />
            {!recent.length && !frequent.length && (
              <p className="px-2 py-2 text-xs text-ink-subtle">You haven’t viewed as anyone yet. Search by name, employee code, or job and store.</p>
            )}
          </>
        )}
      </div>
      <StyleChoices minutes={state.minutes ?? 60} />
    </div>
  )
}

/** While the owner chooses: which picker. */
function StyleChoices({ minutes }: { minutes: number }) {
  const [picker, setPicker] = usePickerStyle()
  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-border px-2 pt-2" data-testid="view-as-choices">
      <p className="text-xs text-ink-subtle">For looking only: you see what they see. Ends after {minutes} minutes.</p>
      <span className="flex items-center gap-1.5 text-xs text-ink-subtle">Picker
        <Segmented label="Picker" value={picker} onChange={setPicker}
          options={[{ value: 'menu', label: 'Menu' }, { value: 'palette', label: 'Palette' }]} />
      </span>
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

/** The banner while viewing: who, for viewing only, Switch and Exit. Always shown, whichever picker style. */
export function ViewAsBanner() {
  const { data } = useViewAs()
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
          Viewing as <strong data-testid="view-as-name">{viewing.name}</strong>
          {line && <span className="opacity-80"> · {line}</span>}
          <span className="ml-2 inline-block rounded-full bg-caution px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide text-surface">For viewing only</span>
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

/** Style 1: "View as…" in the avatar menu; the menu becomes the picker. */
export function ViewAsMenuEntry({ onOpen }: { onOpen: () => void }) {
  const { data } = useViewAs()
  const [style] = usePickerStyle()
  if (!data?.may || style !== 'menu') return null
  return (
    <button role="menuitem" type="button" onClick={onOpen} data-testid="view-as-menu-item"
      className="flex min-h-control w-full items-center gap-2 px-3 text-left text-sm text-ink hover:bg-action-tint">
      <UserRoundSearch aria-hidden size={16} className="text-ink-subtle" />View as…
    </button>
  )
}

/** Style 2: a "View as" button in the bar and Ctrl/⌘+Shift+K open a palette window. */
export function ViewAsPaletteButton({ compact }: { compact: boolean }) {
  const { data } = useViewAs()
  const [style] = usePickerStyle()
  const [open, setOpen] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), card)
  const active = Boolean(data?.may) && style === 'palette'
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active])
  if (!active || !data) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="view-as-palette-button" title="View as (Ctrl+Shift+K)"
        className={buttonClasses({ variant: 'secondary', className: compact ? 'size-control px-0' : 'gap-1.5' })}>
        <UserRoundSearch aria-hidden size={16} />{!compact && <span>View as</span>}
        {!compact && <kbd className="ml-1 rounded border border-border px-1 text-[10px] text-ink-subtle">⌃⇧K</kbd>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-2 pt-[12vh]" data-testid="view-as-palette">
          <div ref={card} role="dialog" aria-modal="true" aria-label="View as" className={cardClasses('w-[min(36rem,100%)] p-3')}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><UserRoundSearch aria-hidden size={16} />View as someone</h2>
            <ViewAsPicker state={data} autoFocus />
          </div>
        </div>
      )}
    </>
  )
}
