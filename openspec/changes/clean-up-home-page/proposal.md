# Proposal

## Why

Siraj reviewed the Home page on dev on 26-Oct-2026 and found it hard to read. A
remembered page showed its route slug (`explore`). A row showed its internal id
(`1517|040802006`). One link card had no heading. The activity feed repeated the
same action row after row. A deep link opened while signed out was forgotten
after sign-in, so the person landed on Home.

## What Changes

- Remembered pages and rows read as names everywhere on Home and in the
  sidebar, including entries the browser recorded before page titles existed.
  A row with no title column gets a readable stand-in built from its own values.
- Every link card has a heading.
- The activity trail is grouped by day. Each row starts with an icon for its
  kind, reads as a sentence ("You opened …" or "<person> changed …"), and
  ends with the time. Back-to-back repeats of one action show once, with a count.
- A deep link survives sign-in, including the Google round trip.
- Layout polish with no new promise: sentence-case headings, the sidebar's
  "Recently opened" heading and its Data / People and access groups, a navbar
  whose app selector lines up with the sidebar and whose command bar fills
  the space, and one chevron select style.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dashboards-and-home-pages`: link cards always have a heading; remembered
  places read as names; the activity trail reads by day and merges repeats.
- `sign-in-and-accounts`: returning to a deep link also covers Google sign-in.

## Impact

A new `POST /api/row_titles` (scoped like a list read). `/api/activity_feed`
merges repeats before its limit and titles rows. The shared app-routes catalog
gains a path lookup, and shared gains the row-title rule. The web gets one
kind-icon vocabulary, used by the feed, the sidebar and the command bar. No
schema change.
