## Why

Tasker and Feather Dash already share Featherbase's top bar, but their navigation feels like different products. The owner approved one app-focused sidebar and the existing app-name dropdown, without a separate administration button (#759).

## What Changes

- Reuse the existing application dropdown on app pages; offer only destinations the user can open.
- Replace Tasker's navy sidebar with shared platform navigation styling, preserving its views, counts and project links.
- Give Feather Dash the same sidebar with its report destination; keep store selection in the top bar.
- Keep app documents, content, navigation state and server access rules app-owned.
- **BREAKING:** replace the earlier app-page rule that forbids an application dropdown. Remove the redundant administration button on those pages.

## Capabilities

### New Capabilities

- `app-navigation`: consistent app-focused navigation and an access-filtered application dropdown.

### Modified Capabilities

- `trusted-runtime-packages`: retain app document ownership without promising a competing, app-designed host shell.

## Impact

Shared TopBar and the existing AdminLayout selector; the app-page bar bundle; Tasker and Feather Dash navigation markup/styles and package versions. No installation, discovery, app-management, server authorization or canonical destination-label changes. #758 owns those areas. The existing active `feather-dash-installed-app` delta's no-switcher rule must be reconciled before archive.
