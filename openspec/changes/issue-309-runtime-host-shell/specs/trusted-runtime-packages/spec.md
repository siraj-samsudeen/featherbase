## MODIFIED Requirements

### Requirement: app_owns_client_root
Legacy IDs: PKG-R4, PKG-J1 · `shape: contract`
Status: governed (#309)

An app SHALL own its direct root, document content, React tree, inner navigation,
and CSS. Featherbase core SHALL serve only the declared contained client build,
SHALL reserve platform and technical roots, and SHALL NOT substitute either
application's HTML for a missing asset. A navigation request for an app-owned
deep link SHALL retain the exact path, query, and fragment across sign-in and
refresh while loading that app's declared client entry.

Featherbase SHALL own runtime presentation around that client. An absent
`presentation` manifest declaration SHALL render the client inside the responsive
host shell on desktop and touch/mobile. The only non-default declaration SHALL be
`presentation: "fullscreen"`, which SHALL render the client without host chrome;
unknown values SHALL reject the artifact rather than infer presentation from its
client root, document, or CSS.

The runtime host shell SHALL keep a persistent Featherbase Home icon immediately
followed by one keyboard-operable app switcher. The switcher SHALL contain
Featherbase Home and every active installed app the current member is authorized
to open, SHALL identify the current destination, SHALL refresh after the document
regains focus or visibility so access changes are reflected without a page reload,
and SHALL omit unauthorized, disabled, unavailable, pending, and unversioned apps.
The Home destination SHALL be the single responsive route to the ordinary
Featherbase host controls; neither the shell nor an app SHALL create a second app
list. Shell controls SHALL have accessible names, visible keyboard focus, and a
usable touch target without obscuring or replacing app-owned content.

Opening an app while signed out SHALL return to that exact app location after
sign-in. An app with its own client SHALL NOT also create a competing generated
Home Page; its Tables remain available to administrators. Disabled or missing app
navigation SHALL explain unavailability and preserved data without exposing
manager-only controls.

#### Scenario: default_runtime_uses_host_shell
- **WHEN** an authorized member opens a runtime app whose manifest omits `presentation` on desktop or coarse-pointer mobile
- **THEN** the host Home icon and unified app switcher remain available while the app's own navigation and content render unchanged below them

#### Scenario: explicit_fullscreen_omits_host_shell
- **WHEN** an authorized member opens a runtime app declaring `presentation: "fullscreen"`
- **THEN** the app owns the full stage and Featherbase does not inject host-shell controls

#### Scenario: unknown_runtime_presentation_is_rejected
- **WHEN** discovery reads a runtime manifest with any presentation value other than `fullscreen`
- **THEN** the artifact is unavailable and no presentation is inferred from its client files or styles

#### Scenario: runtime_switcher_tracks_authorized_catalog
- **WHEN** the current member opens the switcher and app access is then granted, revoked, disabled, made unavailable, or restored before the document regains focus or visibility
- **THEN** its next refreshed options contain Featherbase Home plus exactly the active authorized installed apps, with no separate runtime-app list

#### Scenario: runtime_shell_keyboard_and_touch_access
- **WHEN** a member uses Tab and arrow/selection keys on desktop or a coarse-pointer mobile viewport
- **THEN** the Home icon and switcher have accessible names, visible focus and usable targets, selection navigates to the exact destination, and app-owned controls remain operable

#### Scenario: runtime_home_restores_host_controls
- **WHEN** a member activates the shell Home icon or chooses Featherbase Home in the switcher
- **THEN** the ordinary responsive Featherbase shell is reached with its navigation, command, account, appearance, language, notification, and administration controls governed by the member's existing permissions

#### Scenario: tasker_opens_without_core_import
- **WHEN** built Tasker is staged after Featherbase core was built
- **THEN** `/tasker/` opens inside the default host shell without a core rebuild or Tasker-specific core route

#### Scenario: app_deep_link_survives_login_and_refresh
- **WHEN** a signed-out member opens an authorized nested runtime-app path with encoded query state and a fragment, signs in, and refreshes
- **THEN** the browser retains that exact app location and loads the same app-owned content inside its declared presentation

#### Scenario: missing_asset_is_not_html
- **WHEN** a caller requests an undeclared runtime-app JavaScript, stylesheet, image, or font asset
- **THEN** the response is not found rather than either application's index page

#### Scenario: app_login_returns_to_one_launch
- **WHEN** a signed-out member opens an accessible application
- **THEN** sign-in returns to its client root and normal navigation has no competing generated Table page
