import { useState, type ReactNode } from 'react'
import { Link as RouterLink } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { useIsSystemManager } from '../lib/session'
import { fmtInstantIST } from '@featherbase/shop-floor'
import { Button, Card, Select, TextInput } from '@featherbase/shop-floor'
import { ShownName, principalLabel, usePrincipalNameState } from '../lib/people'

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
  /** #837: when and by whom (or by which sign-in path) the link was made. */
  linked_at?: string | null
  linked_by?: string | null
  last_used_at: string | null
  /** person-resolution D5: an ended link stays as history. */
  ended_at?: string | null
  ended_reason?: string | null
  /** #430: when a pending invite's email last went out; null = never. */
  invitation_sent_at?: string | null
}

/** #430: what became of the invitation email for an invite or a resend. */
type InvitationEmail =
  | { status: 'sent' }
  | { status: 'not_sent'; reason: string }
  | { status: 'failed'; error: string }

/** #837: how a link was made, as an administrator reads it. The sign-in
 *  paths name themselves; anything else is the person who linked it. */
function LinkedHow({ by, who }: { by: string; who: string }) {
  if (by === 'first-sign-in' || by === 'expected-sign-in') return <>at first sign-in</>
  if (by === 'new-person') return <>at first sign-in, which made this person</>
  if (by === 'self') return <>by {who}</>
  return (
    <>
      by <ShownName id={by} />
    </>
  )
}

interface MethodInfo {
  key: string
  kind: string
  label: string
}

export function PersonSignInMethods({ user }: { user: string }) {
  // #414: the confirmation names the person, never their opaque id.
  const named = usePrincipalNameState(user)
  const who = principalLabel(user, named.name, named.loading)
  const isManager = useIsSystemManager()
  const qc = useQueryClient()
  const key = ['user-identities', user]
  const { data } = useQuery({
    queryKey: key,
    enabled: isManager,
    queryFn: () =>
      api.get<{
        identities: AdminIdentity[]
        has_password: boolean
        methods: (MethodInfo & { enabled: boolean })[]
        /** #833: the Person's own address, whether they expect Google sign-in,
         *  and where mail goes on this instance. */
        email: string | null
        expects_google_sign_in: boolean
        mail_transport: 'smtp' | 'email_sink'
      }>(
        `/api/people/${encodeURIComponent(user)}/identities`,
      ),
  })
  const methods = useQuery({
    queryKey: ['sign-in-methods-list'],
    enabled: isManager,
    queryFn: () => api.get<{ methods: MethodInfo[] }>('/api/me/sign_in_methods'),
  })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<ReactNode>(null)
  const done = () => {
    setError(null)
    setNotice(null)
    void qc.invalidateQueries({ queryKey: key })
  }
  const fail = (err: unknown) => {
    setNotice(null)
    setError(err instanceof ApiError ? err.message : 'That did not work')
  }
  // #833: with no SMTP server, mail lands in the Email Sink; nothing reaches
  // the invitee, so the panel never says "emailed".
  const toSink = data?.mail_transport === 'email_sink'
  // #430: say what became of the invitation email. A failed send is an
  // error even though the invite itself was made.
  const reportEmail = (address: string, email: InvitationEmail | undefined) => {
    if (email?.status === 'sent')
      setNotice(
        toSink ? (
          <>
            Invitation saved to the <EmailSinkLink /> for {address}; this instance does not send email.
          </>
        ) : (
          `Invitation emailed to ${address}.`
        ),
      )
    if (email?.status === 'failed') setError(`Invited ${address}, but ${email.error.charAt(0).toLowerCase()}${email.error.slice(1)}.`)
  }
  // The form is cleared only when the server accepted it, so a refused link
  // (a clash, a typo) keeps what was typed for correcting.
  const add = useMutation({
    mutationFn: ({ body }: { body: Record<string, string | boolean>; form: HTMLFormElement }) =>
      api.post<{ invitation_email?: InvitationEmail }>(`/api/people/${encodeURIComponent(user)}/identities`, body),
    onSuccess: (res, { body, form }) => {
      form.reset()
      done()
      if (typeof body.email === 'string') reportEmail(body.email, res.invitation_email)
    },
    onError: fail,
  })
  const resend = useMutation({
    mutationFn: (i: AdminIdentity) =>
      api.post<{ invitation_email: InvitationEmail }>(`/api/identities/${encodeURIComponent(i.id)}/resend_invitation`, {}),
    onSuccess: (res, i) => {
      done()
      reportEmail(i.pending_email ?? '', res.invitation_email)
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
  // still labelled (and says it is off). The identities and the method rows
  // arrive in one answer, and a link's method is a foreign key to a method
  // row, so the row is always there.
  const labelOf = (k: string) => {
    const row = data?.methods.find((m) => m.key === k)
    return row ? `${row.label}${row.enabled ? '' : ' (turned off)'}` : k
  }
  // #837: a Google account reads as its address; its account number means
  // nothing to an administrator and waits under Details.
  const isGoogle = (i: AdminIdentity) => data?.methods.find((m) => m.key === i.method)?.kind === 'google'
  const shownAs = (i: AdminIdentity) =>
    isGoogle(i) && i.email ? i.email : [i.subject, i.sign_in_name, i.email].filter(Boolean).join(' · ')

  // #833: an expected Google sign-in is a way in the panel names, until a
  // Google link or invite takes its place.
  const holdsGoogle = Boolean(google && data?.identities.some((i) => !i.ended_at && i.method === google.key))
  const expectsGoogle = Boolean(google && data?.expects_google_sign_in && data.email && !holdsGoogle)
  // #833: the Person's own address starts the invite, so it is typed once;
  // it can be changed for another Google address.
  const ownAddress = data?.email && !data.identities.some((i) => !i.ended_at && i.pending_email === data.email!.toLowerCase()) ? data.email : ''

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
    add.mutate({
      body: { method: google!.key, email: String(f.get('email')).trim(), send_invitation_email: f.get('send_invitation_email') === 'on' },
      form: e.currentTarget,
    })
  }

  return (
    <Card className="p-3" data-testid="user-sign-in-methods">
      <h3 className="mb-2 text-sm font-semibold text-ink">Sign-in methods</h3>
      <ul className="space-y-2 text-sm">
        {data?.has_password && <li data-testid="user-method-password">Password</li>}
        {data?.identities.filter((i) => !i.ended_at).map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-2" data-testid={`user-method-${i.id}`}>
            <span className="min-w-0">
              <span data-testid="identity-head">
                <span className="font-medium">{labelOf(i.method)}</span>{' '}
                <span className="text-sm text-ink-muted">{i.subject == null ? `invited: ${i.pending_email}` : isGoogle(i) && i.email ? `· ${i.email}` : shownAs(i)}</span>
              </span>
              {i.subject != null && i.linked_at && (
                <span className="block text-sm text-ink-muted" data-testid="identity-linked">
                  linked {fmtInstantIST(i.linked_at)} {i.linked_by && <LinkedHow by={i.linked_by} who={who} />}
                  {' · '}
                  {i.last_used_at ? `last signed in ${fmtInstantIST(i.last_used_at)}` : 'not signed in with it yet'}
                </span>
              )}
              {i.subject != null && isGoogle(i) && i.email && (
                <details className="text-sm text-ink-muted" data-testid="identity-details">
                  <summary className="cursor-pointer">Details</summary>
                  <span className="block">Google account number: {i.subject}</span>
                </details>
              )}
              {i.subject == null && i.invitation_sent_at && (
                <span className="block text-sm text-ink-muted" data-testid={`invitation-sent-${i.id}`}>
                  {toSink ? 'invitation saved to the Email Sink' : 'invitation emailed'} {fmtInstantIST(i.invitation_sent_at)}
                </span>
              )}
            </span>
            <span className="flex shrink-0 flex-col gap-1">
              {i.subject == null && (
                <Button variant="secondary" disabled={resend.isPending} onClick={() => resend.mutate(i)}>
                  Resend invitation
                </Button>
              )}
              <Button
                variant="danger"
                onClick={() => {
                  const ask =
                    isGoogle(i) && i.subject != null
                      ? `Unlink ${shownAs(i)}? This ${labelOf(i.method)} account will no longer sign in as ${who}.`
                      : `Remove this ${labelOf(i.method)} sign-in from ${who}?`
                  if (window.confirm(ask)) unlink.mutate(i.id)
                }}
              >
                Unlink
              </Button>
            </span>
          </li>
        ))}
        {data?.identities.filter((i) => i.ended_at).map((i) => (
          <li key={i.id} className="text-sm text-ink-muted" data-testid={`user-method-ended-${i.id}`}>
            {labelOf(i.method)} {shownAs(i)} — ended{' '}
            {fmtInstantIST(i.ended_at!)} ({i.ended_reason})
          </li>
        ))}
        {expectsGoogle && (
          <li className="text-sm text-ink-muted" data-testid="user-method-expected-google">
            <span className="font-medium text-ink">Expects Google sign-in as {data!.email}.</span> That lets this address in only
            when its domain is allowed for Google sign-in. Invite the address to let it in from any domain.
          </li>
        )}
        {data && !data.has_password && !expectsGoogle && data.identities.filter((i) => !i.ended_at).length === 0 && (
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
      {/* Shown once the Person is loaded, so the starting address never
          replaces what the administrator has begun to type. */}
      {google && data && (
        <form className="mt-3 space-y-2" onSubmit={onInvite} data-testid="invite-google-form">
          <TextInput
            key={ownAddress}
            name="email"
            type="email"
            aria-label="Google address to invite"
            placeholder="Google address to invite"
            defaultValue={ownAddress}
            required
          />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="send_invitation_email" defaultChecked className="shrink-0 accent-action" />
            Email an invitation to this address
          </label>
          <Button type="submit" block>Invite {google.label} address</Button>
        </form>
      )}
      {notice && (
        <p className="mt-2 text-sm text-positive" role="status" data-testid="user-method-notice">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-negative" data-testid="user-method-error">
          {error}
        </p>
      )}
    </Card>
  )
}

function EmailSinkLink() {
  return (
    <RouterLink to="/featherbase/admin/$table" params={{ table: 'Email Sink' }} search={{ filters: undefined }} className="text-action underline">
      Email Sink
    </RouterLink>
  )
}
