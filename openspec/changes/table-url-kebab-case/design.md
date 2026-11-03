## Context

Issue #821 approves kebab-case without renaming Tables. Existing server resolution is exact-name-first, then case/space/hyphen/underscore normalization, with ambiguity refused. UI pages currently receive raw URL segments; permissions, settings, scripts and print-format filters need canonical names. Real HTTP/browser probes confirmed legal Table `New Table` and row IDs `columns` and `new` collide with current fixed routes.

The owner delegated routine choices to defaults through the manager on 03-Nov-2026 and authorized proceeding with the consistent namespace below. No additional planning gate is required.

## Goals / Non-Goals

Preserve identity, access rules, encoding and existing layouts. Do not add compatibility routes, redirects, stored slugs, API-wide alias support or display-name conversion guesses.

## Decisions

1. All Admin Table destinations use `/featherbase/admin/table/$table`. Existing rows use `/row/$name`; creation uses `/new`; tools use `/columns`, `/merge`, `/naming`, `/permissions`; views use `/view/<mode>`; row maps use `/row/$name/map`. This rejects conditional namespace exceptions, which create two rules, and avoids reserving legal Table names or row IDs. Portal and print retain their distinct roots and existing positional row grammar, which has no tool siblings, but use the shared Table segment rule.
2. Share the existing normalization contract between server resolution and URL generation. Keep punctuation such as qualified app-name dots, rather than inventing a lossy generic slugifier. Resolve incoming Table segments using the metadata endpoint and pass `metadata.name` into canonical consumers before mounting them. Do not capitalize segments or extend every API endpoint to accept aliases.
3. Creation is explicit form state rather than the row ID `new`. Existing rows, including `new`, always retain their actual ID. Settings keep their canonical singleton row ID.
4. Generated links and route parameter serialization use the same source-of-truth rule. Row IDs are encoded independently, and query JSON remains semantic canonical data. Recents record resolved Table identities while retaining the navigated path.

## Risks / Trade-offs

- Pre-release links change outright; old bookmarks are not retained through a shim.
- Broad destination ownership means tests and shipped app anchors must migrate too. Inventory includes server notifications/feed, Table links, recents, source/import and related destinations.
- #800, #772, #826 and #827 own overlapping work. Preserve their production behavior; import no unpushed code. #822 dismissal is already on current origin/main and must remain intact.

## Migration Plan

Change routes, all internal generators and test page objects together. No persisted slug or schema migration. Keep arbitrary row IDs and query encoding. Run real HTTP/browser checks, build/typechecks and ordinary code review. Prepare a PR; owner retains merge/deployment and archive-after-review-video gates.

## Open Questions

None for implementation. Owner video review and merge/deployment authorization remain separate delivery gates.
