## ADDED Requirements

### Requirement: core_runtime_client_pins_active_identity
Status: governed (#296)

The generic Featherbase client SHALL resolve runtime application identities from an authenticated host snapshot before loading metadata or application data. The host SHALL derive the snapshot from installed, enabled, activated packages with a known version, excluding unavailable, pending and unversioned packages. The client SHALL pin this snapshot for its signed-in page session and send the same identities for reads, writes, form operations and attachment API operations. Refetch, navigation and a version conflict SHALL NOT silently replace the snapshot. Reload or a new authenticated session MAY resolve a new snapshot. Host permission and availability checks SHALL remain authoritative.

#### Scenario: core_form_and_attachment_after_upgrade
- **WHEN** an Administrator opens a generic form after a package's v1→v2 upgrade and activation
- **THEN** the form reads and saves the row and uploads/lists/removes attachments using the activated package identity without app-specific core code

#### Scenario: stale_generic_form_is_not_relabelled
- **WHEN** a generic form loaded under v1 attempts a read, save or upload after v2 commits or activates
- **THEN** access rejects while pending or obsolete and the client does not retry with v2 identity

#### Scenario: identity_bootstrap_fails_closed
- **WHEN** a package is disabled, pending activation, unavailable or missing its installed version
- **THEN** bootstrap does not advertise that package as active and a caller cannot gain data access by submitting a claimed identity

#### Scenario: indirect_requests_pin_each_app
- **WHEN** a generic operation accesses references or attachments belonging to multiple runtime apps
- **THEN** each app is checked against its own pinned identity, and malformed or duplicate identities are rejected rather than selecting a caller-preferred match

#### Scenario: parallel_requests_share_session_snapshot
- **WHEN** a signed-in page begins multiple metadata/data requests concurrently
- **THEN** they use one resolved snapshot until reload or a new login, while a new login cannot inherit the previous session's snapshot

#### Scenario: public_exchange_ignores_expired_saved_token
- **WHEN** a browser with an expired saved bearer redeems a valid OAuth handoff, resets a password, signs out or uses a public form
- **THEN** the public request reaches its existing host contract without requiring an authenticated identity snapshot first
- **AND** subsequent authenticated data operations still require the pinned snapshot and normal admission
