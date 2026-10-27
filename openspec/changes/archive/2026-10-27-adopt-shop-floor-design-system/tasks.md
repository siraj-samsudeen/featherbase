# Tasks

## 1. Foundation (PR 1, no #371-owned file)

- [x] 1.1 Write the failing guard tests first: contrast over every token pair in light and dark, and the rules scan
  with its pending-sweep list; run them against the current tokens to see them fail.
- [x] 1.2 Replace the token block with the final roles (light and dark), the system font, shape and density tokens;
  remove the Inter dependency; verify the contrast test passes.
- [x] 1.3 Add the primitives (Button, Field with Input/Password/Select/Search, Card, Notice, EmptyState, Skeleton,
  Toast, icon set) with component tests.
- [x] 1.4 Add DataList (table on wide screens, cards on narrow), Headline, `fmtINR` and `fmtCount`, with tests.
- [x] 1.5 Add the component gallery page; capture light, dark, 375 px and 1280 px screenshots; run web typecheck, the
  web suite, `pnpm check:specs` and `git diff --check`.

## 2. Sweep of every screen not owned by #371 (PR 2)

- [x] 2.1 Move every such screen onto the primitives and final token names; replace browser-locale formatting and text
  under 12 px; remove each cleaned file from the pending list. (36 files. AccessTokens, PermissionManager, Assignments,
  ActivityFeed and ActivityTimeline wait for the person-rename change, #384, and move to 3.1.)
- [x] 2.2 Before/after screenshots of the swept screens at 375 px and 1280 px, light and dark; web suite and typecheck;
  the e2e suite in CI.

## 3. After #371 merges (PR 3)

- [x] 3.1 Sweep Login, ResetPassword, Portal, SalesTarget, AdminLayout (using `useMediaQuery`), router, Comments,
  FormView and #371's new screens; after person-rename (#384), AccessTokens, PermissionManager, Assignments,
  ActivityFeed and ActivityTimeline.
- [x] 3.2 Remove the palette: picker, client preference, server endpoint and stored column (migration), and its tests.
- [x] 3.3 Theme choice of light, dark or follow-the-device, and follow-the-device before sign-in.
- [x] 3.4 Delete every old token name and the six `fc-*` classes; delete the pending list so every rule is a hard zero.
- [x] 3.5 Update the visual-identity directive in `CLAUDE.md`/`AGENTS.md` and the Purpose lines of
  `admin-ui-feedback` and `personal-preferences` that mention palettes. (Archiving waits for section 4, which is
  still in this change.)
- [x] 3.6 Remove the language picker from the header and the account menu (Siraj, 24-Oct-2026: no translation
  ships). Keep the stored language and the translation catalog, so a picker can return with a translation.

## 4. Page adoption (after stage 3)

- [x] 4.1 ListView on DataList, so a list fits a phone as cards. Keep selection, bulk actions, expandable rows and
  sorting working in both shapes. This delivers "Lists fit a phone".
- [x] 4.2 Sign-in: employee code first when a connected service is configured; `app_name` plus a logo field.
- [x] 4.3 ~~Sales target: a Headline over a responsive, light-themed Dive (the Dive restyle lives in the data warehouse).~~
  Dropped (owner, 27-Oct-2026): design D6 of `feather-dash-installed-app` (#550), "the Dive is the report",
  supersedes it, so no Featherbase headline sits over the Dive. An answer-first headline, if wanted, belongs inside
  the Dive in the client's data warehouse, not in Featherbase.
- [x] 4.4 A tab bar for staff roles on phones: the platform building block only (owner, 27-Oct-2026). A Shop Floor
  `TabBar` primitive (phone only, icon and label, 48px targets, the open tab marked, in the gallery) and an
  app-declared `tabs` list, its own extension-point version (`tabs.version` 1, #617), that the shared top bar and the
  installed-app shell draw on a phone. No app declares tabs yet; Feather Dash fills them in with B6′ and stage D, so
  nothing changes for staff until then.
- [x] 4.5 A touch-target pass on every remaining control (menu rows, dense toolbars) using the recipes, with a browser
  check that measures controls at phone width.
