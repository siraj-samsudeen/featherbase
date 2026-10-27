# Proposal

## Why

Most people who open Featherbase are store staff on phones, often in a bright shop. Today they meet faint grey text,
boxes that make the phone zoom in when they type, buttons too small for a thumb, and dates and amounts that do not read
the Indian way. Each screen styles itself, so these problems recur screen by screen and dark mode breaks wherever a
screen skipped the shared colours.

This change gives every screen one look, built once: clear text in light and dark, thumb-sized controls, a page that
follows the phone's own light or dark setting, and amounts and dates in the form the business reads. It removes the
per-user colour palette, which multiplied the looks to keep readable without helping anyone do their work.

## What Changes

- One set of colours, sizes and shapes with a single job each. Old names and the four colour palettes are removed,
  with nothing kept for compatibility.
- Shared building blocks for buttons, fields, cards, notices, empty and loading states, short confirmations, lists and
  the headline of a report. Every screen uses them.
- Lists read on a phone without sideways scrolling.
- Light, dark, or follow the device, saved to the user's account. Before sign-in the page follows the device.
- Checks that run with the tests and fail when text contrast drops too low, when a screen uses a colour outside the
  shared set, when text is too small, or when an amount or date is formatted by the browser's own rules.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `usable-on-any-device`: adds readable-in-bright-light, comfortable-to-tap, Indian amounts and dates, lists that fit a
  phone, and screens that say when they are loading, empty or failed.
- `admin-ui-feedback`: the theme follows the user and can follow the device; the colour palette choice is removed.
- `personal-preferences`: no language picker is shown while no translation ships; the stored language still applies.

## Impact

The web app's styles and every screen's markup change. The server stops storing a palette choice. No data, API used
by an outside system, or table shape outside the user preference changes. The work lands in stages because a parallel
change (#371) owns the sign-in, sales-target and Admin shell screens until it merges; see the tasks.
