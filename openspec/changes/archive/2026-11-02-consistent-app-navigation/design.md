## Context

The owner approved option A and the revised dropdown mockup in this thread. The shared bar already renders in a shadow root. Tasker's navigation buttons own React state, live counts and project callbacks; replacing those with a new platform data service would duplicate app logic. Feather Dash already consumes store changes from the shared bar.

## Goals / Non-Goals

Goals: one selector implementation, one reusable app sidebar presentation, unchanged app work and access rules. The issue checklist carries the approved layout.

Non-goals: installation/discovery (#758), full platform menus inside apps, phone redesign, app content restyling, new navigation data services, or widening access.

## Decisions

### Reuse the existing selector instead of adding a second switcher

Extract the native Select currently supplied by AdminLayout so TopBar can also use it on app pages. Keep the existing server-filtered app catalog and capabilities as its sources. Selecting Featherbase from an app must retain the existing cross-address sign-in handoff; do not replace it with a guessed local address. Do not show a separate administration button or sidebar link where the dropdown is present.

Rejected: a new rich menu, an extra administration button, and full platform navigation alongside app navigation. Those differ from the approved mockup or duplicate the destination choice.

### Share sidebar presentation without taking app state into the platform

The existing app-page bundle will register a `featherbase-sidebar` element. Apps supply ordinary navigation buttons or links as its light-DOM children; the platform supplies the shadow-root navigation frame, neutral row presentation, selected/focus states and theme. Nested project buttons carry a depth marker. App event handlers, counts and data remain in the app; no app-specific platform imports or app code in the top bar.

The sidebar follows the bar's painted theme without painting the app's document. App styles retain only content-specific icon/count layout and responsive content placement; remove Tasker's old navy navigation styling rather than overriding it.

Rejected: copying sidebar CSS into each app (would drift again), moving app logic into the platform (breaks one-way knowledge), or mounting app documents in the platform SPA (takes away document ownership). This extends the existing shadow-root presentation pattern rather than introducing a new app state boundary.

## Risks / Trade-offs

- App-owned controls need a shared presentation contract → document the element and depth marker here, test navigation through the actual apps, and keep the platform ignorant of app names.
- Package fingerprints include changed clients → bump both app patch versions, declare no-op upgrade steps and use the existing development repin command for the disposable verification database.
- The active Feather Dash proposal previously forbade a switcher → this change now owns its runtime-screen replacement block; remove that overlapping block from the older active delta. Sync this change's screen ownership and app navigation together before the older change is archived; retain all unrelated requirements.
- Report data depends on the calendar → verify the report's actual state without inventing figures or weakening the seed's expectations.

## Migration Plan

Ship the sidebar definition with the existing bar bundle and rebuild both apps. Keep the server's document composition and access gates unchanged. Local rollback restores the platform bundle and the corresponding app versions together. No database data transformation is required.

## Open Questions

None for the approved UI. The canonical Featherbase label remains owned by #758; this change consumes that shared label rather than adding a local alias.
