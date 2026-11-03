## Context

#826: metadata currently uses raw column keys as omitted-label defaults and
newline-separated Choice values as both storage and display text. The owner
authorized the recommended defaults through the manager on 03-Nov-2026.

## Goals / Non-Goals

Readable platform labels and authored Choice displays without changing identity,
validation, saved values, permissions, or app wording. No global recasing, CSS
transforms, per-model form, navigation redesign, or new choice editor.

## Decisions

1. Add an optional `choice_labels` JSON object to column metadata, mapping exact
   values to authored strings. Carry it through existing definition, metadata,
   custom-column, app and public-form paths. Render with one shared lookup;
   missing entries fall back to the exact value. Reject automatic humanization:
   underscores may be intentional in app data, and policy wording needs authorship.
2. Keep existing translation lookup at the presentation boundary. Resolve an
   existing translation of the raw value before the authored display label so
   upgrades preserve installed catalogs. Never transform translated output.
3. Use the existing shared label generator only for omitted labels, with common
   identifier acronyms recognized. Explicit labels, including sentence text and
   brands, are not passed through it.
4. An ordered migration enumerates baseline-owned old labels and exact old choice
   definitions. Change only matching, noncustom platform columns, never custom or
   app definitions. Preserve label overrides. When an old label is a translation
   source, retain that base label rather than invalidate its installed translation.
   Choice mappings leave values and choice definitions untouched. A choices override
   takes effect normally; unmatched values fall back verbatim.

## Risks / Trade-offs

- Authored labels can become stale when choices change: exact-key lookup and
  verbatim fallback avoid invented wording. No automatic formatter is added.
- A translated legacy base label remains unchanged: preserving effective wording
  takes priority over polishing the English fallback on that instance.
- Lists must retain the mapping through their metadata projection. Tests exercise
  actual form and list consumers, not only the lookup helper.

## Migration Plan

Fresh installs and existing instances run the same ordered migration. Rehearse
against a dedicated pre-change database with customized labels, overrides and
translations. Verify exact old defaults converge, custom wording survives,
stored values remain unchanged and a second migrate does nothing. Never run
this branch's migration against a shared/live instance. No deployment authorized.

## Open Questions

None. Owner defaults authorization removes the former contract approval gate.
