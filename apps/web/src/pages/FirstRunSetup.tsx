import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { SETUP_MAX_PEOPLE } from 'shared'
import { ApiError, api, getSessionUser } from '../lib/api'
import { Button, Card, Field, Notice, TextInput } from '../components/ui'
import { Plus } from '../components/ui/icons'
import { INSTANCE_HEALTH_QUERY_KEY, useInstanceHealth } from './InstanceHealth'

// First-run setup (#465, design D9; spec "First-run System Manager setup").
// Offered to the built-in Administrator whenever "A System Manager with an
// email address" fails: once, when they sign in and land on the Admin home
// (a deep link is never taken over). Each person named becomes a System
// Manager and is invited; "Not now" reaches the Admin at once.

const SETUP_PATH = '/featherbase/admin/setup'
const ADMINISTRATOR = 'Administrator'
const EMAIL_CHECK = 'system-manager-email'

/** Set by the sign-in page for the Administrator; spent on the first Admin page. */
export const OFFER_SETUP_KEY = 'featherbase.offer-setup'

export function markSetupOffer(user: { row_id?: string } | null): void {
  if (user?.row_id !== ADMINISTRATOR) return
  try { sessionStorage.setItem(OFFER_SETUP_KEY, '1') } catch { /* storage blocked: no offer */ }
}

function takeSetupOffer(): boolean {
  try {
    const offered = sessionStorage.getItem(OFFER_SETUP_KEY) === '1'
    sessionStorage.removeItem(OFFER_SETUP_KEY)
    return offered
  } catch {
    return false
  }
}

/** In the Admin shell: right after the Administrator signs in, while no
 *  System Manager has an address, ask who looks after the instance. */
export function useSetupOffer(enabled: boolean): void {
  const navigate = useNavigate()
  const health = useInstanceHealth(enabled)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // Where the sign-in landed. Once the Administrator has moved on, the offer
  // is spent: a slow answer must never pull them off a page (Codex review).
  const landing = useRef(pathname)
  const decided = useRef(false)
  useEffect(() => {
    if (decided.current || !enabled) return
    // The Admin index sends a sign-in on to the first Home Page by itself;
    // that is still the landing.
    const stillLanding = pathname === landing.current || pathname === '/featherbase/admin' || pathname.startsWith('/featherbase/admin/home/')
    if (!stillLanding) {
      decided.current = true
      takeSetupOffer()
      return
    }
    if (!health.data) return
    decided.current = true
    if (!takeSetupOffer() || getSessionUser()?.row_id !== ADMINISTRATOR) return
    const check = health.data.checks.find((c) => c.key === EMAIL_CHECK)
    if (check && !check.ok) void navigate({ to: SETUP_PATH, replace: true })
  }, [enabled, health.data, navigate, pathname])
}

interface Row { full_name: string; email: string }

type Invitation =
  | { status: 'sent' }
  | { status: 'link'; link: string; method_label: string }
  | { status: 'failed'; error: string; link: string | null; method_label: string }
  | { status: 'no_method' }

interface Outcome { person: string; full_name: string; email: string; created: boolean; invitation: Invitation }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_PEOPLE = SETUP_MAX_PEOPLE

function check(rows: Row[]): Record<string, string> {
  const problems: Record<string, string> = {}
  const seen = new Map<string, number>()
  rows.forEach((r, i) => {
    const email = r.email.trim().toLowerCase()
    if (!EMAIL.test(email)) problems[`people.${i}.email`] = 'Enter an email address'
    else if (seen.has(email)) problems[`people.${i}.email`] = `The same address as person ${seen.get(email)! + 1}`
    else seen.set(email, i)
  })
  return problems
}

function invitationText(o: Outcome, inv: { link: string; method_label: string }): string {
  return `${inv.link}\nSign in with ${inv.method_label} using this address: ${o.email}`
}

function CopyInvitation({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 rounded-control border border-border bg-subtle p-3" data-testid="setup-invitation">
      <pre className="whitespace-pre-wrap font-mono text-xs text-ink [overflow-wrap:anywhere]">{text}</pre>
      <Button
        variant="secondary"
        className="mt-2 max-sm:min-h-11"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false))
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

function Result({ o }: { o: Outcome }) {
  const inv = o.invitation
  return (
    <li className="py-3" data-testid="setup-result">
      <p className="font-medium text-ink">{o.full_name} is invited as a System Manager</p>
      {inv.status === 'sent' && <p className="text-sm text-ink-muted">The invitation email was sent to {o.email}.</p>}
      {inv.status === 'link' && (
        <>
          <p className="text-sm text-ink-muted">This instance cannot send email yet. Copy this invitation and send it to them yourself.</p>
          <CopyInvitation text={invitationText(o, inv)} />
        </>
      )}
      {inv.status === 'failed' && (
        <>
          <p className="text-sm text-ink-muted">{inv.error}.{inv.link ? ' Copy this invitation and send it to them yourself.' : ''}</p>
          {inv.link && <CopyInvitation text={invitationText(o, { link: inv.link, method_label: inv.method_label })} />}
        </>
      )}
      {inv.status === 'no_method' && (
        <p className="text-sm text-ink-muted">No sign-in method can invite them yet. Turn on Google sign-in, or set a password for them on their Person page.</p>
      )}
    </li>
  )
}

export function FirstRunSetup() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isAdministrator = getSessionUser()?.row_id === ADMINISTRATOR
  const [rows, setRows] = useState<Row[]>([{ full_name: '', email: '' }])
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Outcome[] | null>(null)
  if (!isAdministrator) return <Navigate to="/featherbase/admin" replace />

  const goToAdmin = () => void navigate({ to: '/featherbase/admin' })
  const update = (i: number, field: keyof Row, value: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)))

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const found = check(rows)
    setProblems(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      const res = await api.post<{ people: Outcome[] }>('/api/setup/system-managers', {
        people: rows.map((r) => ({ full_name: r.full_name.trim(), email: r.email.trim() })),
      })
      setDone(res.people)
      await queryClient.invalidateQueries({ queryKey: INSTANCE_HEALTH_QUERY_KEY })
    } catch (err) {
      if (err instanceof ApiError && err.fields) setProblems(err.fields)
      setError(err instanceof Error ? err.message : 'The people could not be set up')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl" data-testid="first-run-setup">
      <Card className="p-4 sm:p-6">
        <h1 className="text-lg font-semibold text-ink">Who looks after this instance?</h1>
        {done ? (
          <>
            <ul className="mt-2 divide-y divide-border">
              {done.map((o) => <Result key={o.person} o={o} />)}
            </ul>
            <Button variant="primary" className="mt-4 max-sm:min-h-11" onClick={goToAdmin}>Continue to Admin</Button>
          </>
        ) : (
          <form onSubmit={invite} noValidate>
            <p className="mt-1 text-sm text-ink-muted">
              Each person you name is invited as a System Manager, and receives the system notices by email.
            </p>
            {error && Object.keys(problems).every((k) => !/^people\.\d+\.(email|full_name)$/.test(k)) && (
              <Notice tone="negative" className="mt-3">{error}</Notice>
            )}
            <div className="mt-4 space-y-4">
              {rows.map((r, i) => (
                <fieldset key={i} className={`grid gap-3 sm:grid-cols-2${i > 0 ? ' border-t border-border pt-4' : ''}`} data-testid="setup-person">
                  <legend className="sr-only">Person {i + 1}</legend>
                  <Field label="Full name" error={problems[`people.${i}.full_name`]}>
                    <TextInput value={r.full_name} maxLength={140} autoComplete="off" onChange={(e) => update(i, 'full_name', e.target.value)} className="max-sm:min-h-11" />
                  </Field>
                  <Field label="Email" error={problems[`people.${i}.email`]}>
                    <TextInput type="email" value={r.email} autoComplete="off" onChange={(e) => update(i, 'email', e.target.value)} className="max-sm:min-h-11" />
                  </Field>
                  {i > 0 && (
                    <div className="sm:col-span-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="max-sm:min-h-11"
                        onClick={() => {
                          setRows((rs) => rs.filter((_, j) => j !== i))
                          setProblems({})
                        }}
                      >
                        Remove person {i + 1}
                      </Button>
                    </div>
                  )}
                </fieldset>
              ))}
            </div>
            {rows.length < MAX_PEOPLE && (
              <Button
                type="button"
                variant="secondary"
                className="mt-3 max-sm:min-h-11"
                onClick={() => setRows((rs) => [...rs, { full_name: '', email: '' }])}
              >
                <Plus aria-hidden size={16} />
                Add another person
              </Button>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button type="submit" variant="primary" disabled={busy} className="max-sm:min-h-11">Invite</Button>
              <Button type="button" variant="secondary" onClick={goToAdmin} className="max-sm:min-h-11">Not now</Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}
