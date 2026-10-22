import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { useIsSystemManager } from '../lib/session'

// person-identities (#275, review B-M4): on a User's form, a System Manager
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
}

interface MethodInfo {
  key: string
  kind: string
  label: string
}

export function UserSignInMethods({ user }: { user: string }) {
  const isManager = useIsSystemManager()
  const qc = useQueryClient()
  const key = ['user-identities', user]
  const { data } = useQuery({
    queryKey: key,
    enabled: isManager,
    queryFn: () =>
      api.get<{ identities: AdminIdentity[]; has_password: boolean; methods: (MethodInfo & { enabled: boolean })[] }>(
        `/api/users/${encodeURIComponent(user)}/identities`,
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
      api.post(`/api/users/${encodeURIComponent(user)}/identities`, body),
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
    <section className="fc-card p-3" data-testid="user-sign-in-methods">
      <h3 className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Sign-in methods</h3>
      <ul className="space-y-2 text-sm">
        {data?.has_password && <li data-testid="user-method-password">Password</li>}
        {data?.identities.map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-2" data-testid={`user-method-${i.id}`}>
            <span className="min-w-0">
              <span className="font-medium">{labelOf(i.method)}</span>{' '}
              <span className="text-xs text-[var(--color-ink-muted)]">
                {i.subject == null ? `invited: ${i.pending_email}` : [i.subject, i.sign_in_name, i.email].filter(Boolean).join(' · ')}
              </span>
            </span>
            <button
              type="button"
              className="text-xs text-[var(--color-danger)] hover:underline"
              onClick={() => {
                if (window.confirm(`Remove this ${labelOf(i.method)} sign-in from ${user}?`)) unlink.mutate(i.id)
              }}
            >
              Unlink
            </button>
          </li>
        ))}
        {data && !data.has_password && data.identities.length === 0 && (
          <li className="text-xs text-[var(--color-ink-muted)]">No way to sign in yet.</li>
        )}
      </ul>
      {delegated.length > 0 && (
        <form className="mt-3 space-y-2" onSubmit={onLink} data-testid="link-delegated-form">
          <select name="method" className="fc-input" aria-label="Service" defaultValue={delegated[0].key}>
            {delegated.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <input name="subject" className="fc-input" aria-label="Employee code" placeholder="Employee code" required />
          <input name="sign_in_name" className="fc-input" aria-label="Login ID at the service" placeholder="Login ID at the service" />
          <button type="submit" className="fc-btn w-full justify-center">Link</button>
        </form>
      )}
      {google && (
        <form className="mt-3 space-y-2" onSubmit={onInvite} data-testid="invite-google-form">
          <input name="email" type="email" className="fc-input" aria-label="Google address to invite" placeholder="Google address to invite" required />
          <button type="submit" className="fc-btn w-full justify-center">Invite {google.label} address</button>
        </form>
      )}
      {error && (
        <p className="mt-2 text-xs text-[var(--color-danger)]" data-testid="user-method-error">
          {error}
        </p>
      )}
    </section>
  )
}
