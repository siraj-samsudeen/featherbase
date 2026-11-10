/// <reference types="vite/client" />
import {
  createElement,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createRoot } from 'react-dom/client'
import { THEME_CHANGE_EVENT, paintTheme } from '@featherbase/shop-floor/theme'
import {
  action,
  read,
  ApiError,
  type Ticket,
  canManageApps,
  type Session,
  type Detail,
  type RecordData,
} from './api'
import './style.css'
import { configuredTypes, connectionNames, kindLabel, kinds, learnNames, learnTypes, short, stateLabel } from './ticket-words'
import { StatePill, assignee, isDone, tone } from './ticket-state'
import { CreateTicket } from './CreateTicket'
import { CaseFile, SETTINGS_HREF } from './CaseFile'

const BUILT_IN_STATES = ['New', 'Needs verification', 'Awaiting approval', 'Approved', 'Rejected', 'Policy review', 'In progress', 'Resolved']
function App() {
  const [session, setSession] = useState<Session | null>(null),
    [tickets, setTickets] = useState<Ticket[]>([]),
    [everything, setEverything] = useState<Ticket[]>([]),
    [detail, setDetail] = useState<Detail | null>(null)
  // #1001: an emailed link opens its ticket.
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.search).get('ticket') ?? ''),
    [search, setSearch] = useState(''),
    [kind, setKind] = useState(''),
    [state, setState] = useState(''),
    [view, setView] = useState('all')
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [detailLoading, setDetailLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [create, setCreate] = useState(false),
    [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const queueSequence = useRef(0),
    detailSequence = useRef(0)
  const userId = session
    ? typeof session.user === 'string'
      ? session.user
      : session.user.row_id
    : ''
  const report = (e: unknown) =>
    setError(
      e instanceof Error
        ? e.message
        : 'Could not load Tickets. Please try again.',
    )
  useEffect(() => {
    Promise.all([read<Session>('session'), read<{ types: unknown }>('form'), canManageApps()])
      .then(([value, form, manage]) => {
        learnTypes(form.types)
        setSession({ ...value, canManage: manage })
      })
      .catch((e) => {
        report(e)
        setLoading(false)
      })
  }, [reload])
  useEffect(() => {
    if (!session) return
    const sequence = ++queueSequence.current
    const timeout = setTimeout(() => {
      setLoading(true)
      read<{ tickets: Ticket[] }>('queue', {
        search,
        kind,
        state: state || (view === 'assigned' ? 'open' : ''),
        ...(view === 'assigned' ? { assigned_to: userId } : {}),
      })
        .then((result) => {
          if (sequence === queueSequence.current) {
            learnNames((result as { names?: unknown }).names)
            setTickets(result.tickets)
            setSelected((id) => id || result.tickets[0]?.row_id || '')
          }
        })
        .catch((e) => {
          if (sequence === queueSequence.current) report(e)
        })
        .finally(() => {
          if (sequence === queueSequence.current) setLoading(false)
        })
    }, 180)
    return () => {
      clearTimeout(timeout)
      queueSequence.current++
    }
  }, [session, search, kind, state, view, reload, userId])
  useEffect(() => {
    if (!session) return
    let current = true
    read<{ tickets: Ticket[]; names?: unknown }>('queue', {})
      .then((result) => {
        if (!current) return
        learnNames(result.names)
        setEverything(result.tickets)
      })
      .catch((e) => {
        if (current) report(e)
      })
    return () => {
      current = false
    }
  }, [session, reload])
  useEffect(() => {
    const sequence = ++detailSequence.current
    setDetail((current) =>
      current?.ticket.row_id === selected ? current : null,
    )
    if (!selected) {
      setDetailLoading(false)
      return
    }
    setDetailLoading(true)
    read<Detail>('detail', { row_id: selected })
      .then((value) => {
        if (sequence === detailSequence.current) {
          learnNames(value.names)
          setDetail(value)
        }
      })
      .catch((e) => {
        if (sequence === detailSequence.current) report(e)
      })
      .finally(() => {
        if (sequence === detailSequence.current) setDetailLoading(false)
      })
    return () => {
      detailSequence.current++
    }
  }, [selected, reload])
  async function mutate(name: string, payload: RecordData) {
    if (!detail || busy || detailLoading) return false
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action(name, {
        ...payload,
        row_id: detail.ticket.row_id,
        updated_at: detail.ticket.updated_at,
      })
      setNotice('Saved. The queue and case are refreshed from the server.')
      setReload((n) => n + 1)
      return true
    } catch (e) {
      report(e)
      if (e instanceof ApiError && e.status === 409) {
        setNotice(
          'The case changed. Review the refreshed version before trying again.',
        )
        setReload((n) => n + 1)
      }
      return false
    } finally {
      setBusy(false)
    }
  }
  const visible = tickets.filter(
    (ticket) => view !== 'mine' || ticket.owner === userId,
  )
  // The open ticket is always one the list shows: a filter that hides it
  // moves to the first ticket shown, or to none.
  const visibleIds = visible.map((ticket) => ticket.row_id).join(' ')
  useEffect(() => {
    if (loading) return
    setSelected((id) =>
      visible.some((ticket) => ticket.row_id === id) ? id : (visible[0]?.row_id ?? ''),
    )
  }, [visibleIds, loading])
  // Sidebar counts: one unfiltered queue read, counted here.
  const inView = (ticket: Ticket, name: string) =>
    name === 'mine'
      ? ticket.owner === userId
      : name === 'assigned'
        ? ticket.assigned_to === userId && !isDone(ticket)
        : true
  const views = [
    ['all', 'All tickets'],
    ['mine', 'My requests'],
    ...(session?.capabilities.support ? [['assigned', 'Assigned to me']] : []),
  ] as const
  const viewName = views.find(([key]) => key === view)?.[1] ?? 'All tickets'
  const typeCounts = new Map<string, number>()
  for (const ticket of everything)
    if (inView(ticket, view))
      typeCounts.set(ticket.kind, (typeCounts.get(ticket.kind) ?? 0) + 1)
  const typeKeys = [
    ...new Set([
      ...Object.keys(kinds),
      ...Object.values(configuredTypes).filter((type) => type.enabled !== false).map((type) => type.key),
      ...[...typeCounts.keys()].sort(),
      ...(kind ? [kind] : []),
    ]),
  ]
  // The states the list can hold: the chosen type's own, else every type's.
  const stateOptions = configuredTypes[kind]
    ? configuredTypes[kind].states
    : kind
      ? BUILT_IN_STATES
      : [...new Set([...BUILT_IN_STATES, ...Object.values(configuredTypes).flatMap((type) => type.states)])]
  // A state the chosen type can't hold would leave the list empty with nothing
  // on screen to explain it.
  useEffect(() => {
    if (state && !stateOptions.includes(state)) setState('')
  }, [kind])
  const connections =
    session?.connections && typeof session.connections === 'object'
      ? (session.connections as Record<string, unknown>)
      : {}
  const unconfigured = Object.entries(connections)
    .filter(([, status]) => status !== 'configured')
    .map(([key]) => connectionNames[key] ?? stateLabel(key))
  const newTicket = (
    <button
      className="primary"
      disabled={!session}
      onClick={() => setCreate(true)}
    >
      + New ticket
    </button>
  )
  return (
    <div className="tickets-shell">
      {createElement(
        'featherbase-sidebar',
        { className: 'tickets-sidebar', 'aria-label': 'Ticket views' },
        <>
          {views.map(([key, name]) => (
            <button
              key={key}
              type="button"
              aria-current={view === key ? 'page' : undefined}
              onClick={() => setView(key)}
            >
              <span>{name}</span>
              <span className="count">
                {everything.filter((ticket) => inView(ticket, key)).length}
              </span>
            </button>
          ))}
          {typeKeys.length > 0 && (
            <div className="sidebar-heading" id="ticket-types-heading">
              Types
            </div>
          )}
          {typeKeys.map((key) => (
            <button
              key={key}
              type="button"
              data-depth="1"
              aria-current={kind === key ? 'page' : undefined}
              onClick={() => setKind((current) => (current === key ? '' : key))}
            >
              <span>{kindLabel(key)}</span>
              <span className="count">{typeCounts.get(key) ?? 0}</span>
            </button>
          ))}
          {session && (
            <div
              className="connection-status"
              role="status"
              title={
                unconfigured.length
                  ? `Not set up: ${unconfigured.join(', ')}. Tickets works by hand until they are.`
                  : 'All connections are set up.'
              }
            >
              <span
                className={`dot ${unconfigured.length ? 'tone-caution' : 'tone-positive'}`}
                aria-hidden="true"
              />
              {unconfigured.length ? 'Connections not set up' : 'Connections ready'}
              {unconfigured.length > 0 && session.canManage && (
                <>
                  {' · '}
                  <a href={SETTINGS_HREF}>Set up</a>
                </>
              )}
            </div>
          )}
        </>,
      )}
      <main className="tickets-main">
        <div className="toolbar">
          <h1>
            {viewName}
            {kind && <span className="toolbar-type"> · {kindLabel(kind)}</span>}
            <span className="count">{visible.length}</span>
          </h1>
          <input
            type="search"
            aria-label="Search tickets"
            placeholder="Search tickets"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Filter by state"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">
              {view === 'assigned' ? 'Open work' : 'All states'}
            </option>
            {stateOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <span className="toolbar-end">{newTicket}</span>
        </div>
        {error && (
          <div role="alert" className="error banner">
            {error}
            <button
              onClick={() => {
                setError('')
                setReload((n) => n + 1)
              }}
            >
              Retry / refresh
            </button>
            {!session && (
              <a href="/featherbase/login?next=%2Ftickets%2F">Sign in</a>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <section className="split">
          <div
            className="ticket-list"
            aria-busy={loading}
            aria-label="Tickets"
          >
            {loading && (
              <div className="loading" role="status">
                Loading queue…
              </div>
            )}
            {!loading && !visible.length && (
              <div className="empty">
                <h3>
                  {search || kind || state
                    ? 'No matching tickets'
                    : 'No tickets here yet'}
                </h3>
                <p>
                  {search || kind || state
                    ? 'Try another search, state or type.'
                    : 'Create a request when you need a hand.'}
                </p>
              </div>
            )}
            {visible.map((ticket) => (
              <button
                key={ticket.row_id}
                className={`ticket ${selected === ticket.row_id ? 'selected' : ''}`}
                aria-pressed={selected === ticket.row_id}
                onClick={() => {
                  if (!busy) {
                    setSelected(ticket.row_id)
                    setNotice('')
                  }
                }}
              >
                <span className="ticket-top">
                  <span className="ticket-id">
                    {short(ticket.row_id)} · {kindLabel(ticket.kind)}
                  </span>
                  <StatePill ticket={ticket} />
                </span>
                <span className="ticket-title">{ticket.title}</span>
                <span className="ticket-meta">{assignee(ticket)}</span>
              </button>
            ))}
          </div>
          <article className="detail" aria-busy={detailLoading || busy}>
            {detailLoading && !detail ? (
              <div className="empty" role="status">
                Loading ticket…
              </div>
            ) : detail && session ? (
              <CaseFile
                key={detail.ticket.row_id}
                detail={detail}
                session={session}
                mutate={mutate}
                busy={busy || detailLoading}
              />
            ) : (
              <div className="empty detail-empty">
                <p>Select a ticket to see it here.</p>
                {newTicket}
              </div>
            )}
          </article>
        </section>
      </main>
      {create && (
        <CreateTicket
          close={() => setCreate(false)}
          created={async (id) => {
            setSelected(id)
            setReload((n) => n + 1)
            setNotice('Ticket created and saved to the server.')
          }}
        />
      )}
    </div>
  )
}
// The shared top bar tells the page which theme it painted: on <html> once it
// has painted, and with an event on each change.
const painted = document.documentElement.getAttribute('data-featherbase-theme')
paintTheme(painted === 'light' || painted === 'dark' ? painted : 'device')
window.addEventListener(THEME_CHANGE_EVENT, (event) => {
  const theme = (event as CustomEvent<{ theme: 'light' | 'dark' }>).detail?.theme
  if (theme === 'light' || theme === 'dark') paintTheme(theme)
})
createRoot(document.getElementById('root')!).render(<App />)
