## Why

Different people must use Featherbase and Tasker through different identity
providers, and one person must be able to prove and link multiple identities.
Email-based Google linking and non-revocable sessions cannot safely support
that coexistence or the owner's whole-User offboarding decision (#244, #275).

## What Changes

- Add stable External Identity ownership and provider-neutral Login Sessions.
  Several Google identities, or Google and Microsoft identities, can belong to
  one User without merging people by email, name or domain.
- Add explicit enrollment, recent reauthentication, link and unlink operations;
  use controlled reenrollment for existing email-only Google Users.
- Support hosted Google and Microsoft authorization-code login; expose only
  configured enabled providers. Keep native password login a distinct method.
- **BREAKING:** remove email auto-linking and domain-based automatic enrollment.
  New external identities require operator-issued enrollment or authenticated
  explicit linking. Existing Google-only Users require controlled reenrollment.
- **BREAKING:** reject legacy stateless session tokens. Logout, User disable,
  provider disable and unlink revoke the relevant server-side sessions. Re-enable
  cannot resurrect them. Established WebSockets must also enforce revocation.
- Permit external-only Users without email or a local password. Password reset
  cannot create a local fallback for such Users.
- Whole-User disable is the employment-offboarding operation; it affects every
  provider and all sessions. No partial employment-grant revocation in this slice.
- Never persist a StyleHR password or verifier. Keep StyleHR activation closed
  until its authoritative success schema and durable subject contract are known.
  The shared foundation and hosted flows do not wait for that external evidence.
- Preserve existing server-controlled application landing and exact safe Tasker
  return paths. Login methods do not assign roles or app grants.

## Capabilities

### New Capabilities

- `external-identities`: provider configuration, stable identity ownership,
  explicit enrollment/linking/recovery, coexistence and StyleHR activation gate.

### Modified Capabilities

- `authentication`: replace email resolution, browser challenges, session
  validity and handoff semantics with hosted subject verification and durable
  revocation; retain native password login with external-only account protection.

## Impact

Server authentication/OAuth routes, auth and password-reset services, User
metadata, migrations, database-backed pre-auth limits, audit and error handling,
and WebSocket delivery. Browser login, callback and account-method settings use
the existing design system. Add a maintained OIDC implementation rather than
implementing signature/discovery validation from scratch. Preserve the current
cookie/Bearer transport while changing session validity to database state.

The StyleHR upstream, deployment, external provisioning feeds, package publication
and real user credentials are outside this implementation. Private upstream
source details do not belong in public planning artifacts.
