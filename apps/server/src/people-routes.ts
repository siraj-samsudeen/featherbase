import { Hono } from 'hono'
import { sql } from './db'
import { AppError } from './errors'
import { getDoc } from './document'
import { assertCanChangeAccess, assertFreshForLinking, getAccessToken, issueAccessToken, listAccessTokens, renameAccessToken, revokeAccessToken } from './auth'
import { addIdentifier, addableSystems, deleteIdentifier, findByIdentifier, identifierPerson, listIdentifiers, systemDefaults, updateIdentifier, type AddInput } from './person-identifiers'
import { createServiceAccount, listServiceAccounts, renameServiceAccount, setServiceAccountEnabled, setServiceAccountRoles } from './service-accounts'
import { principalReach } from './token-reach'
import { explainAccess } from './access-explanation'
import { pickPeople, principalNames, tableMembers } from './people-directory'
import { googleAuthorizeUrl, googleAvailable, newLoginChallenge, codeChallengeFor } from './oauth'
import { sendInvitation } from './invitation-email'
import { requestHost } from './instance-addresses'
import { getIdentity, inviteGoogle, linkIdentity, listIdentities, listSignInMethods, methodOfKind, removeOwnPassword, unlinkIdentity, updateIdentity } from './identities'
import { assertSystemManager, getRoles } from './permissions'
import { mailTransport } from './email'
import { who, type Env } from './route-context'
import { externalOrigin, oauthRedirectUri, setLoginChallengeCookies } from './session-cookies'

export const peopleRoutes = new Hono<Env>()

// person-identities D6: linked sign-ins. System Managers manage anyone's;
// a person sees and removes their own and links Google by proving it.
peopleRoutes.get('/api/people/:id/identities', async (c) => {
  await assertSystemManager(who(c))
  const user = c.req.param('id')
  const [row] = await sql`select (password_hash is not null) as has_password, email, expects_google_sign_in from person where row_id = ${user}`
  if (!row) throw new AppError('NotFoundError', `Person ${user} not found`)
  // Every method row, turned off or not, so an identity on a disabled method
  // still shows its name on the Person form.
  const methods = (await listSignInMethods()).map((m) => ({ key: m.key, kind: m.kind, label: m.label || m.key, enabled: m.enabled }))
  return c.json({
    identities: await listIdentities(user, { includeEnded: true }),
    has_password: row.has_password === true,
    methods,
    // #833: the Person's own address starts a Google invite, the panel explains
    // an expected Google sign-in, and says where an invitation went.
    email: row.email ?? null,
    expects_google_sign_in: row.expects_google_sign_in === true,
    mail_transport: mailTransport(),
  })
})

// #667: why a person sees nothing from an app's datasets: the provider's
// places for them, and which each dataset applies or drops. System Manager
// only, the person themself included.
peopleRoutes.get('/api/people/:id/scope', async (c) => {
  await assertSystemManager(who(c))
  const { explainPersonScope } = await import('./scope-explain')
  return c.json(await explainPersonScope(who(c), c.req.param('id'), c.req.query('app') ?? ''))
})

// person-rename: ids are opaque, so screens ask for names (batch), and the
// Person picker searches what people know someone by.
peopleRoutes.post('/api/people/names', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown }
  return c.json({ names: await principalNames(body.ids, who(c)) })
})

peopleRoutes.get('/api/table_members/:table', async (c) => c.json({ data: await tableMembers(c.req.param('table'), who(c)) }))

peopleRoutes.get('/api/people/pick', async (c) => {
  return c.json({ people: await pickPeople(c.req.query('q') ?? '', who(c), Number(c.req.query('limit') ?? 10)) })
})

peopleRoutes.post('/api/people/:id/identities', async (c) => {
  await assertSystemManager(who(c))
  assertCanChangeAccess(c.get('user'))
  const body = (await c.req.json().catch(() => ({}))) as {
    method?: string; subject?: string; sign_in_name?: string; email?: string; send_invitation_email?: boolean
  }
  if (!body.method) throw new AppError('ValidationError', 'Expected { method }', { method: 'required' })
  const google = await methodOfKind('google')
  if (google && body.method === google.key && !body.subject && body.email) {
    const { created, ...identity } = await inviteGoogle(c.req.param('id'), body.email, who(c))
    // #430: a new invite emails the address unless the inviter said not to; a
    // re-invite sends nothing (Resend does). A failed send keeps the invite.
    if (!created) return c.json({ ...identity, invitation_email: { status: 'not_sent', reason: 'already_invited' } }, 200)
    if (body.send_invitation_email === false)
      return c.json({ ...identity, invitation_email: { status: 'not_sent', reason: 'not_requested' } }, 201)
    // The invite is already committed: whatever happens to the email, answer 201.
    const sent = await sendInvitation(identity.id, who(c), externalOrigin(c).origin).catch((err) => {
      console.error(JSON.stringify({ level: 'error', event: 'invitation_email_error', type: err instanceof AppError ? err.type : 'InternalError' }))
      return { invitation_email: { status: 'failed', error: 'The invitation email was not sent' }, invitation_sent_at: null }
    })
    return c.json({ ...identity, ...sent }, 201)
  }
  const { created, ...identity } = await linkIdentity(
    c.req.param('id'), { method: body.method, subject: body.subject ?? '', sign_in_name: body.sign_in_name }, who(c))
  // Re-posting the same link is a no-op the roster sync can rely on: 200, not 409.
  return c.json(identity, created ? 201 : 200)
})

// #430: send a pending invite's email again, at most once in ten minutes. A
// failed send is the answer here (503), since the email is all this does.
peopleRoutes.post('/api/identities/:id/resend_invitation', async (c) => {
  await assertSystemManager(who(c))
  assertCanChangeAccess(c.get('user'))
  const sent = await sendInvitation(c.req.param('id'), who(c), externalOrigin(c).origin)
  if (sent.invitation_email.status === 'failed') throw new AppError('ServiceUnavailableError', sent.invitation_email.error)
  return c.json(sent)
})

// person-resolution D3/D9: a person's identifiers. Reads follow the display
// rule (restricted values only to restricted readers, hidden ones never in a
// panel); writes follow each system's `edited_by`. Errors never echo a value.
peopleRoutes.get('/api/people/:id/identifiers', async (c) => {
  const person = c.req.param('id')
  if (person !== who(c)) await getDoc('Person', person, who(c))
  return c.json({ identifiers: await listIdentifiers(person, who(c)), addable: await addableSystems(person, who(c)) })
})

peopleRoutes.post('/api/people/:id/identifiers', async (c) => {
  assertCanChangeAccess(c.get('user'))
  const person = c.req.param('id')
  if (person !== who(c)) await getDoc('Person', person, who(c))
  const body = (await c.req.json().catch(() => ({}))) as AddInput
  const { result, identifier } = await addIdentifier(person, body, who(c))
  return c.json({ result, identifier }, result === 'created' ? 201 : 200)
})

// Changing or removing a value needs the same read of its person as adding one:
// the Person permission and Data Scope (review on #385).
async function assertReadsIdentifierPerson(id: string, viewer: string) {
  const person = await identifierPerson(id)
  if (person !== viewer) await getDoc('Person', person, viewer)
}

peopleRoutes.patch('/api/identifiers/:id', async (c) => {
  assertCanChangeAccess(c.get('user'))
  await assertReadsIdentifierPerson(c.req.param('id'), who(c))
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof updateIdentifier>[1]
  return c.json(await updateIdentifier(c.req.param('id'), body, who(c)))
})

peopleRoutes.delete('/api/identifiers/:id', async (c) => {
  assertCanChangeAccess(c.get('user'))
  await assertReadsIdentifierPerson(c.req.param('id'), who(c))
  await deleteIdentifier(c.req.param('id'), who(c))
  return c.json({ ok: true })
})

// person-resolution D2: the Identifier System form's Advanced settings, each
// with its preset, which differ, and which options are refused and why.
peopleRoutes.get('/api/identifier_systems/:key/defaults', async (c) => {
  await assertSystemManager(who(c))
  return c.json(await systemDefaults(c.req.param('key')))
})

// Find people by an exact value (D3): `?system=<key>&value=<typed>`.
peopleRoutes.get('/api/identifiers', async (c) => {
  const system = c.req.query('system')
  const value = c.req.query('value')
  if (!system || !value) throw new AppError('ValidationError', 'Expected ?system=&value=', { system: 'required', value: 'required' })
  return c.json({ people: await findByIdentifier(system, value, who(c)) })
})

peopleRoutes.patch('/api/identities/:identityId', async (c) => {
  await assertSystemManager(who(c))
  assertCanChangeAccess(c.get('user'))
  const body = (await c.req.json().catch(() => ({}))) as { sign_in_name?: string | null; person_id?: string }
  return c.json(await updateIdentity(c.req.param('identityId'), { sign_in_name: body.sign_in_name, person_id: body.person_id }, who(c)))
})

peopleRoutes.delete('/api/identities/:identityId', async (c) => {
  await assertSystemManager(who(c))
  assertCanChangeAccess(c.get('user'))
  await getIdentity(c.req.param('identityId'))
  await unlinkIdentity(c.req.param('identityId'), who(c))
  return c.json({ ok: true })
})

peopleRoutes.get('/api/me/sign_in_methods', async (c) => {
  const me = c.get('user')
  const [row] = await sql`select (password_hash is not null) as has_password from person where row_id = ${me.row_id}`
  const methods = (await listSignInMethods()).filter((m) => m.enabled)
  return c.json({
    identities: (await listIdentities(me.row_id)).map(({ id, method, subject, sign_in_name, email, display_name, pending_email, linked_at, last_used_at }) => ({
      id, method, linked: subject != null, sign_in_name, email: email ?? pending_email, display_name, linked_at, last_used_at,
    })),
    has_password: row?.has_password === true,
    methods: methods.map((m) => ({ key: m.key, kind: m.kind, label: m.label, self_link: m.self_link })),
    test_mode: me.sign_in?.test_mode === true,
  })
})

peopleRoutes.delete('/api/me/identities/:identityId', async (c) => {
  assertCanChangeAccess(c.get('user'))
  await unlinkIdentity(c.req.param('identityId'), who(c), { self: who(c) })
  return c.json({ ok: true })
})

peopleRoutes.delete('/api/me/password', async (c) => {
  assertCanChangeAccess(c.get('user'))
  await removeOwnPassword(who(c))
  return c.json({ ok: true })
})

// Start linking Google to the signed-in person: the same state + PKCE flow as
// sign-in, with the purpose and the person signed into the state.
peopleRoutes.get('/api/oauth/google/link', async (c) => {
  const me = c.get('user')
  assertFreshForLinking(me)
  const google = await googleAvailable()
  if (!google || !google.self_link) throw new AppError('PermissionError', 'Linking Google is not available')
  const clientId = google.client_id
  const { state, verifier } = newLoginChallenge(requestHost(c.req.url), { purpose: 'link', uid: me.row_id })
  setLoginChallengeCookies(c, state, verifier)
  const hint = { email: c.req.query('email'), name: c.req.query('name'), subject: c.req.query('subject') }
  return c.redirect(googleAuthorizeUrl(clientId, state, oauthRedirectUri(c, clientId), codeChallengeFor(verifier), hint))
})

// #131: access tokens (replaces the API-005 key pair). Users manage their
// own; System Managers can target any principal — and only they see or act
// on tokens beyond their own.
peopleRoutes.post('/api/access_tokens', async (c) => {
  assertCanChangeAccess(c.get('user'))
  const body = (await c.req.json().catch(() => ({}))) as {
    label?: string
    owner?: string
    expires_at?: string
  }
  const owner = body.owner ?? who(c)
  if (owner !== who(c)) await assertSystemManager(who(c))
  if (typeof body.label !== 'string') throw new AppError('ValidationError', 'Expected { label }')
  let expiresAt: Date | null = null
  if (body.expires_at != null) {
    expiresAt = new Date(body.expires_at)
    if (Number.isNaN(expiresAt.getTime()))
      throw new AppError('ValidationError', 'expires_at must be an ISO date-time')
  }
  return c.json(await issueAccessToken(owner, body.label, expiresAt), 201)
})

// #628: what a person can see, and why. Their own, or anyone's for a System
// Manager; never the data itself.
peopleRoutes.get('/api/access_explanation/:person', async (c) =>
  c.json(await explainAccess(c.req.param('person'), who(c))))

// #852: what a token for this owner could reach, shown before it is issued.
// The same rule as issuing: your own reach, or anyone's for a System Manager.
peopleRoutes.get('/api/access_tokens/reach', async (c) => {
  const owner = c.req.query('owner') || who(c)
  if (owner !== who(c)) await assertSystemManager(who(c))
  return c.json(await principalReach(owner))
})

peopleRoutes.get('/api/access_tokens', async (c) => {
  // System Managers see every token (the admin screen); everyone else their own.
  const all = (await getRoles(who(c))).includes('System Manager')
  return c.json({ tokens: await listAccessTokens(all ? undefined : who(c)) })
})

peopleRoutes.patch('/api/access_tokens/:id', async (c) => {
  assertCanChangeAccess(c.get('user'))
  const token = await getAccessToken(c.req.param('id'))
  if (token.owner !== who(c)) await assertSystemManager(who(c))
  const body = await c.req.json().catch(() => ({})) as { label?: unknown }
  if (typeof body?.label !== 'string') throw new AppError('ValidationError', 'Expected { label }')
  return c.json(await renameAccessToken(token.id, body.label, who(c)))
})

peopleRoutes.delete('/api/access_tokens/:id', async (c) => {
  const token = await getAccessToken(c.req.param('id'))
  if (token.owner !== who(c)) await assertSystemManager(who(c))
  await revokeAccessToken(token.id)
  return c.json({ ok: true })
})

// #131: service accounts — System Manager territory end to end.
peopleRoutes.post('/api/service_accounts', async (c) => {
  await assertSystemManager(who(c))
  // person-rename: the id is minted (`svc_…`); the caller names the account.
  const body = (await c.req.json().catch(() => ({}))) as { label?: string; roles?: string[] }
  if (typeof body.label !== 'string') throw new AppError('ValidationError', 'Expected { label }', { label: 'required' })
  const roles = Array.isArray(body.roles) ? body.roles.filter((r) => typeof r === 'string') : []
  return c.json(await createServiceAccount(body.label, roles, who(c)), 201)
})

peopleRoutes.get('/api/service_accounts', async (c) => {
  await assertSystemManager(who(c))
  return c.json({ service_accounts: await listServiceAccounts() })
})

peopleRoutes.patch('/api/service_accounts/:id', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown; label?: unknown }
  if (typeof body?.label === 'string' && body.enabled === undefined)
    return c.json(await renameServiceAccount(c.req.param('id'), body.label, who(c)))
  if (typeof body?.enabled === 'boolean' && body.label === undefined)
    return c.json(await setServiceAccountEnabled(c.req.param('id'), body.enabled, who(c)))
  throw new AppError('ValidationError', 'Expected either { label } or { enabled }')
})

// person-rename R2: a service account's roles change only here, never
// through the generic row path. The list replaces the current one.
peopleRoutes.post('/api/service_accounts/:id/roles', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json().catch(() => ({}))) as { roles?: unknown }
  if (!Array.isArray(body.roles) || body.roles.some((r) => typeof r !== 'string'))
    throw new AppError('ValidationError', 'Expected { roles: [...] }', { roles: 'a list of role names' })
  return c.json(await setServiceAccountRoles(c.req.param('id'), body.roles as string[], who(c)))
})
