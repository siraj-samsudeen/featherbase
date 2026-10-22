# Tasks

## 1. Foundation (PR 1, no #371-owned file)

- [x] 1.1 Write the failing guard tests first: contrast over every token pair in light and dark, and the rules scan
  with its pending-sweep list; run them against the current tokens to see them fail.
- [x] 1.2 Replace the token block with the final roles (light and dark), the system font, shape and density tokens;
  remove the Inter dependency; verify the contrast test passes.
- [ ] 1.3 Add the primitives (Button, Field with Input/Password/Select/Search, Card, Notice, EmptyState, Skeleton,
  Toast, icon set) with component tests.
- [ ] 1.4 Add DataList (table on wide screens, cards on narrow), Headline, `fmtINR` and `fmtCount`, with tests.
- [ ] 1.5 Add the component gallery page; capture light, dark, 375 px and 1280 px screenshots; run web typecheck, the
  web suite, `pnpm check:specs` and `git diff --check`.

## 2. Sweep of every screen not owned by #371 (PR 2)

- [ ] 2.1 Move every such screen onto the primitives and final token names; replace browser-locale formatting and text
  under 12 px; remove each cleaned file from the pending list.
- [ ] 2.2 Before/after screenshots of a list, a form and a Checklist at 375 px and 1280 px; web suite, typecheck and
  the affected e2e specs.

## 3. After #371 merges (PR 3)

- [ ] 3.1 Sweep Login, ResetPassword, Portal, SalesTarget, AdminLayout, router, Comments, FormView and #371's new
  screens.
- [ ] 3.2 Remove the palette: picker, client preference, server endpoint and stored column (migration), and its tests.
- [ ] 3.3 Theme choice of light, dark or follow-the-device, and follow-the-device before sign-in.
- [ ] 3.4 Delete every old token name and the six `fc-*` classes; delete the pending list so every rule is a hard zero.
- [ ] 3.5 Update the visual-identity directive in `CLAUDE.md`/`AGENTS.md` and the Purpose lines of
  `admin-ui-feedback` and `personal-preferences` that mention palettes; archive this change after
  `/openspec-verify-change`.
