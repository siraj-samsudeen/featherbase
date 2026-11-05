# ADR 0019: Apps colour themselves only through the platform's named accents

**Status:** Accepted · **Date:** 2026-11-04 · **Issue:** [#941](https://github.com/siraj-samsudeen/featherbase/issues/941)

## Context

Tickets shipped its own palette and its own page chrome under the shared top bar, so it looked and navigated unlike every other app. The owner wants apps to be able to look like themselves, but only through what the platform provides, never through ad-hoc styling (04-Nov-2026). Featherbase has had colour choice before: per-person palettes (UI-025, July 2026), removed on 22-Oct-2026 when the Shop Floor design system made one token set, with every text pair checked for contrast in light and dark (#380).

## Decision

An app may name one **accent** in its manifest, from a fixed set the platform defines in Shop Floor. An accent re-values only the action and selection tokens, in light and dark. The platform applies it to the app's page and to the shared bar and navigation over it. Apps otherwise use Shop Floor tokens and the platform's shared navigation, and bring no colours of their own. A new accent is added to the platform's set, where the contrast guard checks it, never inside one app.

## Consequences

- Every app keeps the same meaning colours, surfaces and navigation. Only its accent differs.
- A new look for an app is a platform change, one small token block plus its guard run, and every other app can then use it.
- An app that needs more than an accent asks for a platform feature. It doesn't style around the platform.
