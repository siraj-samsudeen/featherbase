## Context

The name reaches people from three places: the manifest's `title` (the switcher, the name on the app's address, `/api/brand`), `INTERIM_APPS` (the bar's name before the app is installed), and System Settings' `app_name` (the instance's name on sign-in and in emails).

## Decisions

### Rename the roles and each Table's `module`, for fresh installs only

The owner chose this on 05-Nov-2026 because production is being wiped and installed fresh, and later it would be much harder. It breaks the upgrade path on purpose. An upgrade refuses a declaration that differs from the installed one replayed through its version steps, and refuses grants the installed version does not hold (`runtime-packages.ts`). No version step can rename a role or change a `module`. People's roles and grants also point at the role names.

### Rename the identifier to `dash`, and drop Dash's `previousVersions`

The owner chose this too, for the same reason. An upgrade cannot change an app's name, so `dash` is a new app to the platform. A deploy installs every app name its image holds, so the entries for 0.10.2 and 0.10.3 had to go. Their archives declare `feather_dash`, and a fresh database would have got both apps. Every earlier version step is empty, so no history was rewritten.

## Risks / Trade-offs

- `INSTANCE_ADDRESSES` entries that say `"opens": "feather_dash"` have to change where they are set.

- A deploy runs the upgrade, so on any instance that already has Dash installed this version fails the deploy and the old deployment keeps serving. That instance has to be wiped and installed fresh.
- This has to merge before production's fresh install. After that, the same rename would need new platform work.
