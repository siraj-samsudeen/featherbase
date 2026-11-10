import { Fragment, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, DrillPane, Notice, PaneSection, cx, inputClasses } from '@featherbase/shop-floor'
import { api } from '../lib/api'

// #1173: one waiting request in a drawer beside the Waiting for access list:
// who it is and what they asked for, then Approve with roles and what each
// app can give, Decline with a reason, or Dismiss. The server decides who
// may act (System Managers) and re-checks everything picked.

interface Choice { id: string; label: string; group?: string; given?: boolean }
interface AppSection { app: string; title: string; about: { label: string; value: string }[]; choices: Choice[]; problem?: string }
export interface RequestDetails {
  id: string
  app: string
  app_name: string
  asked_at: string
  declined: { at: string; by: string; by_name: string | null; reason: string } | null
  person: { id: string; full_name: string | null; email: string | null }
  sign_ins: { method: string; sign_in_name: string }[]
  roles_held: string[]
  /** Roles System Settings gives everyone who signs in. */
  roles_for_everyone?: string[]
  role_choices: string[]
  role_hints: Record<string, number>
  apps: AppSection[]
}
interface Approved { given: string[]; failed: { label: string; problem: string }[]; open: boolean }

export const FULL_ADMIN = 'System Manager'

/** 10-Nov-2026: the day only; the time is noise here. */
function day(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-GB', { month: 'short' })}-${d.getFullYear()}`
}

const choiceKey = (app: string, choice: string) => `${app}\u0000${choice}`

export function AccessRequestDrawer({ id, onClose, onDone }: {
  id: string
  onClose: () => void
  /** The request was decided and has left this view; `message` says how. */
  onDone: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const details = useQuery({ queryKey: ['access-request', id], gcTime: 0, queryFn: () => api.get<RequestDetails>(`/api/access_request/${encodeURIComponent(id)}`) })
  const [roles, setRoles] = useState<string[]>([])
  const [grants, setGrants] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [partly, setPartly] = useState<Approved | null>(null)

  const data = details.data
  const name = data ? data.person.full_name || data.person.email || 'Someone' : 'Access request'

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['list', 'Access Request'] })
    await queryClient.invalidateQueries({ queryKey: ['waiting-for-access-count'] })
  }

  async function run<T>(step: () => Promise<T>): Promise<T | undefined> {
    setBusy(true)
    setProblem(null)
    try { return await step() } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That did not go through. Try again.')
      return undefined
    } finally { setBusy(false) }
  }

  async function approve() {
    if (!data) return
    if (roles.includes(FULL_ADMIN) && !confirming) { setConfirming(true); return }
    const picked = grants.map((key) => { const [app, choice] = key.split('\u0000'); return { app, choice } })
    const answer = await run(() => api.post<Approved>(`/api/access_request/${encodeURIComponent(id)}/approve`, {
      roles, grants: picked, ...(roles.includes(FULL_ADMIN) ? { confirm_full_admin: true } : {}),
    }))
    if (!answer) return
    await refresh()
    if (answer.open && !answer.failed.length) { onDone(`Access given to ${name}: ${answer.given.join(', ')}`); return }
    setRoles([]); setGrants([]); setConfirming(false); setPartly(answer)
    await details.refetch()
  }

  async function decline() {
    const done = await run(() => api.post(`/api/access_request/${encodeURIComponent(id)}/decline`, { reason }))
    if (done === undefined) return
    await refresh()
    onDone(`Declined ${name}'s request`)
  }

  async function dismiss() {
    const done = await run(() => api.post(`/api/access_request/${encodeURIComponent(id)}/dismiss`, {}))
    if (done === undefined) return
    await refresh()
    onDone(`Dismissed ${name}'s request`)
  }

  const toggle = (list: string[], set: (next: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  return (
    <div data-testid="access-request-drawer" className="h-full">
      <DrillPane kind="Access request" title={name} onClose={onClose} place="right">
        {details.isPending && <p className="text-sm text-ink-subtle">Loading…</p>}
        {details.isError && <Notice tone="negative">{details.error instanceof Error ? details.error.message : 'Could not load this request'}</Notice>}
        {data && (
          <div className="flex flex-col gap-5">
            <PaneSection title="Who">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" data-testid="request-who">
                {data.person.email && <><dt className="text-ink-subtle">Email</dt><dd className="break-all">{data.person.email}</dd></>}
                {data.sign_ins.map((s, i) => (
                  <Fragment key={`sign-in-${i}`}><dt className="text-ink-subtle">Signs in with</dt><dd>{s.method} · {s.sign_in_name}</dd></Fragment>
                ))}
                {data.apps.flatMap((a) => a.about.map((line) => ({ ...line, app: a.app }))).map((line) => (
                  <Fragment key={`${line.app}-${line.label}`}><dt className="text-ink-subtle">{line.label}</dt><dd>{line.value}</dd></Fragment>
                ))}
              </dl>
              <p className="text-sm" data-testid="request-asked">Asked for <strong>{data.app}</strong> on {day(data.asked_at)}</p>
              {data.declined && (
                <Notice tone="caution"><span data-testid="request-declined">Declined on {day(data.declined.at)} by {data.declined.by_name || data.declined.by}: {data.declined.reason}</span></Notice>
              )}
            </PaneSection>

            <PaneSection title="Roles">
              <ul className="flex flex-col gap-1.5" data-testid="request-roles">
                {data.role_choices.map((role) => {
                  const everyone = (data.roles_for_everyone ?? []).includes(role)
                  const held = everyone || data.roles_held.includes(role)
                  const hint = data.role_hints[role]
                  return (
                    <li key={role} className="text-sm">
                      <label className={cx('flex items-center gap-2', held ? 'text-ink-subtle' : 'cursor-pointer')}>
                        <input type="checkbox" checked={held || roles.includes(role)} disabled={held || busy}
                          onChange={() => { toggle(roles, setRoles, role); setConfirming(false) }} />
                        {role}
                        {held && <span className="text-xs text-ink-subtle">{everyone ? 'Everyone has it' : 'Has it'}</span>}
                        {role === FULL_ADMIN && !held && roles.includes(role) && <span className="text-xs font-semibold text-negative" data-testid="full-admin-warning">Gives full admin access</span>}
                      </label>
                      {hint ? <p className="ml-6 text-xs text-ink-subtle" data-testid="role-hint">{hint === 1 ? '1 other' : `${hint} others`} in this job {hint === 1 ? 'holds' : 'hold'} it</p> : null}
                    </li>
                  )
                })}
              </ul>
            </PaneSection>

            {data.apps.map((section) => (
              <PaneSection key={section.app} title={section.title}>
                {section.problem && <Notice tone="caution">{section.problem}</Notice>}
                <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto" data-testid={`request-app-${section.app}`}>
                  {section.choices.map((choice) => {
                    const key = choiceKey(section.app, choice.id)
                    return (
                      <li key={choice.id} className="text-sm">
                        <label className={cx('flex items-center gap-2', choice.given ? 'text-ink-subtle' : 'cursor-pointer')}>
                          <input type="checkbox" checked={Boolean(choice.given) || grants.includes(key)} disabled={choice.given || busy}
                            onChange={() => toggle(grants, setGrants, key)} />
                          {choice.group && <span className="text-xs text-ink-subtle">{choice.group}</span>}
                          {choice.label}
                          {choice.given && <span className="text-xs text-ink-subtle">Has it</span>}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </PaneSection>
            ))}

            {partly && (
              <Notice tone={partly.failed.length ? 'negative' : 'caution'}>
                <span data-testid="request-partly">
                  {partly.given.length ? `Given: ${partly.given.join(', ')}. ` : ''}
                  {partly.failed.map((f) => `${f.label}: ${f.problem}. `).join('')}
                  {!partly.open && `Given, but this doesn't open ${data.app} yet.`}
                </span>
              </Notice>
            )}
            {confirming && <Notice tone="caution"><span data-testid="full-admin-confirm">System Manager gives full admin access to everything in Featherbase. Approve again to confirm.</span></Notice>}
            {problem && <Notice tone="negative"><span data-testid="request-problem">{problem}</span></Notice>}

            <div className="sticky bottom-0 -mx-4 border-t border-border bg-surface px-4 py-3">
            {declining ? (
              <div className="flex flex-col gap-2" data-testid="decline-form">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Why is it declined?
                  <textarea className={inputClasses()} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="decline-reason"
                    placeholder="Only admins see the reason" />
                </label>
                <div className="flex gap-2">
                  <Button variant="danger" onClick={decline} disabled={!reason.trim()} loading={busy} data-testid="decline-confirm">Decline</Button>
                  <Button variant="quiet" onClick={() => { setDeclining(false); setReason('') }}>Cancel</Button>
                </div>
              </div>
            ) : dismissing ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="dismiss-confirm-row">
                <span className="text-sm">Dismiss this request? It is deleted; if they open {data.app} again, it comes back.</span>
                <Button variant="danger" onClick={dismiss} loading={busy} data-testid="dismiss-confirm">Dismiss</Button>
                <Button variant="quiet" onClick={() => setDismissing(false)}>Cancel</Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={approve} disabled={!roles.length && !grants.length} loading={busy} data-testid="request-approve">
                  {confirming ? 'Confirm and approve' : 'Approve'}
                </Button>
                {!data.declined && <Button onClick={() => setDeclining(true)} disabled={busy} data-testid="request-decline">Decline…</Button>}
                <Button variant="quiet" onClick={() => setDismissing(true)} disabled={busy} data-testid="request-dismiss">Dismiss…</Button>
              </div>
            )}
            </div>
          </div>
        )}
      </DrillPane>
    </div>
  )
}
