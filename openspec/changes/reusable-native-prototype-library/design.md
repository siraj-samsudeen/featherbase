## Context

The existing gallery imports actual primitives and index.css, but is a narrow stacked page with no working component search. DataList already accepts React controls in cells. TabBar is phone navigation, not content tabs. AdminLayout/TopBar are actual shell owners; Explore.Pane is private and metadata-bound. FormView has API reads/writes and must not be copied or extracted solely for previewing.

## Goals / Non-Goals

**Goals:** searchable real examples, full-content section navigation, consistent breadcrumb/search placement, synthetic-state isolation, and a demonstrable same-screen transition.

**Non-goals:** a design system, general page builder, warehouse discovery/copy implementation, production form/picker/chrome redesign, global navigation/search retrofit, or security evidence from mock permissions.

## Decisions

### 1. Reuse the native shell and renderers

Mount examples beneath actual AdminLayout with the existing router/query/theme providers. Use existing ListView and FormView for metadata Tables, DataList for component/catalog/mapping examples. Add Breadcrumbs, SearchableList and ContentTabs only where the example needs missing reusable behavior. DataList cell renderers already support editable controls; no new grid is needed.

Rejected: a cloned shell or standalone HTML, which reproduces the owner's drift problem; extracting FormView's private controls, which conflicts with #795/#793/#800 and does not prove integration. A narrow content-width option may be required in AdminLayout, coordinated with #800; do not change its normal defaults.

### 2. Keep fixtures outside production behavior

Run a dedicated dev-only Vite configuration whose middleware answers known API contracts from synthetic state and refuses every unhandled API/file/websocket request. It has no live API proxy. A separate entry mounts native route components; synthetic identity and data remain on that preview's separate origin. Reset restores in-memory data. Scenario selection is preview control state, not production code.

Rejected: seeded query cache alone, because saves/refetches would escape; global fetch replacement, because it is bypassable and confuses real API evidence; enabling a mock flag in the production app. Production build inputs must exclude the lab entry and fixtures. The preview is a developer tool, not a sandbox for arbitrary hostile code.

### 3. Retain routes and context, not a second form

The starter uses actual metadata-backed Table/list/row/related-Table routes and preserves parent search/filter/tab context in its route state. Switching the launch configuration connects the same screen to the disposable real API. Shared breadcrumb/tab/collection components receive ordinary props; fixture records stay in a separate module.

Rejected: promoting #740's disposable interaction sketch or implementing parallel per-model forms. No dependency on unapproved #740-specific behavior. Once #795/#793/#800 land, native imports inherit those results and the lab evidence is rerun.

## Risks / Trade-offs

- Fixture contracts can drift → compare the same form's labels/control types and save/refetch behavior against the isolated real API; fail on unsupported requests instead of silently returning empty objects.
- Native shell reads several contracts → implement only the fixture responses required by its actual requests, with explicit refusals elsewhere, not a mock backend framework.
- Potentially long selectors/collections can evade search → inventory every exposed collection, including gallery, navigation, tabs' list content and mapping rows; demonstrate zero matches and return context.
- Shared-file overlap → coordinate the narrow shell sizing seam with #800; do not modify its actions, layout semantics, collaboration or permissions.

## Migration Plan

No database or deployment changes. Existing production defaults and build inputs stay unchanged. Remove the separate dev entry/config to roll back the preview. Persistent library work continues in this thread; finish this increment in one PR without merging or archiving the thread.

## Open Questions

The manager must review a rendered real-component key layout before consequential layout choices are finalized. Numbered UI checklist lives in #773. The fixture boundary needs ordinary review; no adversarial review is authorized. No in-force ADR is being changed: retain ADR 0006's stack, 0009's row identity, 0014's platform/app separation, 0015's immutable decisions and 0017's current backend coverage policy.
