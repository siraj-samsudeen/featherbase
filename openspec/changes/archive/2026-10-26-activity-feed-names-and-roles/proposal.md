# Proposal

## Why

The homepage activity feed (#440) named people by their opaque id, called every list open "filtered", and labelled admin pages with route slugs. A System Manager reading the Team view could not tell who did what.

## What Changes

- The Team view names each person and shows their main role as a hint.
- A list open reads "filtered" only when a filter was actually applied.
- Fixed admin pages show their page title.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dashboards-and-home-pages`: the team view requirement now says rows name the person and their main role.

## Impact

`/api/activity_feed`, the ActivityFeed component, the recent-actions recorder, and a shared catalog of static admin pages. No schema change.
