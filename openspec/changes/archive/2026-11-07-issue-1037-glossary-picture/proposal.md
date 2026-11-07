## Why

Some business words only make sense together, such as how Site, Store, Plant, Building, Floor and Section relate. A diagram explains that better than text, but a glossary term has had text columns only (#1037).

## What Changes

- `Glossary Term` gains a Picture column (Attach Image), right after the definition in its form.
- The glossary page shows a term's picture under its definition. Selecting it opens the picture full size.
- The picture is the instance's, not wording: setting one leaves an app's term unedited, and upgrades and taking the app's wording keep it.
- Everyone who reads the glossary can open the picture, because the file is attached to the term they can read.

## Capabilities

### Modified Capabilities

- `glossary`: a term may carry a picture.

## Impact

- Migration 0155 adds the column and its definition, moving the term's later columns down one place.
- `GET /api/glossary` returns `picture` on each term.
- Not in this change: an app shipping a picture in its manifest, and a term naming the other terms it relates to. Both are in #1037's request; this change is its first slice.
