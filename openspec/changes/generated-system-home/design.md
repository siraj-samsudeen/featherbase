## Context

Issue #831 approves metadata-generated System membership. Existing Home Pages share one permission-filtered server response and generic card renderer. The baseline has 53 standalone system Tables but 39 saved links; 50 eligible Tables use Core as their module.

## Decisions

Use the eligible metadata catalogue for membership and existing System link/card rows only for placement. Append unmatched names to Platform, following the original #80 catch-all convention. Reject a new grouping property/registry: it introduces a second metadata contract for a local navigation fix. Reject module-only grouping: it collapses most destinations into one 50-link Core card.

Keep canonical names in destinations and obtain effective labels only after page/read checks. Reuse existing permissionScope semantics rather than adding metadata-Table access or a manager-only gate. Other pages and legacy shortcuts retain their current behavior.

Round-one review reproduced a persisted disallowed metadata override making the entire Home Pages response fail. Fall back to the canonical name only for the existing metadata-property allowlist ValidationError; rethrow unrelated failures and leave the override policy unchanged.

## Risks / Trade-offs

- Platform grows as Tables are added; existing group hints remain available for placement without controlling completeness.
- Labels require effective metadata loading, benefiting from the existing cache. No new endpoint/cache is introduced.
- #821 owns URL policy and #826 owns label contracts. This change consumes existing boundaries and does not assume either PR is merged.

## Migration Plan

No stored rows change. Deploying the response change updates discovery on the next fetch; reverting it restores curated membership.

## Open Questions

None. Owner Decision and manager checklist settle the scope and defaults; ordinary hidden-logic review and final integration are delivery gates.
