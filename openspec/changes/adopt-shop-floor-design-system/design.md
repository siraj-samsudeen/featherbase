# Design

## Context

Siraj chose direction B, "Shop Floor", on 22-Oct-2026 (JeyaramaGroup/data-warehouse#4332; design page
https://claude.ai/artifact/6QBq7Zdim9BXfyixy4dJGi). The same day he ruled out any backward compatibility: new names
replace old ones outright and the palette picker goes completely. PR #371 owns Login, SalesTarget, AdminLayout, the
router, Comments, FormView, `lib/api.ts` and `lib/session.ts` until it merges.

## Goals / Non-Goals

**Goals:** one token set whose every text pair passes WCAG AA in light and dark; primitives every screen uses; hard
guards in the test suite; no old name left once the last stage lands.

**Non-Goals:** new page behaviour beyond what the approved direction names (employee-code-first sign-in, the sales
headline and the staff tab bar are separate page-adoption changes after this one).

## Decisions

- **Token roles.** Surfaces and text: `canvas`, `surface`, `subtle`, `border`, `border-control`, `ink`, `ink-muted`,
  `ink-subtle`. Action: `action`, `action-hover`, `action-ink`, `action-tint`, `focus`. Meaning, never chrome:
  `negative` (below target, errors), `caution` (near target, warnings), `positive` (target met, success), `opportunity`,
  `missing` (no data), each with a `-tint`. The UI chrome is neutral so the meaning colours stay free.
- **Density by pointer, not by a second design.** `--spacing-control` and `--text-control` are 36 px / 14 px for a
  fine pointer and 48 px / 16 px for a coarse one, so phones get thumb-sized controls and no zoom-on-focus while
  laptops keep their density.
- **Primitives are components plus class recipes.** `Button`, `Field`, `Card`, `Notice`, `EmptyState`, `Skeleton`,
  `Toast`, `DataList`, `Headline`, with `buttonClasses()`-style recipes so a router `Link` can look like a button
  without wrapping it.
- **Icons:** `lucide-react`, re-exported from one module so the set stays curated. **Font:** the system UI stack, which
  loads nothing and renders Malayalam and Tamil natively.
- **Amounts:** `fmtINR` (lakh/crore ladder) for "how big" summaries, `fmtExact` for amounts that foot or get paid,
  `fmtCount` for counts, `fmtDate` for days, per ADR 750 / ADR 844 of the data warehouse.
- **Display defaults (Siraj, 22-Oct-2026: Jeyarama is an Indian business, clean start).** A clean install shows
  rupees; rupees group the Indian way and any other currency keeps its own locale's grouping. Dates have one display
  form, DD-Mon-YYYY (ADR 844); ISO stays machine-facing, and the US and numeric display options are removed. Migration
  0103 moves an install that had chosen a retired format.
- **Touch sizes hold whatever a screen asks for.** A screen may make a control smaller under a mouse, but on a touch
  screen the 16 px control text and 48 px height stay; the recipe applies the screen's smaller size as `pointer-fine:`.
- **Guards.** A contrast test reads `index.css` and checks every text pair (≥4.5:1) and control edge (≥3:1) in light
  and dark. A rules test fails on raw Tailwind palette classes, literal hex colours, text under 12 px, browser-locale
  formatting and old token names. Until the last stage it carries an explicit list of files still waiting for the
  sweep; a listed file that is already clean fails the test, so the list can only shrink, and the last stage deletes it.

## Staging (each stage leaves the app consistent)

1. **Foundation** (no #371 file): final token names, primitives, DataList, Headline, formatters, guards, a component
   gallery. Shared names (`canvas`, `ink`, …) take their new values app-wide; nothing is aliased.
2. **Sweep of every other screen** onto the primitives and final names. Merges with stage 3, not before, so the shell
   and its content never show two blues.
3. **After #371:** sweep its files, remove the palette end to end (picker, preference endpoint, stored column), add
   follow-the-device, delete every old token name and the six `fc-*` classes, and delete the pending list.

## Risks / Trade-offs

- [Stage 2 waits on #371] → It is opened ready for review and rebased the day #371 merges.
- [Taller controls on phones make dense toolbars wrap] → Accepted; the toolbar already wraps by design.
