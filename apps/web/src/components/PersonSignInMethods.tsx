import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { useIsSystemManager } from '../lib/session'
import { fmtInstantIST } from '@featherbase/shop-floor'
import { Button, TextInput, cardClasses } from '@featherbase/shop-floor'
import { PrincipalLink, principalLabel, usePrincipalNameState } from '../lib/people'
import { NO_AUTOFILL_FIELD, NO_AUTOFILL_FORM } from '../lib/no-autofill'
import { usePersonStanding } from './PersonStanding'

// person-identities (#275, review B-M4): on a Person's form, a System Manager
// sees how that person signs in — password, linked outside accounts, pending
// Google invites — and can link a connected service, invite a Google address
// or unlink one. Moving a link stays an API call (PATCH /api/identities/:id).
//
// #1267 layout A: one line per way in, each with its status and one button.
// The button opens a small dialog asking only for that method's fields, so
// no field on the page sits beside a button it does not belong to.

/** The Person columns the Sign-In lines set, so a saved Person's fields leave
 *  them out wherever they are drawn generically (the form, the record pane). */
const SIGN_IN_OWNS = new Set(['expects_google_sign_in', 'expects_microsoft_sign_in'])

export function managedBySignIn(table: string, column: string): boolean {
  return table === 'Person' && SIGN_IN_OWNS.has(column)
}

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
      by <PrincipalLink id={by} />
    </>
  )
}

/** #1257: a password invite, as the Person's panel reads it. */
interface PasswordInvite {
  status: 'sending' | 'pending' | 'expired' | 'accepted' | 'voided' | 'not_sent'
  sent_at: string | null
  expires_at: string
  accepted_at: string | null
}

interface MethodInfo {
  key: string
  kind: string
  label: string
}

export function PersonSignInMethods({ user, rowUpdatedAt }: {
  user: string
  /** The Person row as the page loaded it: a change to its sign-in switches is made against it. */
  rowUpdatedAt?: unknown
}) {
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
        methods: (MethodInfo & { enabled: boolean; employees_only?: boolean })[]
        /** #833: the Person's own address, whether they expect Google sign-in,
         *  and where mail goes on this instance. */
        email: string | null
        expects_google_sign_in: boolean
        expects_microsoft_sign_in: boolean
        mail_transport: 'smtp' | 'email_sink'
        /** #1257: whether a password invite can be sent, why not, and the latest. */
        password_invite: { offered: boolean; refusal: string | null; latest: PasswordInvite | null }
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
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [showEnded, setShowEnded] = useState(false)
  // #1267 step 3: a former employee or an external person is offered no employees-only method.
  // An unknown standing (the people app could not say) offers it, as before.
  const standing = usePersonStanding(user)
  const heading = useRef<HTMLHeadingElement>(null)
  // The button to return to after an action, placed once the redrawn lines are on the page.
  const refocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const opener = refocus.current
    if (!opener) return
    refocus.current = null
    if (opener.isConnected) opener.focus()
    else heading.current?.focus()
  }, [data])
  // #1257: a notice names an address; once the Person's email changes (their
  // invites are then cancelled) it no longer describes anything live.
  const shownEmail = data?.email
  useEffect(() => {
    setNotice(null)
    setError(null)
  }, [shownEmail])
  const open = (what: Dialog['what'], opener: HTMLElement, identity?: AdminIdentity, method?: MethodInfo) => {
    setError(null)
    setDialog({ what, opener, identity, method })
  }
  // Escape or Cancel: focus goes back to the line's button.
  const close = () => {
    const opener = dialog?.opener
    setDialog(null)
    setError(null)
    opener?.focus()
  }
  // A finished action redraws the lines; once they are read again, focus goes
  // to the same button if it is still there, otherwise to the Sign-In heading.
  const done = () => {
    const opener = dialog?.opener
    setDialog(null)
    setError(null)
    setNotice(null)
    refocus.current = opener ?? null
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
  // A refused link or invite (a clash, a typo) keeps its dialog open with what
  // was typed, for correcting.
  const add = useMutation({
    mutationFn: (body: Record<string, string | boolean>) =>
      api.post<{ invitation_email?: InvitationEmail }>(`/api/people/${encodeURIComponent(user)}/identities`, body),
    onSuccess: (res, body) => {
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
  // #1257: send, or send again (a new link voids the earlier one).
  const passwordInvite = useMutation({
    mutationFn: () => api.post(`/api/people/${encodeURIComponent(user)}/password_invite`, {}),
    onSuccess: () => {
      done()
      const address = data?.email ?? ''
      setNotice(
        toSink ? (
          <>
            Password invite saved to the <EmailSinkLink /> for {address}; this instance does not send email.
          </>
        ) : (
          `Password invite emailed to ${address}.`
        ),
      )
    },
    onError: fail,
  })
  const unlink = useMutation({
    mutationFn: (id: string) => api.delete(`/api/identities/${encodeURIComponent(id)}`),
    onSuccess: done,
    onError: fail,
  })
  const rename = useMutation({
    mutationFn: ({ id, signInName }: { id: string; signInName: string }) =>
      api.patch(`/api/identities/${encodeURIComponent(id)}`, { sign_in_name: signInName || null }),
    onSuccess: done,
    onError: fail,
  })
  // #1267: whether this person is expected to sign in with Google or Microsoft
  // is a Person column; the details form reads it again.
  const expect = useMutation({
    mutationFn: (change: Partial<Record<'expects_google_sign_in' | 'expects_microsoft_sign_in', boolean>>) =>
      api.patch(`/api/table/Person/${encodeURIComponent(user)}`, { ...change, updated_at: rowUpdatedAt }),
    onSuccess: () => {
      done()
      void qc.invalidateQueries({ queryKey: ['doc', 'Person', user] })
    },
    onError: fail,
  })
  if (!isManager) return null
  // Lines are drawn once both answers are in: a link drawn before its method is
  // known would be placed apart and then move, a flicker for anyone reading it.
  if (!data || !methods.data)
    return (
      <section aria-labelledby="sign-in-heading" className="flex flex-col gap-2" data-testid="user-sign-in-methods">
        <h2 id="sign-in-heading" className="text-sm font-medium text-ink-muted">Sign-In</h2>
        <p className="text-sm text-ink-subtle">Loading…</p>
      </section>
    )

  const all = methods.data.methods
  const delegated = all.filter((m) => m.kind === 'delegated_password')
  const google = all.find((m) => m.kind === 'google')
  const microsoft = all.find((m) => m.kind === 'microsoft')
  // Names come from every method row, so a link on a turned-off method is
  // still labelled (and says it is off). The identities and the method rows
  // arrive in one answer, and a link's method is a foreign key to a method
  // row, so the row is always there.
  const labelOf = (k: string) => {
    const row = data?.methods.find((m) => m.key === k)
    return row ? `${row.label}${row.enabled ? '' : ' (turned off)'}` : k
  }
  const kindOf = (i: AdminIdentity) => data?.methods.find((m) => m.key === i.method)?.kind ?? ''
  // #837: a Google or Microsoft account reads as its address; its account
  // number means nothing to an administrator and waits under Details.
  const byAddress = (i: AdminIdentity) => ['google', 'microsoft'].includes(kindOf(i))
  const shownAs = (i: AdminIdentity) =>
    byAddress(i) && i.email ? i.email : [i.subject, i.sign_in_name, i.email].filter(Boolean).join(' · ')

  const live = data?.identities.filter((i) => !i.ended_at) ?? []
  const ended = data?.identities.filter((i) => i.ended_at) ?? []
  const liveOf = (m: MethodInfo | undefined) => (m ? live.filter((i) => i.method === m.key) : [])
  // #833: an expected sign-in is a way in the panel names, until a link or an
  // invite takes its place.
  const expectsGoogle = Boolean(google && data?.expects_google_sign_in && data.email && !liveOf(google).length)
  const expectsMicrosoft = Boolean(microsoft && data?.expects_microsoft_sign_in && data.email && !liveOf(microsoft).length)
  // #833: the Person's own address starts the invite, so it is typed once;
  // it can be changed for another Google address.
  const ownAddress = data?.email && !live.some((i) => i.pending_email === data.email!.toLowerCase()) ? data.email : ''
  // Links on a method this instance no longer offers still show, to be turned off.
  const shownKeys = new Set([google?.key, microsoft?.key, ...delegated.map((m) => m.key)])
  const orphans = live.filter((i) => !shownKeys.has(i.method))
  const outsider = standing.data?.status === 'left' || standing.data?.status === 'none'
  const closedTo = (m: MethodInfo) => outsider && data.methods.some((x) => x.key === m.key && x.employees_only)
  const noWayIn = data && !data.has_password && !expectsGoogle && !expectsMicrosoft && live.length === 0

  /** One linked account or invite: what it is, and its one button. */
  const identityLine = (i: AdminIdentity, name: string) => {
    const invited = i.subject == null
    const delegatedLink = kindOf(i) === 'delegated_password'
    return (
      <MethodLine key={i.id} name={name} testid={`user-method-${i.id}`}
        status={
          <>
            <span data-testid="identity-head">
              {invited ? <>Invited · <b className="font-medium text-ink">{i.pending_email}</b></>
                : delegatedLink ? <><span className="font-medium text-positive">Linked</span> · <b className="font-medium text-ink">{shownAs(i)}</b></>
                  : <><span className="font-medium text-positive">On</span> · signs in as <b className="font-medium text-ink">{shownAs(i)}</b></>}
            </span>
            {!invited && i.linked_at && (
              <span className="block" data-testid="identity-linked">
                linked {fmtInstantIST(i.linked_at)} {i.linked_by && <LinkedHow by={i.linked_by} who={who} />}
                {' · '}
                {i.last_used_at ? `last signed in ${fmtInstantIST(i.last_used_at)}` : 'not signed in with it yet'}
              </span>
            )}
            {!invited && byAddress(i) && i.email && (
              <details data-testid="identity-details">
                <summary className="cursor-pointer">Details</summary>
                <span className="block">{kindOf(i) === 'microsoft' ? 'Microsoft account ID' : 'Google account number'}: {i.subject}</span>
              </details>
            )}
            {/* #1271: a link that predates the employees-only rule, on someone who isn't an employee. */}
            {!invited && standing.data?.status === 'none' && data!.methods.some((m) => m.key === i.method && m.employees_only) && (
              <span className="block text-xs text-ink-subtle" data-testid={`sign-in-leftover-${i.id}`}>Not an employee: remove this link.</span>
            )}
            {invited && i.invitation_sent_at && (
              <span className="block" data-testid={`invitation-sent-${i.id}`}>
                {toSink ? 'invitation saved to the Email Sink' : 'invitation emailed'} {fmtInstantIST(i.invitation_sent_at)}
              </span>
            )}
          </>
        }
        action={invited ? 'Change' : delegatedLink ? 'Change' : 'Turn Off'}
        onAction={(el) => open(invited ? 'invited' : delegatedLink ? 'change-link' : 'turn-off', el, i)}
      />
    )
  }

  const dialogFor = (d: Dialog) => {
    const i = d.identity
    switch (d.what) {
      case 'turn-off':
        return (
          <MethodDialog title={`Turn off ${labelOf(i!.method)}`} onClose={close} error={error} testid="sign-in-dialog">
            <p className="text-sm text-ink-muted">
              {byAddress(i!) && i!.subject != null
                ? `Unlink ${shownAs(i!)}? This ${labelOf(i!.method)} account will no longer sign in as ${who}.`
                : `Remove this ${labelOf(i!.method)} sign-in from ${who}?`}
            </p>
            <DialogButtons onClose={close}>
              <Button variant="danger" data-autofocus disabled={unlink.isPending} onClick={() => unlink.mutate(i!.id)}>Turn Off</Button>
            </DialogButtons>
          </MethodDialog>
        )
      case 'invited':
        return (
          <MethodDialog title={`Invitation to ${i!.pending_email}`} onClose={close} error={error} testid="sign-in-dialog">
            <p className="text-sm text-ink-muted">
              {i!.invitation_sent_at ? `${toSink ? 'Saved to the Email Sink' : 'Emailed'} ${fmtInstantIST(i!.invitation_sent_at)}. ` : ''}
              The invitation lets this address sign in with {labelOf(i!.method)} as {who}.
            </p>
            <DialogButtons onClose={close}>
              <Button variant="danger" disabled={unlink.isPending} onClick={() => unlink.mutate(i!.id)}>Withdraw Invite</Button>
              <Button variant="primary" data-autofocus disabled={resend.isPending} onClick={() => resend.mutate(i!)}>Resend Invitation</Button>
            </DialogButtons>
          </MethodDialog>
        )
      case 'google-invite':
        return (
          <MethodDialog title={`Invite a ${google!.label} address`} onClose={close} error={error} testid="sign-in-dialog">
            <form className="space-y-3" data-testid="invite-google-form" {...NO_AUTOFILL_FORM}
              onSubmit={(e) => {
                e.preventDefault()
                const f = new FormData(e.currentTarget)
                add.mutate({ method: google!.key, email: String(f.get('invite_address')).trim(), send_invitation_email: f.get('send_invitation_email') === 'on' })
              }}>
              <p className="text-sm text-ink-muted">
                {expectsGoogle
                  ? `${data!.email} is expected to sign in with ${google!.label}, which lets it in only when its domain is allowed. An invite lets it in from any domain.`
                  : `An invite lets this address in from any domain.${data?.email ? ` Expecting ${data.email} instead lets it in only when its domain is allowed for ${google!.label} sign-in.` : ''}`}
              </p>
              <TextInput name="invite_address" type="text" inputMode="email" {...NO_AUTOFILL_FIELD}
                aria-label="Google address to invite" placeholder="Google address to invite" defaultValue={ownAddress} required />
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="send_invitation_email" defaultChecked className="shrink-0 accent-action" />
                Email an invitation to this address
              </label>
              <DialogButtons onClose={close}>
                {expectsGoogle && (
                  <Button variant="danger" type="button" disabled={expect.isPending} onClick={() => expect.mutate({ expects_google_sign_in: false })}>
                    Stop Expecting
                  </Button>
                )}
                {/* #833: without an invite, the person's own address may still be let in by its domain. */}
                {!expectsGoogle && data?.email && (
                  <Button variant="secondary" type="button" disabled={expect.isPending} onClick={() => expect.mutate({ expects_google_sign_in: true })}>
                    Expect Sign-In Instead
                  </Button>
                )}
                <Button variant="primary" type="submit" disabled={add.isPending}>Invite</Button>
              </DialogButtons>
            </form>
          </MethodDialog>
        )
      case 'microsoft-on':
        return (
          <MethodDialog title={`Set up ${microsoft!.label}`} onClose={close} error={error} testid="sign-in-dialog">
            <p className="text-sm text-ink-muted">
              {data?.email
                ? `Lets ${data.email} sign in with ${microsoft!.label}. It works only when its domain is allowed for ${microsoft!.label} sign-in and ${microsoft!.label} confirms the organisation owns it.`
                : `Give ${who} an email first: ${microsoft!.label} sign-in uses it.`}
            </p>
            <DialogButtons onClose={close}>
              {data?.email && (
                <Button variant="primary" data-autofocus disabled={expect.isPending} onClick={() => expect.mutate({ expects_microsoft_sign_in: true })}>Set Up</Button>
              )}
            </DialogButtons>
          </MethodDialog>
        )
      case 'microsoft-off':
        return (
          <MethodDialog title={`Turn off ${microsoft!.label}`} onClose={close} error={error} testid="sign-in-dialog">
            <p className="text-sm text-ink-muted">Stop expecting {data!.email} to sign in with {microsoft!.label}?</p>
            <DialogButtons onClose={close}>
              <Button variant="danger" data-autofocus disabled={expect.isPending} onClick={() => expect.mutate({ expects_microsoft_sign_in: false })}>Turn Off</Button>
            </DialogButtons>
          </MethodDialog>
        )
      case 'link':
        return (
          <MethodDialog title={`Link a ${d.method!.label} record`} onClose={close} error={error} testid="sign-in-dialog">
            <form className="space-y-3" data-testid="link-delegated-form" {...NO_AUTOFILL_FORM}
              onSubmit={(e) => {
                e.preventDefault()
                const f = new FormData(e.currentTarget)
                add.mutate({ method: d.method!.key, subject: String(f.get('link_record_number')).trim(), sign_in_name: String(f.get('link_login_id')).trim() })
              }}>
              <TextInput name="link_record_number" aria-label="Record number at the service" placeholder="Record number at the service" required {...NO_AUTOFILL_FIELD} />
              <TextInput name="link_login_id" aria-label="Login ID at the service" placeholder="Login ID at the service" {...NO_AUTOFILL_FIELD} />
              <DialogButtons onClose={close}>
                <Button variant="primary" type="submit" disabled={add.isPending}>Link</Button>
              </DialogButtons>
            </form>
          </MethodDialog>
        )
      case 'change-link':
        return (
          <MethodDialog title={`Change the ${labelOf(i!.method)} link`} onClose={close} error={error} testid="sign-in-dialog">
            <p className="mb-3 text-sm text-ink-muted">
              Linked to number {i!.subject}. Only its login ID changes here; to use another number, unlink this one and link that.
            </p>
            <form className="space-y-3" data-testid="change-link-form" {...NO_AUTOFILL_FORM}
              onSubmit={(e) => {
                e.preventDefault()
                rename.mutate({ id: i!.id, signInName: String(new FormData(e.currentTarget).get('link_login_id')).trim() })
              }}>
              <TextInput name="link_login_id" aria-label="Login ID at the service" placeholder="Login ID at the service"
                defaultValue={i!.sign_in_name ?? ''} {...NO_AUTOFILL_FIELD} />
              <DialogButtons onClose={close}>
                <Button variant="danger" type="button" disabled={unlink.isPending} onClick={() => unlink.mutate(i!.id)}>Unlink</Button>
                <Button variant="primary" type="submit" disabled={rename.isPending}>Save</Button>
              </DialogButtons>
            </form>
          </MethodDialog>
        )
      case 'password-invite': {
        const pending = data?.password_invite.latest?.status === 'pending'
        return (
          <MethodDialog title={pending ? 'Resend the password invite' : 'Send a password invite'} onClose={close} error={error} testid="sign-in-dialog">
            <p className="text-sm text-ink-muted">
              Emails {data?.email} a link to set a password. It works once, for 72 hours.{pending ? ' The earlier link stops working.' : ''}
            </p>
            <DialogButtons onClose={close}>
              <Button variant="primary" data-autofocus disabled={passwordInvite.isPending} onClick={() => passwordInvite.mutate()}>
                {pending ? 'Resend' : 'Send Invite'}
              </Button>
            </DialogButtons>
          </MethodDialog>
        )
      }
    }
  }

  const invite = data?.password_invite
  const pendingPassword = invite?.latest?.status === 'pending' ? invite.latest : null
  const endedPassword: Partial<Record<PasswordInvite['status'], string>> = {
    expired: 'The last password invite expired.',
    voided: 'The last password invite was cancelled.',
    not_sent: 'The last password invite was not sent.',
  }

  return (
    <section aria-labelledby="sign-in-heading" className="flex flex-col gap-2" data-testid="user-sign-in-methods">
      <h2 id="sign-in-heading" ref={heading} tabIndex={-1} className="text-sm font-medium text-ink-muted focus-visible:outline-none">Sign-In</h2>
      {noWayIn && <p className="text-sm text-ink-muted">No way to sign in yet.</p>}
      {data && google && (liveOf(google).length ? liveOf(google).map((i) => identityLine(i, google.label)) : (
        <MethodLine name={google.label} testid={expectsGoogle ? 'user-method-expected-google' : 'sign-in-line-google'}
          status={expectsGoogle ? <>Expected as <b className="font-medium text-ink">{data.email}</b>, when its domain is allowed</> : 'Not set up'}
          action={expectsGoogle ? 'Change' : 'Set Up'} onAction={(el) => open('google-invite', el)} />
      ))}
      {data && microsoft && (liveOf(microsoft).length ? liveOf(microsoft).map((i) => identityLine(i, microsoft.label)) : (
        <MethodLine name={microsoft.label} testid={expectsMicrosoft ? 'user-method-expected-microsoft' : 'sign-in-line-microsoft'}
          status={expectsMicrosoft
            ? <>Expected as <b className="font-medium text-ink">{data.email}</b>, when its domain is allowed and {microsoft.label} confirms the organisation owns it</>
            : 'Not set up'}
          action={expectsMicrosoft ? 'Turn Off' : 'Set Up'} onAction={(el) => open(expectsMicrosoft ? 'microsoft-off' : 'microsoft-on', el)} />
      ))}
      {data && delegated.map((m) => (liveOf(m).length ? liveOf(m).map((i) => identityLine(i, m.label)) : closedTo(m) ? (
        <p key={m.key} className="rounded-lg bg-caution-tint px-3 py-2 text-sm text-ink" data-testid={`sign-in-closed-${m.key}`}>
          {m.label} sign-in is only for current employees.
        </p>
      ) : (
        <MethodLine key={m.key} name={m.label} testid={`sign-in-line-${m.key}`} status="Not linked"
          action="Link" onAction={(el) => open('link', el, undefined, m)} />
      )))}
      {orphans.map((i) => identityLine(i, labelOf(i.method)))}
      {data && (
        <MethodLine name="Password" testid={data.has_password ? 'user-method-password' : pendingPassword || invite?.offered ? 'password-invite' : 'sign-in-line-password'}
          status={data.has_password ? (
            <>
              <span className="font-medium text-positive">Set</span>
              {invite?.latest?.status === 'accepted' && invite.latest.accepted_at && (
                <span className="block" data-testid="password-invite-accepted">
                  set from a password invite <span className="whitespace-nowrap">{fmtInstantIST(invite.latest.accepted_at)}</span>
                </span>
              )}
            </>
          ) : pendingPassword?.sent_at ? (
            <span data-testid="password-invite-status">
              Invite {toSink ? 'saved to the Email Sink' : 'emailed'} <span className="whitespace-nowrap">{fmtInstantIST(pendingPassword.sent_at)}</span> · expires{' '}
              <span className="whitespace-nowrap">{fmtInstantIST(pendingPassword.expires_at)}</span>
            </span>
          ) : (
            <>
              Not set
              {invite?.latest && endedPassword[invite.latest.status] && <span className="block">{endedPassword[invite.latest.status]}</span>}
              {!invite?.offered && invite?.refusal && <span className="block">{invite.refusal}</span>}
            </>
          )}
          action={data.has_password ? undefined : pendingPassword ? 'Resend' : invite?.offered ? 'Send Invite' : undefined}
          onAction={(el) => open('password-invite', el)} />
      )}
      {ended.length > 0 && (
        <div className="px-1">
          <button type="button" aria-expanded={showEnded} onClick={() => setShowEnded((was) => !was)} data-testid="sign-in-show-ended"
            className="text-sm text-ink-muted hover:text-ink hover:underline">
            {showEnded ? 'Hide ended' : `Show ${ended.length} ended`}
          </button>
          {showEnded && (
            <ul className="mt-1 space-y-1">
              {ended.map((i) => (
                <li key={i.id} className="text-sm text-ink-muted" data-testid={`user-method-ended-${i.id}`}>
                  {labelOf(i.method)} {shownAs(i)} — ended {fmtInstantIST(i.ended_at!)} ({i.ended_reason})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {notice && (
        <p className="text-sm text-positive" role="status" data-testid="user-method-notice">
          {notice}
        </p>
      )}
      {error && !dialog && (
        <p className="text-sm text-negative" data-testid="user-method-error">
          {error}
        </p>
      )}
      {dialog && dialogFor(dialog)}
    </section>
  )
}

interface Dialog {
  what: 'turn-off' | 'invited' | 'google-invite' | 'microsoft-on' | 'microsoft-off' | 'link' | 'change-link' | 'password-invite'
  opener: HTMLElement
  identity?: AdminIdentity
  method?: MethodInfo
}

/** #1267: one way in: its name, its status, and at most one button. */
function MethodLine({ name, status, action, onAction, testid }: {
  name: string
  status: ReactNode
  action?: string
  onAction: (opener: HTMLElement) => void
  testid: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-subtle px-3 py-2.5" data-testid={testid}>
      <span className="w-24 shrink-0 pt-1 text-sm font-semibold text-ink">{name}</span>
      <span className="min-w-0 flex-1 pt-1 text-sm text-ink-muted">{status}</span>
      {action && (
        <Button variant="secondary" className="shrink-0" onClick={(e) => onAction(e.currentTarget)} data-testid="sign-in-line-action">
          {action}
        </Button>
      )}
    </div>
  )
}

/** #1267: a small dialog for one method's fields. Its first field (or main
 *  button) takes focus; Escape, Cancel or a click outside closes it. */
function MethodDialog({ title, onClose, error, testid, children }: {
  title: string
  onClose: () => void
  error: string | null
  testid: string
  children: ReactNode
}) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input:not([type="checkbox"]), [data-autofocus]')?.focus()
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        onClose()
      }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={id} data-testid={testid} className={cardClasses('w-full max-w-sm p-4')}>
        <h2 id={id} className="mb-2 text-base font-semibold text-ink">{title}</h2>
        {children}
        {error && (
          <p className="mt-3 text-sm text-negative" role="alert" data-testid="user-method-error">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

function DialogButtons({ onClose, children }: { onClose: () => void; children?: ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onClose} data-testid="sign-in-dialog-cancel">Cancel</Button>
      {children}
    </div>
  )
}

function EmailSinkLink() {
  return (
    <RouterLink to="/featherbase/admin/table/$table" params={{ table: 'Email Sink' }} search={{ filters: undefined }} className="text-action underline">
      Email Sink
    </RouterLink>
  )
}
