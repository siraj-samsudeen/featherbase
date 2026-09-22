# Authentication

## Purpose

Characterize the password, Google and session boundaries present on 2026-09-22
before replacing email-based identity resolution under #244 and #275. These
observations are not approval of email linking or non-revocable sessions.

## Domain assumptions

- Google owns its hosted authorization, token and UserInfo endpoints. Established
  from the implementation and Google OIDC documentation on 2026-09-22. Endpoint
  failure is detected during exchange; provider account lifecycle is not locally
  monitored. The development mock is not evidence of real-provider verification.

## Requirements

### Requirement: password_authentication_baseline
Status: characterized (#244)

Password login SHALL accept an enabled human User by row ID or email with a
matching local password hash, and SHALL reject incorrect credentials. A successful
login SHALL return a session token and the User identity.

#### Scenario: native_login_accepts_email_but_rejects_wrong_password
- **WHEN** Administrator signs in by email with its password, then by row ID with
  an incorrect password
- **THEN** the first request succeeds and the second returns authentication failure

### Requirement: google_identity_resolution_baseline
Status: characterized (#244)

Google login SHALL resolve an existing User by case-insensitive email or row ID,
without a stored Google subject. Unknown emails SHALL be provisioned only when
their domain is admitted by configuration; an empty allowlist admits none and
`*` admits any valid email domain. Existing Users SHALL bypass this provisioning
allowlist. Disabled and service Users SHALL remain unable to sign in.

#### Scenario: existing_google_email_ignores_provisioning_allowlist
- **WHEN** an existing enabled human authenticates with its email and the
  provisioning allowlist is empty
- **THEN** login succeeds without creating another User

### Requirement: google_browser_challenge_baseline
Status: characterized (#244)

Google login SHALL use a hosted authorization redirect with S256 PKCE when a
client ID is configured. A callback SHALL require a signed unexpired state
matching this browser's state cookie. Without a client ID, mock authentication
SHALL require explicit `ALLOW_MOCK_OAUTH=1`; missing configuration alone SHALL
NOT enable it.

#### Scenario: google_callback_refuses_another_browser
- **WHEN** a callback has missing or mismatched browser state cookies
- **THEN** it is refused before creating a session

### Requirement: oauth_session_handoff_baseline
Status: characterized (#244)

The OAuth callback SHALL put a one-use, one-minute handoff code, not the session
token, in the browser redirect. Redemption SHALL require the matching session
cookie; reuse, an unknown code or a different browser SHALL fail.

#### Scenario: oauth_handoff_cannot_be_redeemed_twice
- **WHEN** the same handoff code is redeemed twice with its matching cookie
- **THEN** only the first redemption succeeds

### Requirement: session_validity_baseline
Status: characterized (#244)

Session tokens SHALL be signed JWTs carrying the User ID and expiry. Every token
resolution SHALL require a currently enabled User. Logout SHALL clear the browser
cookie but SHALL NOT revoke a copied token. Disabling and then re-enabling the
User SHALL allow an otherwise unexpired copied token again. Session expiry SHALL
default to eight hours for missing, invalid or zero configuration; otherwise the
configured hours SHALL be clamped between one and 720 hours.

#### Scenario: copied_session_survives_logout_but_not_user_disable
- **WHEN** a valid token is copied, the browser logs out, and the User is disabled
  then re-enabled
- **THEN** the token works after logout, fails while disabled, and works again
  after re-enabling

#### Scenario: zero_session_hours_defaults_instead_of_clamping
- **WHEN** session hours is configured as zero, negative two or 900
- **THEN** both password login and passwordless issuance use eight, one or 720
  hours respectively
