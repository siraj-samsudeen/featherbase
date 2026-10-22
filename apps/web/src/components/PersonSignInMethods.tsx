import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { useIsSystemManager } from '../lib/session'
import { fmtInstantIST } from '../lib/inr'
import { Button, Card, Select, TextInput } from './ui'

// person-identities (#275, review B-M4): on a Person's form, a System Manager
// sees how that person signs in — password, linked outside accounts, pending
// Google invites — and can link a connected service, invite a Google address
// or unlink one. Moving a link stays an API call (PATCH /api/identities/:id).

interface AdminIdentity {
  id: string
  method: string
  subject: string | null
  sign_in_name: string | null
  email: string | null
  pending_email: string | null
  last_used_at: string | null
  /** person-resolution D5: an ended link stays as history. */
  ended_at?: string | null
  ended_reason?: string | null
  /** `employee-code` until the roster supplies the HR record number (C4). */
  subject_kind?: string
}

interface MethodInfo {
  key: string
  kind: string
  label: string
}

export function PersonSignInMethods({ user }: { user: string }) {
  const isManager = useIsSystemManager()
  const qc = useQueryClient()
  const key = ['user-identities', user]
  const { data } = useQuery({
    queryKey: key,
    enabled: isManager,
    queryFn: () =>
      api.get<{ identities: AdminIdentity[]; has_password: boolean; methods: (MethodInfo & { enabled: boolean })[] }>(
        `/api/people/${encodeURIComponent(user)}/identities`,
      ),
  })
  const methods = useQuery({
    queryKey: ['sign-in-methods-list'],
    enabled: isManager,
    queryFn: () => api.get<{ methods: MethodInfo[] }>('/api/me/sign_in_methods'),
  })
  const [error, setError] = useState<string | null>(null)
  const done = () => {
    setError(null)
    void qc.invalidateQueries({ queryKey: key })
  }
  const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : 'That did not work')
  // The form is cleared only when the server accepted it, so a refused link
  // (a clash, a typo) keeps what was typed for correcting.
  const add = useMutation({
    mutationFn: ({ body }: { body: Record<string, string>; form: HTMLFormElement }) =>
      api.post(`/api/people/${encodeURIComponent(user)}/identities`, body),
    onSuccess: (_res, { form }) => {
      form.reset()
      done()
    },
    onError: fail,
  })
  const unlink = useMutation({
    mutationFn: (id: string) => api.delete(`/api/identities/${encodeURIComponent(id)}`),
    onSuccess: done,
    onError: fail,
  })
  if (!isManager) return null

  const all = methods.data?.methods ?? []
  const delegated = all.filter((m) => m.kind === 'delegated_password')
  const google = all.find((m) => m.kind === 'google')
  // Names come from every method row, so a link on a turned-off method is
  // still labelled (and says it is off).
  const labelOf = (k: string) => {
    const row = data?.methods.find((m) => m.key === k)
    return row ? `${row.label}${row.enabled ? '' : ' (turned off)'}` : (all.find((m) => m.key === k)?.label ?? k)
  }

  function onLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    add.mutate({
      body: { method: String(f.get('method')), subject: String(f.get('subject')).trim(), sign_in_name: String(f.get('sign_in_name')).trim() },
      form: e.currentTarget,
    })
  }
  function onInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    add.mutate({ body: { method: google!.key, email: String(f.get('email')).trim() }, form: e.currentTarget })
  }

  return (
    <Card className="p-3" data-testid="user-sign-in-methods">
      <h3 className="mb-2 text-sm font-semibold text-ink">Sign-in methods</h3>
      <ul className="space-y-2 text-sm">
        {data?.has_password && <li data-testid="user-method-password">Password</li>}
        {data?.identities.filter((i) => !i.ended_at).map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-2" data-testid={`user-method-${i.id}`}>
            <span className="min-w-0">
              <span className="font-medium">{labelOf(i.method)}</span>{' '}
              <span className="text-sm text-ink-muted">
                {i.subject == null ? `invited: ${i.pending_email}` : [i.subject, i.sign_in_name, i.email].filter(Boolean).join(' · ')}
              </span>
              {i.subject_kind === 'employee-code' && (
                <span className="block text-sm text-ink-muted" data-testid={`unresolved-${i.id}`}>
                  Awaiting its record number — signs in by employee code until the roster supplies it.
                </span>
              )}
            </span>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(`Remove this ${labelOf(i.method)} sign-in from ${user}?`)) unlink.mutate(i.id)
              }}
            >
              Unlink
            </Button>
          </li>
        ))}
        {data?.identities.filter((i) => i.ended_at).map((i) => (
          <li key={i.id} className="text-sm text-ink-muted" data-testid={`user-method-ended-${i.id}`}>
            {labelOf(i.method)} {[i.subject, i.sign_in_name, i.email].filter(Boolean).join(' · ')} — ended{' '}
            {fmtInstantIST(i.ended_at!)} ({i.ended_reason})
          </li>
        ))}
        {data && !data.has_password && data.identities.filter((i) => !i.ended_at).length === 0 && (
          <li className="text-sm text-ink-muted">No way to sign in yet.</li>
        )}
      </ul>
      {delegated.length > 0 && (
        <form className="mt-3 space-y-2" onSubmit={onLink} data-testid="link-delegated-form">
          <Select name="method" aria-label="Service" defaultValue={delegated[0].key}>
            {delegated.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </Select>
          <TextInput name="subject" aria-label="Record number at the service" placeholder="Record number at the service" required />
          <TextInput name="sign_in_name" aria-label="Login ID at the service" placeholder="Login ID at the service" />
          <Button type="submit" block>Link</Button>
        </form>
      )}
      {google && (
        <form className="mt-3 space-y-2" onSubmit={onInvite} data-testid="invite-google-form">
          <TextInput name="email" type="email" aria-label="Google address to invite" placeholder="Google address to invite" required />
          <Button type="submit" block>Invite {google.label} address</Button>
        </form>
      )}
      {error && (
        <p className="mt-2 text-sm text-negative" data-testid="user-method-error">
          {error}
        </p>
      )}
    </Card>
  )
}
