## Context

See `proposal.md`. Runtime packages are independent same-origin documents served by the server from a declared contained client directory. Their scripts mount into package-owned roots, while Admin chrome lives in a separate React tree. Importing package React into core would violate independent delivery; an iframe would split same-origin navigation, focus, accessibility and sizing; copying Admin chrome into packages would duplicate platform policy.

The server already authenticates runtime navigation, computes the authorization-filtered app catalog, distinguishes navigation from assets, and returns package HTML. That delivery boundary is the one place which owns both host composition and the current member's allowed destinations.

## Goals / Non-Goals

**Goals:**

- Compose one small reusable host header around independently built runtime clients without changing their mount point, script execution, CSS ownership, or URL.
- Keep catalog authorization as the single app-visibility fact and make shell navigation work with cookie-authenticated runtime documents.
- Preserve static-asset containment while treating extensionless HTML navigation as an app deep link.

**Non-Goals:**

- Recreate the full Admin sidebar or awesomebar inside a runtime document; Home is the responsive route back to those controls.
- Define a general package UI SDK, build-time React contribution system, iframe protocol, or cross-origin sandbox.
- Restyle Tasker's inner workspace beyond removing its now-duplicate top-level back link.

## Decisions

### Compose at authenticated runtime HTML delivery

The server transforms only the client entry HTML response by inserting an app-root base URL, a host-owned fixed header before the package body content, and host-owned style/behavior before the document closes. It leaves package scripts, the mount root and asset contents intact. Secondary HTML documents and every non-HTML asset pass through byte-for-byte.

This is preferred over a core React route because runtime clients remain installable after core is built and can use any browser framework. It is preferred over an iframe because the package already runs as trusted same-origin code and needs no second history, focus, viewport or authentication boundary. The injected shell is framework UI, not package code.

Extensionless authenticated HTML navigation falls back to the declared client entry after confirming app access; requests with an asset extension never do. The response establishes the direct app root as its base URL. Browser history therefore keeps the deep path while relative and root-relative package assets retain existing behavior.

### Keep the shell unconditional

Every packaged runtime application receives the compact shell. The manifest gains no presentation field and the server has no package-specific shell branch. This keeps one predictable route back to Featherbase and avoids making host continuity optional before an immersive use case and exit/re-entry design exist. Inferring presentation from markup or CSS was also rejected because it would make framework behavior implicit and unvalidated.

### Render the switcher from the existing authorized catalog

Initial shell markup is rendered from the same `appCatalog(user)` result used by Admin, plus one synthetic Featherbase Home option. The current app is selected. A small host script refetches `/api/app_catalog` on `focus` and when the document becomes visible, rebuilding only the options while preserving focus and the current selection. Selection performs ordinary top-level navigation to the option's exact `href`.

A native labelled select is preferred over a custom popup: it supplies keyboard traversal, coarse-pointer behavior, focus semantics and compact responsive layout without a new focus-management subsystem. The Home icon and select are the only app-navigation controls; Admin's existing sidebar runtime links are removed so the product does not maintain two app lists.

### Keep ordinary controls behind Featherbase Home

The persistent Home icon and the Home switcher option both navigate to `/featherbase/admin`, where existing responsive Admin controls remain permission-aware and complete. The compact runtime header does not duplicate the awesomebar, account menu, appearance/language selectors, notifications or administrative sidebar. This makes the route explicit while avoiding two divergent host shells.

The header reuses the visual identity's token values and feather mark as isolated host CSS/SVG. It uses a fixed 48px block plus body inset so app content is not obscured. Host selectors and custom properties are prefixed to avoid accidental package collisions.

## Risks / Trade-offs

- [Package CSS targets global `header`, `select`, or `body` selectors] → Use a uniquely prefixed shell root, strongly scoped declarations, inline host dimensions, and browser proof with Tasker's broad stylesheet.
- [A package assumes the viewport starts at y=0 or sets fixed full-height content] → Reserve shell space with a body inset and expose that inset as a host custom property for package-owned fixed overlays.
- [Access changes while a background tab never receives focus/visibility] → The server remains authoritative for every destination/API request; refresh on focus/visibility updates disclosure at the next user interaction boundary without polling.
- [HTML string transformation encounters unusual but valid documents] → Insert at case-insensitive closing `head`/`body` tags when present and prepend/append safely when absent; transform only the declared entry HTML, never scripts or assets.
- [Direct deep-link fallback masks a missing extensionless package resource] → Restrict fallback to browser HTML navigation; API-like or asset-extension requests retain not-found behavior.

## Migration Plan

Existing packages intentionally move to the consistent host shell without a manifest migration. Tasker removes only its duplicate platform back link and consumes the host inset for its fixed mobile detail surfaces. Rollback restores the prior runtime HTML response; there is no database state or data migration.
