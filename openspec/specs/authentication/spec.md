# Authentication

## Purpose

Define native and provider-hosted authentication, browser-bound login operations,
and revocable sessions without treating mutable email as account ownership.

## Domain assumptions

- Google and Microsoft own their hosted authorization and token endpoints.
  Established from their OIDC documentation on 2026-09-22. Endpoint
  failure is detected during exchange; provider account lifecycle is not locally
  monitored. Synthetic protocol proof is not evidence of live-provider setup.

## Requirements

### Requirement: native_login_requires_an_enabled_native_method
Status: governed

Native password login SHALL require an enabled human User with an enabled native
method and a matching password. It SHALL accept row ID or nonempty email and
return a revocable session. External-only Users SHALL NOT acquire native login
through password reset or ordinary password assignment. Reset requests SHALL
remain enumeration-resistant. A native password change SHALL revoke existing
sessions and outstanding authentication operations for that User.

#### Scenario: native_reset_does_not_create_external_account_fallback
- **WHEN** reset is requested for an external-only User with a contact email
- **THEN** the public response is indistinguishable from other reset requests,
  no reset credential is issued and no native login method is created

#### Scenario: native_password_change_revokes_copied_sessions
- **WHEN** a native User changes a valid password
- **THEN** copied old sessions fail and the new password can create a new session

### Requirement: hosted_login_validates_subject_and_browser_operation
Status: governed

Google and Microsoft authentication SHALL remain provider-hosted authorization
code flows. Featherbase SHALL NOT accept their passwords. Every completion SHALL
validate the configured provider, signature, issuer, audience, expiry, nonce,
PKCE and browser-bound state. The operation SHALL be single-use, expire after ten
minutes, and bind its purpose, provider configuration and safe return destination.
Failed validation SHALL create no identity or session. Only minimum login claims
SHALL persist; provider access/refresh tokens SHALL NOT persist for login-only use.

#### Scenario: hosted_callback_rejects_cross_provider_and_replayed_proof
- **WHEN** a Google operation receives a Microsoft proof, a wrong issuer/audience
  or nonce, a missing browser cookie, an expired operation or a reused code
- **THEN** completion fails without creating a session or changing identity ownership

#### Scenario: personal_and_organizational_accounts_use_hosted_pages
- **WHEN** enrolled Gmail, Workspace, Microsoft work/school and personal Microsoft
  Users choose their configured provider
- **THEN** each authenticates on the provider's page and returns to its own User
  without a Featherbase password prompt for that provider

### Requirement: login_sessions_are_revocable_on_every_use
Status: governed

A Login Session SHALL require a live server-side record, an unexpired credential,
an enabled human User and an available originating login method on every use.
Its lifetime SHALL default to eight hours for missing, invalid or zero session
hours and otherwise clamp to one through 720 hours. Logout
SHALL revoke the presented session and clear the cookie. User disable SHALL
permanently revoke all of that User's sessions and pending authentication
operations; re-enable SHALL NOT revive them. Provider disable and identity unlink
SHALL revoke sessions and operations depending on that method. HTTP requests and
WebSocket subscriptions/deliveries SHALL enforce the same validity boundary.
Operations already authorized before revocation need not roll back completed work.

#### Scenario: whole_user_offboarding_blocks_every_linked_method
- **WHEN** an employee User with Google and Microsoft sessions is disabled
- **THEN** both copied session credentials fail, new logins fail, pending links
  fail, and established sockets deliver no newly authorized events
- **AND** re-enabling the User requires new authentication for either provider

#### Scenario: provider_revocation_does_not_disable_an_independent_method
- **WHEN** Google's provider is disabled for a User with separate Google and
  Microsoft sessions
- **THEN** Google sessions and pending operations fail, the Microsoft session
  remains valid, and re-enabling Google does not revive its old sessions

### Requirement: session_handoff_is_bound_one_use_and_revocation_aware
Status: governed

The hosted callback SHALL set a secure HttpOnly SameSite cookie and redirect with
a browser-bound handoff code rather than a session credential. Handoff redemption
SHALL be a one-use POST within one minute and SHALL validate the session's current
eligibility. Cookies SHALL be Secure on HTTPS. Credentials SHALL NOT be accepted
from URL query parameters. Successful login SHALL preserve the existing validated
application return destination or use normal server-controlled landing.

#### Scenario: revoked_session_cannot_be_recovered_through_handoff
- **WHEN** a callback creates a handoff and the User is disabled before redemption
- **THEN** redemption fails even with the original browser cookie

#### Scenario: tasker_return_survives_a_hosted_login
- **WHEN** a signed-out User follows a Tasker link with encoded query and fragment
  and completes a hosted login
- **THEN** the same safe Tasker destination opens without widening redirect targets

### Requirement: authentication_admission_and_audit_do_not_expose_secrets
Status: governed

Login, enrollment, reauthentication, callback, linking and recovery SHALL use
shared cross-process rate limits before expensive work or credential exchange.
Credential attempts SHALL use provider-separated source and account budgets;
untrusted forwarding headers SHALL NOT choose the source. Anonymous account
refusals SHALL not distinguish unknown, disabled or already-owned identities.
Provider outage SHALL produce an unavailable result rather than wrong-password
or a local fallback. Audit SHALL record operation, outcome and internal actor/
provider identifiers without passwords, hashes, tokens, codes or raw responses.
Error responses and application logs SHALL obey the same redaction boundary.

#### Scenario: provider_exceptions_cannot_escape_into_logs
- **WHEN** an upstream error body or exception includes sentinel password, token
  and code values
- **THEN** none appear in the HTTP response, application logs or audit, and the
  safe operation outcome remains observable

#### Scenario: rate_limits_precede_provider_calls
- **WHEN** attempts exhaust the shared budget and a second process retries
- **THEN** it receives a bounded retry response without contacting the provider
