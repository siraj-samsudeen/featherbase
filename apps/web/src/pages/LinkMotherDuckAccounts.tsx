import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Notice, PageHeader, RecordLink, Segmented, StatusPill, fmtCount, type StatusTone } from '@featherbase/shop-floor'
import { adminPageTitle } from 'shared'
import { ApiError, api } from '../lib/api'
import { useMeta } from '../lib/meta'
import { LinkControl } from '../components/LinkControl'

// #1396: MotherDuck Accounts › Link to people. Every account the sync could not
// link by email, with the people its username reads as (the same match its
// ticket names) as one-click choices. A choice is the account's Person, saved
// like any row; the sync then closes the account's ticket, on its daily run or
// at once with Close their tickets now.

const TABLE = 'MotherDuck Account'

interface Account {
  row_id: string
  username: string
  full_name: string | null
  email: string | null
  account_status: 'Active' | 'Deprovisioned' | 'Removed'
  service_account: boolean
  review_ticket: string | null
  updated_at: string
  person: { id: string; name: string } | null
  suggestions: { person: string; name: string; code: string | null; jobs: { job: string; site?: { name: string } }[] }[]
}

type View = 'open' | 'linked' | 'service'
const KEY = ['motherduck-linking'] as const
const STATUS_TONE: Record<Account['account_status'], StatusTone> = { Active: 'neutral', Deprovisioned: 'caution', Removed: 'missing' }

const viewOf = (a: Account): View => (a.service_account ? 'service' : a.person ? 'linked' : 'open')
const suggestionWords = (s: Account['suggestions'][number]) =>
  [s.name, s.code, s.jobs.map((j) => [j.job, j.site?.name].filter(Boolean).join(' at ')).join('; ')].filter(Boolean).join(' · ')
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

export function LinkMotherDuckAccounts() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: KEY, queryFn: () => api.get<{ accounts: Account[] }>('/api/motherduck_accounts/linking') })
  const meta = useMeta(TABLE)
  const personColumn = meta.data?.columns.find((f) => f.column_name === 'person')
  const [view, setView] = useState<View>('open')
  // Linked on this page, by account: they stay in place, green, with Undo.
  const [linkedNow, setLinkedNow] = useState<string[]>([])
  // Unlinked from the Linked tab on this page, with who they were: Relink puts it back.
  const [unlinkedNow, setUnlinkedNow] = useState<Record<string, { id: string; name: string }>>({})
  const [current, setCurrent] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const pickers = useRef(new Map<string, HTMLDivElement>())

  const all = list.data?.accounts ?? []
  const counts = { open: 0, linked: 0, service: 0 }
  for (const a of all) counts[viewOf(a)]++
  const shown = all.filter((a) => (view === 'open' ? viewOf(a) === 'open' || linkedNow.includes(a.row_id)
    : view === 'linked' ? viewOf(a) === 'linked' || Boolean(unlinkedNow[a.row_id]) : viewOf(a) === view))
  const open = useMemo(() => shown.filter((a) => viewOf(a) === 'open'), [shown])
  const currentId = view === 'open' ? open[Math.min(current, open.length - 1)]?.row_id : undefined

  const save = useMutation({
    mutationFn: async ({ account, person }: { account: Account; person: string | null }) => {
      // The row as it is now: Undo comes after this page's own save.
      const row = await api.get<{ updated_at: string }>(`/api/table/${encodeURIComponent(TABLE)}/${encodeURIComponent(account.row_id)}`)
      await api.patch(`/api/table/${encodeURIComponent(TABLE)}/${encodeURIComponent(account.row_id)}`, { person, updated_at: row.updated_at })
    },
    onMutate: () => setError(null),
    onSuccess: (_d, { account, person }) => {
      setLinkedNow((ids) => (person && view === 'open' ? [...ids.filter((id) => id !== account.row_id), account.row_id] : ids.filter((id) => id !== account.row_id)))
      setUnlinkedNow(({ [account.row_id]: was, ...rest }) => (!person && view === 'linked' && account.person ? { ...rest, [account.row_id]: account.person } : rest))
      void qc.invalidateQueries({ queryKey: KEY })
    },
    onError: (e, { account }) => setError(`${account.username}: ${e instanceof ApiError ? e.message : 'the link was not saved'}`),
  })
  const link = (account: Account, person: string) => save.mutate({ account, person })

  const sync = useMutation({ mutationFn: () => api.post('/api/motherduck_accounts/sync', {}) })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (view !== 'open' || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const account = open.find((a) => a.row_id === currentId)
      if (/^[1-3]$/.test(e.key) && account?.suggestions[Number(e.key) - 1]) {
        e.preventDefault()
        link(account, account.suggestions[Number(e.key) - 1].person)
      } else if (e.key === '/' && account) {
        e.preventDefault()
        pickers.current.get(account.row_id)?.querySelector('input')?.focus()
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        setCurrent((i) => Math.min(i + 1, open.length - 1))
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        setCurrent((i) => Math.max(i - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div data-testid="link-motherduck-accounts" className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <PageHeader
        breadcrumb={<><Link to="/featherbase/admin" className="hover:text-ink">Home</Link>{' / '}
          <Link to="/featherbase/admin/table/$table" params={{ table: TABLE }} search={{ filters: undefined }} className="hover:text-ink">MotherDuck Accounts</Link>{' / Link to people'}</>}
        title={adminPageTitle('link-motherduck-accounts')}
        count={list.data && <span>{fmtCount(counts.open)} to link{linkedNow.length ? ` · ${fmtCount(linkedNow.length)} linked on this page` : ''}</span>}
        actions={
          <Button variant="secondary" disabled={sync.isPending} onClick={() => sync.mutate()}>Close their tickets now</Button>
        }
        status={<>A link is the account’s Person. The sync closes its ticket on its daily run, or now with Close their tickets now.
          {sync.isSuccess && <span data-testid="md-sync-queued" className="ml-1 text-positive">The sync is queued; see Jobs for its run.</span>}</>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="md-filters">
          <Segmented label="Accounts" value={view} onChange={(v) => { setView(v); setCurrent(0) }} options={[
            { value: 'open', label: `To link · ${fmtCount(counts.open)}` },
            { value: 'linked', label: `Linked · ${fmtCount(counts.linked)}` },
            { value: 'service', label: `Service accounts · ${fmtCount(counts.service)}` },
          ]} />
        </span>
        {view === 'open' && <span className="text-xs text-ink-subtle">1–3 picks a suggestion · / searches · Esc leaves the search · ↑ ↓ move</span>}
      </div>
      {error && <Notice tone="negative">{error}</Notice>}
      {list.isError && <Notice tone="negative">The accounts could not be read.</Notice>}
      {list.data && shown.length === 0 && (
        <p className="text-sm text-ink-muted">{view === 'open' ? 'Every account a person uses is linked.' : 'None.'}</p>
      )}
      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {shown.map((a) => {
          if (view === 'open' && linkedNow.includes(a.row_id) && a.person) {
            return (
              <li key={a.row_id} data-testid="md-linked-now" data-username={a.username}
                className="flex flex-wrap items-center justify-between gap-2 bg-positive-tint px-4 py-3 text-sm text-positive">
                <span><b className="font-medium">{a.username}</b> → <RecordLink table="Person" rowId={a.person.id} name={a.person.name} /></span>
                <Button variant="quiet" disabled={save.isPending} onClick={() => save.mutate({ account: a, person: null })}>Undo</Button>
              </li>
            )
          }
          const isCurrent = a.row_id === currentId
          return (
            <li key={a.row_id} data-testid="md-account" data-username={a.username} data-current={isCurrent ? 'true' : undefined}
              onClick={() => view === 'open' && setCurrent(open.findIndex((o) => o.row_id === a.row_id))}
              className={`flex flex-col gap-2 px-4 py-3 ${isCurrent ? 'border-l-[3px] border-l-action' : 'border-l-[3px] border-l-transparent'}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <b className="font-medium text-ink">{a.username}</b>
                  {a.full_name && <span className="text-ink-muted"> · {a.full_name} in MotherDuck</span>}
                  {a.email && <span className="text-ink-muted"> · {a.email}</span>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <StatusPill tone={STATUS_TONE[a.account_status]}>{a.account_status}</StatusPill>
                  {a.review_ticket && <RecordLink table="tickets.ticket" rowId={a.review_ticket} name={a.review_ticket} />}
                </div>
              </div>
              {view === 'linked' && unlinkedNow[a.row_id] && !a.person && (
                <div data-testid="md-unlinked-now" className="flex items-center justify-between gap-3 text-sm text-ink-muted">
                  <span>Unlinked from {unlinkedNow[a.row_id].name}</span>
                  <Button variant="secondary" disabled={save.isPending} onClick={() => link(a, unlinkedNow[a.row_id].id)}>Relink</Button>
                </div>
              )}
              {viewOf(a) === 'linked' && a.person && (
                <div className="flex items-center justify-between gap-3 text-sm"><span>Person: <RecordLink table="Person" rowId={a.person.id} name={a.person.name} /></span>
                  <Button variant="quiet" disabled={save.isPending} onClick={() => save.mutate({ account: a, person: null })}>Unlink</Button></div>
              )}
              {viewOf(a) === 'open' && (
                <>
                  {a.suggestions.length
                    ? (
                        <div className="flex flex-wrap gap-2">
                          {a.suggestions.map((s, i) => (
                            <Button key={s.person} variant="secondary" data-testid="md-suggestion" disabled={save.isPending}
                              onClick={(e) => { e.stopPropagation(); link(a, s.person) }}>
                              {i < 3 && <span className="mr-1 text-ink-subtle">{i + 1}</span>}{suggestionWords(s)}
                            </Button>
                          ))}
                        </div>
                      )
                    : <p className="text-sm text-ink-muted">No suggestions: no one’s name starts like this username. Search by name or email below.</p>}
                  {personColumn && (
                    <div className="max-w-md" ref={(el) => { if (el) pickers.current.set(a.row_id, el); else pickers.current.delete(a.row_id) }}
                      onClick={(e) => e.stopPropagation()}
                      // Esc hands the keys back to the list: 1–3 and ↑ ↓ work again.
                      // Capture: the picker's own Esc only closes its list, which would take two presses.
                      onKeyDownCapture={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).blur() } }}>
                      <LinkControl field={personColumn} value="" pickOnly floating className="w-full"
                        common={{ 'aria-label': `Someone else for ${a.username}`, placeholder: 'Someone else: search by name or email' }}
                        onChange={(v) => { if (typeof v === 'string' && v) link(a, v) }} />
                    </div>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
