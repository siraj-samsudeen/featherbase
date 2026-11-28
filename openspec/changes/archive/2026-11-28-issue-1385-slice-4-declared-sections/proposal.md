## Why

Siraj, #1385 slice 4: an app gives its sidebar rows as data, never markup, and the platform draws them beside its
own defaults, the same way the Admin's Modules and Data are drawn. No app may draw its own copy of a default piece.

## What Changes

- An app's manifest may declare `sidebar`: sections that never change, each with a title and rows (a label, an
  address, an icon and an optional count). One runtime call, `setSidebarRows` (`@featherbase/shop-floor/sidebar`),
  gives the rows that change, filling a declared section by its id or adding sections after them.
- The shared frame draws both in its links, above the platform's defaults. A section with an icon folds into that
  icon in the rail; a row asking for initials shows them there.
- Tasker, Tickets, Dash, Equipment and Forecasting give their rows as data; the Admin's Modules and Data are drawn by
  the same renderer. The light-DOM slot is removed.
- A guard in the web suite fails when an app puts markup in the sidebar or names a control after a default piece.
- The account pages show Recently Opened, as every other sidebar does for someone who can use the Admin.

## Impact

`packages/shared/src/app-sidebar.ts`, `packages/shop-floor/src/sidebar.ts`, `runtime-packages.ts` (manifest,
catalog), `SidebarSections.tsx`, `AppSidebarSections.tsx`, `SidebarAside.tsx`, `TopBar.tsx`, `bar/sidebar.tsx`,
`AdminLayout.tsx`, `AccountLayout.tsx`, and each app's sidebar.
