# External identities

## Purpose

Let different people use different providers and let one person explicitly prove
multiple identities, without joining accounts by mutable attributes or bypassing
whole-User offboarding.

## Domain assumptions

- Google documents stable non-reused `sub`; Microsoft documents issuer-scoped,
  application-specific `sub` and mutable email. Established from their OIDC/claim
  documentation on 2026-09-22. Detectors: issuer/audience/subject validation and
  provider contract tests; these cannot prove future vendor non-reassignment.
- Google does not support requests to reauthenticate a Google Account. Its
  Security Bundle documents optional signed `auth_time` for published, verified
  applications with session-age claims enabled (read 2026-09-22; document updated
  2026-06-15). Detector: missing/stale `auth_time` refuses sensitive source proof;
  ordinary login is not refused for this reason.
- StyleHR's canonical authentication subject and success schema are unconfirmed
  as of 2026-09-22. Detector: activation is refused until authoritative sanitized
  evidence and a separately reviewed contract change are available.
- An operator or future eligibility feed supplies the employment decision.
  Featherbase enforces it when User disable commits, not at an unobserved upstream
  employment event. Established by owner decision on 2026-09-22. Detector: audit
  of disable operations; no automatic upstream employment monitor in this slice.

## Requirements

### Requirement: external_identity_ownership_is_subject_based
Status: governed

An External Identity SHALL identify exactly one User by configured provider
namespace, validated issuer and case-sensitive subject. Email, verified-email,
name and domain SHALL NOT assign or change ownership. Users SHALL support absent
email and several identities from the same or different providers. Identity
attribute changes SHALL NOT change the User ID, roles, Tasker assignments or
history. Subject change SHALL be a new identity requiring explicit enrollment
or linking, never an automatic repair. Login SHALL NOT create roles/app grants.

#### Scenario: heterogeneous_people_do_not_need_a_common_provider
- **WHEN** separate enrolled Google and Microsoft Users authenticate
- **THEN** each receives its own User and existing Tasker permissions regardless
  of the other's provider or matching display attributes

#### Scenario: changed_email_preserves_subject_but_changed_subject_does_not
- **WHEN** an established subject returns a new email, and an unknown subject
  later returns the established subject's old email
- **THEN** the first resolves the original User and the second cannot access it

### Requirement: external_enrollment_requires_explicit_authority
Status: governed

Unknown external subjects SHALL NOT automatically provision or attach to Users.
A System Manager with recent reauthentication SHALL issue a one-use enrollment
invitation for a specific newly provisioned, never-enrolled enabled human User
and provider, expiring after fifteen minutes. Possession of the invitation plus
fresh provider proof SHALL authorize that first binding only, with no implicit
privilege grant. It SHALL NOT authorize recovery of a legacy User. Existing ownership
by another User SHALL refuse atomically without naming that User to the enrollee.
Legacy Google-only Users SHALL follow controlled recovery or prove an already
enabled method; matching legacy email SHALL NOT substitute for proof.

#### Scenario: invitation_cannot_be_retargeted_or_replayed
- **WHEN** an invitation for User A and Google is submitted for User B, Microsoft,
  after expiry, or after successful consumption
- **THEN** no binding or session is created

#### Scenario: legacy_email_is_not_a_reenrollment_credential
- **WHEN** an unbound Google subject supplies a legacy User's verified email
  without an invitation or authenticated linking operation
- **THEN** login refuses and the legacy User remains unchanged

### Requirement: identity_linking_requires_two_bound_proofs
Status: governed

Linking SHALL first require fresh reauthentication through an already enabled
method belonging to the current User, then fresh target-identity proof for that
one linking operation. Reauthentication SHALL be no older than five minutes at
completion, measured from the actual source authentication time, not token issue
or callback time. Google source proof SHALL require a signed numeric `auth_time`
within that window and not in the future; missing/stale claims SHALL refuse the
sensitive operation without blocking ordinary login. Consent or account selection
SHALL NOT substitute for authentication freshness. Fresh target proof SHALL mean
a new browser-bound provider operation begun after source verification, not
necessarily recent underlying target-provider authentication. The operation SHALL bind the current
session, User, source method and target provider and be single-use. Two concurrent
attempts to bind one identity to different Users SHALL permit at most one owner.
Two distinct Google subjects MAY link to the same User after independent proofs.

#### Scenario: one_person_links_two_google_work_accounts
- **WHEN** a User reauthenticates its linked Google subject A and proves a distinct
  Google subject B for the resulting operation
- **THEN** both identities resolve that same User and retain its Tasker history

#### Scenario: one_person_uses_three_google_identities_for_the_same_tasker_work
- **WHEN** one preprovisioned User enrolls a personal Google identity and explicitly
  links two separately proved Workspace identities through fresh source evidence
  or the controlled exact-target recovery process
- **THEN** all three distinct issuer/subject identities resolve that one User,
  the same Tasker rows, roles and preferences on independent subsequent logins
- **AND** a subject already owned elsewhere refuses atomically without merging,
  User disable blocks all three logins and sessions, and unlink cannot remove
  the last available method without a verified replacement
- **AND** missing recent-authentication evidence refuses self-service linking
  while leaving the controlled recovery path available

#### Scenario: attacker_cannot_link_through_a_stale_or_different_session
- **WHEN** a target proof arrives after the source proof expires, the source
  session is revoked, or from another browser/session
- **THEN** the binding fails even if the target subject is genuinely authenticated

#### Scenario: fresh_token_issue_does_not_refresh_google_authentication_age
- **WHEN** Google returns a fresh signed token with absent or old `auth_time`
- **THEN** ordinary login can succeed but it cannot authorize identity linking
- **AND** a previously accepted source proof expiring before target completion
  refuses the link rather than starting a new five-minute window at callback

#### Scenario: concurrent_subject_claims_never_reassign_ownership
- **WHEN** two separately reauthenticated Users simultaneously prove the same
  unbound external subject
- **THEN** at most one binding commits and the other fails without moving ownership

### Requirement: identity_unlink_and_recovery_preserve_account_control
Status: governed

Unlinking SHALL require recent reauthentication of the current User, revoke the
removed method's sessions and pending operations, and preserve ownership history.
Unlink and operator recovery SHALL use the same freshness boundary as linking:
actual source authentication no older than five minutes at mutation completion,
never token issue/callback time; Google requires signed numeric `auth_time` and
refuses missing, stale, malformed or future evidence for the sensitive action
without refusing ordinary login solely for that reason.
An identity previously owned by another User SHALL NOT become claimable through
ordinary linking after unlink. Removing the last available method SHALL be refused
until a replacement has been verified. Operator recovery SHALL require recent
operator reauthentication and approval bound to the exact destination User,
provider namespace, issuer and subject after that target has completed fresh
proof. Completion SHALL enforce that same binding. Approval SHALL record the
operator's independent claimant-verification method and case reference. A recovery
invitation alone SHALL NOT bind an arbitrary subject. Completion SHALL revoke old
sessions/operations and authorize that one binding only, not grant reusable
reauthentication authority. Email matching alone SHALL NOT recover an account.
Recovery SHALL NOT re-enable a disabled User. The operator is a trusted recovery
authority; this contract does not defend against a deliberately malicious operator.

#### Scenario: unlink_does_not_transfer_an_identity_or_remove_last_method
- **WHEN** a User attempts to remove its last method, or a different User attempts
  to claim an identity previously unlinked from its owner
- **THEN** the operation refuses without changing account ownership

#### Scenario: recovery_invitation_does_not_approve_an_attackers_chosen_subject
- **WHEN** a holder of a recovery invitation proves an attacker-controlled subject
  without a recently reauthenticated operator approving that exact binding, or
  substitutes a different destination User after approval
- **THEN** no recovery binding or session is created

#### Scenario: unlink_and_recovery_reject_stale_operator_or_user_authentication
- **WHEN** unlink or recovery approval presents a newly issued Google token with
  absent, stale, malformed or future signed authentication time
- **THEN** the sensitive mutation refuses without changing links or eligibility
- **AND** an otherwise valid ordinary login is not refused for that reason

### Requirement: provider_configuration_is_an_authentication_boundary
Status: governed

Only configured enabled providers SHALL be offered for login. Unsupported or
incomplete provider configurations SHALL fail closed. A disabled provider SHALL
refuse initiation, callback, enrollment, reauthentication and linking, including
operations begun before disablement. Changing issuer/client identity SHALL NOT
reinterpret existing subjects or revive sessions. Development-only authentication
SHALL require explicit opt-in and SHALL use an isolated identity namespace that
cannot create or satisfy a real provider link.

#### Scenario: disabling_provider_during_consent_refuses_callback
- **WHEN** an enabled provider starts consent and is disabled before callback
- **THEN** callback creates no session or identity link

#### Scenario: development_proof_cannot_claim_real_google_identity
- **WHEN** a development provider proves a subject equal to a stored Google subject
- **THEN** it cannot authenticate as or reauthenticate that Google identity

### Requirement: stylehr_activation_is_closed_without_a_confirmed_contract
Status: governed

This release SHALL keep StyleHR authentication unavailable until an authoritative
sanitized success schema, one durable non-reassigned subject/rehire namespace and
inactive-account semantics are confirmed through a separately reviewed contract
change. It SHALL NOT collect or persist a StyleHR password or password verifier
while gated. No encrypted-password, hashed-password or last-success fallback SHALL
exist. Future activated StyleHR authentication SHALL verify online for each new
login or required reauthentication and persist only a revocable Featherbase session.

#### Scenario: stylehr_gate_precedes_credential_processing
- **WHEN** a caller attempts StyleHR login or enables an unconfirmed StyleHR provider
- **THEN** authentication remains unavailable, no credential check or upstream
  request occurs, and no identity, session or password verifier is stored
