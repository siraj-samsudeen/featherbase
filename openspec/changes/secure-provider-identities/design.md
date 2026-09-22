## Context

See proposal.md for scope. The separately committed authentication baseline records
the old behavior without endorsing it. `oauth.ts` currently drops Google `sub` and
matches User email/row ID; `auth.ts` signs only `sub`/`exp`; `index.ts` logout deletes
the cookie. `password-reset.ts` can create a native password on any enabled human
User. `realtime.ts` authenticates on connection but later sends from a cached User.
Those are the deciding boundaries, not merely the login page.

Existing machinery to reuse: metadata-defined User, migrations, transaction-aware
`sql`, database-backed `pre-auth-rate-limit.ts`, session cookie/Bearer transport,
server-side app landing, safe runtime return validation and `.fc-*` UI components.
Raw auth storage must be protected from generic Table APIs and qualified in
`platform-schema.ts`, like existing access-token infrastructure.

## Goals / Non-Goals

**Goals:** keep verification provider-specific and ownership/session issuance
provider-neutral; make revocation an invariant on every use; keep the two account
populations separate from the multiple-identities-per-person case; prove the
cross-process races, not just sequential happy paths.

**Non-Goals:** SCIM/HR synchronization, partial offboarding, passkey registration,
provider API access beyond login, plugin loading or arbitrary configurable HTTP
credential endpoints. StyleHR is a closed activation boundary, not a purported
live integration. No deployment or real-credential verification is part of proof.

## Decisions

### Stable User and External Identity

Keep `User.row_id` stable; new external-only Users get an opaque ID, not a fabricated
email. Make User email optional in metadata and shared/browser types; keep contact
email separate from provider claim metadata. A User email remains unique when
present, but matching provider claims never overwrite it or link Users.

Store External Identity as protected auth infrastructure with User reference,
provider configuration ID, validated issuer, case-sensitive subject, minimal
display/email claims, and active/revoked state. Enforce a unique triple across
both active and revoked identities. Unlink preserves the owner tombstone: otherwise
a removed identity could immediately be claimed by another User. Re-link to its
original User requires the complete proof sequence again.

An opaque provider configuration ID defines an immutable client/issuer namespace.
Reject changing that namespace after identities exist; an intentional client move
uses a new provider and explicit reenrollment. Enablement is independent. Google
supports many subjects under one provider; do not create a provider per Workspace
domain. Microsoft uses validated issuer + pairwise `sub`; a tenant-scoped issuer
keeps guest/home identities distinct. Do not mix `oid` and `sub` opportunistically.

Alternative rejected: merge by verified email or place the subject in User ID.
Neither represents several independent identities safely, and email recycling can
move permissions to a different person.

### Durable Login Session, with generation-based invalidation

Retain JWT cookie/Bearer transport, add a random session ID, and require a matching
server-side Login Session record on resolution. Store User, originating method,
creation/expiry, authentication time (nullable when not attested), revocation and
the generation values observed at issuance. Never persist the bearer credential.
Reject old JWTs without a session ID; do not add compatibility acceptance.

Maintain monotonic authentication generations for User and provider; identity
unlink has its own revoked state/generation. Database-enforced generation changes
on User disable and native-password change cover generic document writes as well
as auth APIs. Provider disable changes its generation. Re-enable never decrements
a generation, so old sessions cannot revive. Ordinary logout revokes one record.
Operations capture/check the same generations at completion. User eligibility is
the local enabled flag, including employment offboarding; provider choice cannot
bypass it. Existing access-token resolution also continues checking User enablement.

Anonymous hosted login does not yet know the User or identity at initiation.
Retain a monotonic authentication-valid-after timestamp alongside their generations;
after resolving the subject, reject any proof operation begun at or before that
cutoff. This covers disable/re-enable and unlink/re-link during consent without
guessing a User from an email hint. Use the operation's server-recorded start, not
token issue time or a caller-supplied timestamp.

Issue/bind/revoke inside transactions locking provider, then User, then identity/
operation/session rows consistently. A callback that verified externally before
disable must recheck inside this boundary before creating a session. Do not hold
database locks while waiting on the provider. Unique subject ownership is the
database arbiter, not a check-then-insert application convention. Native method
eligibility is explicit and system-managed; migration enables it only for existing
human Users with local hashes. External enrollment never enables it.

`resolveToken` remains the single HTTP/session authority. WebSockets retain a
credential/session reference and revalidate on subscribe and before each external
delivery, closing with the existing unauthorized code on failure. Cached User
objects or process-local invalidation alone cannot enforce multi-process revoke.
Already-authorized work is not rolled back retroactively. Preserve event ordering
when making socket delivery asynchronous; test queued delivery at revocation.

### One-purpose, one-use authentication operations

Use protected durable operation records, not a signed browser blob carrying
mutable authority. Each captures purpose (`login`, source reauthentication,
target linking, enrollment, recovery or unlink authorization), current session/
User when relevant, provider version, browser binding, state/nonce/PKCE verifier,
validated return path and expiry. Keep only hashes of externally presented random
operation/invitation secrets; the PKCE verifier is short-lived server-only secret
state, deleted on consumption/expiry. Consume operations atomically; do not restore
them after exchange failure. SameSite cookies plus explicit Origin/CSRF checks
protect same-site account mutations. Rate limiting precedes exchange and hashing.

Source proof names an exact already linked method. After validating it, create a
target operation which cannot outlive the source freshness deadline or source
session. Target proof must come from that new operation. No callback can choose
its own target User or convert login into linking. Concurrent operations use
distinct browser bindings rather than overwriting a single global state cookie.

The handoff remains one minute, browser-bound and one-use, but persists shared
state and resolves current session eligibility before redemption. Log neither
callback query strings nor handoff values. Browser callback code clears sensitive
URL state before downstream navigation and uses a no-referrer response policy.

### Hosted provider verification and freshness are different claims

Use a maintained OIDC client and its supported issuer/signature/nonce/PKCE
validation; do not hand-roll JWKS or trust token URLs. Restrict discovery and
callback origins to configured Google/Microsoft authorities; never discover from
an unverified token's issuer. Microsoft's `common` authority is only the entry
point: validate the actual tenant issuer and audience using the provider's
documented multi-tenant validation, including personal-account support. Request
`openid profile email`, no offline access, and discard exchanged provider tokens
after extracting validated minimum claims.

For ordinary login, fresh operation-bound authentication is sufficient. For source
reauthentication, use the actual authenticated-at time, not `iat` or callback time.
Native password verification records current server time. Supported OIDC providers
must attest `auth_time`; absent, malformed, future or too-old values fail closed.
Expiry is checked again at mutation completion.

Google explicitly does not support Google Account reauthentication requests.
Its Security Bundle can attest `auth_time` only with published/verified app and
session-age claims enabled. Request the claim, but do not pretend `prompt=consent`,
`select_account`, `login`, or `max_age` forces fresh authentication. A Google-only
User with missing/stale evidence can log in, but cannot self-service link/unlink;
offer another already linked method or controlled recovery. Adding passkeys is a
separate scope decision, not an implicit weakening of source proof. Target proof
is a fresh operation after source verification; it need not independently have
recent underlying provider-session authentication.

Sources read 2026-09-22:
- https://developers.google.com/identity/openid-connect/openid-connect
- https://developers.google.com/identity/siwg/security-bundle
- https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc

### Enrollment is not recovery

Initial invitations are short-lived bearer credentials issued by recently
reauthenticated System Managers for a new, never-enrolled User and provider.
Display them once for controlled handoff, accept through POST rather than a URL
query, and store only a hash. Fresh provider proof consumes them and creates one
binding; it does not create grants. Reject initial enrollment for legacy accounts.

Legacy Google Users lack an independently trustworthy subject. Never infer one
from their next email-matching login. A native-enabled User can authenticate and
link normally. Otherwise controlled recovery first collects a fresh target proof,
then a recently reauthenticated System Manager approves that exact User/namespace/
issuer/subject after independent organizational claimant verification. Record a
verification-method/case reference, not sensitive proof documents. Initial recovery
invitation possession cannot authorize an arbitrary target. Approval is one-use,
does not re-enable the User, and revokes all prior sessions/operations. Do not
create a generic reusable reauthentication flag from recovery.

The recovery operator is trusted to make that decision. Audit cannot prevent a
deliberately malicious authorized operator; dual-control governance is outside
this bounded release. Freshness rules also apply to the operator. Refuse last-
method unlink until another method is actually verified, not merely invited.

### StyleHR remains unavailable; no credential cache exists

Represent an unavailable provider/activation reason without exposing a password
form. Reject enablement and credential submission before processing credentials.
A test credential adapter can exercise the shared verified-identity pipeline with
synthetic subjects, but must not masquerade as live StyleHR validation. A future
separately reviewed adapter can use the same pipeline once the authoritative
schema, inactive semantics and non-reassignment/rehire identity boundary are known.

No encryption or salted hash is relevant to this implementation because no StyleHR
password/verifier is retained. No cache hit, expiry or stale-on-error path exists.
When activation is possible, online verification is required each fresh login;
ordinary local revocable sessions avoid repeated password checks for every page.
An upstream password reset is not automatically a local session-revocation event
without a supported feed. Do not promise such detection.

### UI and verification boundary

Login renders enabled provider choices plus clearly labelled native login. Account
settings lists linked identities by provider and display attributes (not secrets),
provides link/unlink actions and explains freshness/recovery refusal. Manager
enrollment/recovery UI selects a User and provider explicitly. Keep the existing
visual language and accessibility labels; no new visual exploration is necessary.
Carry exact safe Tasker return state through hosted login just as native login does.

Use real PostgreSQL sandbox tests and a loopback standards-conforming synthetic
OIDC issuer for deterministic code exchange/JWKS/signature tests; it is test tooling,
not a runtime URL override. Tests must reject synthetic issuer configuration in
normal runtime. Real Google/Microsoft account configuration and live verification
remain operator work and must not be claimed by local proof. No real credentials.

## Risks / Trade-offs

- Google-only freshness unavailable → normal login still works; sensitive linking
  refuses clearly. Do not offer a misleading guaranteed reauth button.
- Broad auth blast radius → independently verify the final diff and actual browser
  flows; add shared baseline-to-new behavior tests before changing expectations.
- Long-lived sockets and multiple API processes → resolve session generations at
  subscription/delivery, not only at WebSocket connection or local cache invalidation.
- Operator recovery can grant account access → exact-target approval, independent
  claimant check, fresh operator proof and audit; explicitly trust this authority.
- Upstream employment changes are unobserved without a feed → document local
  disable as the enforced boundary; integration freshness is not invented here.
- Disabled provider can strand users → authorized disable still takes effect;
  recovery/enrollment of another supported method is the deliberate escape route.
- Revocation racing new issuance → locking plus generations; use a committed
  disposable two-connection test, not only sandbox sequential assertions.

## Migration Plan

1. Keep the already committed behavior-neutral baseline separate.
2. Add protected identity/session/operation storage, metadata for optional email
   and explicit native eligibility, indexes, ownership constraints, generation
   triggers and generic-API access guards. Update raw-table reservations and SQL
   qualification, and prove fresh install plus upgrade from the baseline commit.
3. Convert existing Google client configuration to its provider record without
   inventing subject links. Mark all legacy Users as already enrolled; remove the
   old email-provisioning and single-social-provider configuration/metadata once
   replaced. Existing Administrator native login remains available for recovery.
4. Introduce session IDs for every issuance path, including test fixtures and
   gated development previews. Do not let a default trusted issuance helper
   manufacture a source-reauthentication proof. Legacy JWTs require login again.
5. Implement foundation/Google first, Microsoft next, closed StyleHR gate last;
   all use the same ownership/session pipeline. Do not ship intermediate email
   linking as a compatibility bridge.
6. Verify and independently review before preparing a PR. No deployment/migration
   against shared data is authorized. A rollback to old code would restore weaker
   auth semantics and is not a security-preserving rollback; use forward fixes.
