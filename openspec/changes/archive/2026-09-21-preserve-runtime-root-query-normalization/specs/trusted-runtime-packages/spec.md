## MODIFIED Requirements

### Requirement: featherbase_human_routes_are_canonical
Legacy ID: PKG-R6 · `shape: routing contract`
Status: governed (#296)
Featherbase-owned human routes SHALL live under `/featherbase/`. Historical human
deep links SHALL redirect to their corresponding canonical path while preserving
query and fragment. Technical and direct runtime-app roots SHALL retain their
owners. Signed-out runtime-app navigation SHALL pass through canonical Featherbase
sign-in and return to the exact safe local app path, query, and browser fragment.
Login return destinations SHALL reject external, ambiguous, technical, legacy, or
malformed paths rather than navigate to them.

#### Scenario: old_and_new_deep_links_converge
- **WHEN** a caller opens equivalent `/admin/...` and `/featherbase/admin/...`
  deep links
- **THEN** the old URL redirects and both arrive at the same canonical screen with
  search and fragment state intact.

#### Scenario: signed_out_tasker_returns_to_tasker
- **WHEN** a signed-out caller opens `/tasker/` and completes sign-in
- **THEN** the browser returns to `/tasker/`, not the Featherbase home page.

#### Scenario: runtime_app_root_normalization_preserves_query
- **WHEN** a caller opens an unslashed runtime-app root with encoded query state
- **THEN** its canonical trailing-slash redirect preserves that query exactly
  before any authentication redirect occurs.

#### Scenario: exact_runtime_app_location_survives_sign_in
- **WHEN** a signed-out caller opens a nested direct runtime-app path with encoded
  query state and a fragment selecting app work, then completes sign-in
- **THEN** canonical Featherbase login returns the browser to that exact safe path,
  query, and fragment so the selected work is open.

#### Scenario: unsafe_login_return_is_refused
- **WHEN** a login return destination is external, ambiguous, technical, legacy,
  non-canonical, or malformed
- **THEN** Featherbase ignores it and uses the signed-in member's normal landing
  page without navigating to the supplied destination.
