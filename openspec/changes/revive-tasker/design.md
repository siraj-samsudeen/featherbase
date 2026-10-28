## Context

See proposal.md for the owner's reversal of retirement and the intended first trial. Tasker 2.3.0 declares All grants on its own tables and Comment, loads the oldest 500 tasks, and uses its own pre-Shop Floor stylesheet. Existing failing tests pin the missing-task, author-name and phone-inspector defects. These are implementation gaps, not approved changes to expected behaviour.

## Goals / Non-Goals

**Goals:** preserve task behaviour and data, enforce explicit membership consistently, and bring the app under current platform presentation and release contracts.

**Non-goals:** a new tenancy model, private tasks, per-project permissions, store-based scope, changes to the meaning of task states, or a platform dependency on Tasker internals.

## Decisions

1. **Revise the app and preserve its tests.** A rewrite would recreate existing behaviour without resolving the platform integration work. Keep current task/project identities and data. Record an append-only amendment to ADR 0013 before implementation; the historical decision remains intact.
2. **Authorize on the server through declared app contracts.** Use explicit membership rather than All grants, including catalog entry, direct row access, actions, comments/history and supporting people reads. Do not rely on navigation to enforce access. Coordinate any missing generic grant capability with #617 rather than adding Tasker-specific platform branches. Preserve existing private user settings and current deletion safeguards.
3. **Reuse the platform's design system through supported app-facing exports.** Avoid a second copy of tokens or formatters and do not import private web internals. Where an export is missing, define the generic app-facing seam before adoption. Include Tasker's source in appropriate design guard checks. Retain workflows while the owner agrees concrete navigation, labels and phone layouts in #563; no UI checklist is approved by this document.
4. **Repair existing promises before adding workflows.** Remove silent collection truncation with correct paging across tasks and supporting data; do not merely raise the cap. Resolve activity authors to names and adopt shared time formatting. Retain the failing regression assertions and turn the pins into ordinary passing tests when fixed.
5. **Keep release identity truthful.** Publish a new app version with the required migration ledger and fingerprint verification. Do not change the contents of an installed 2.3.0 artifact in place.

## Risks / Trade-offs

- Tightened membership can lock out former users → require explicit instance membership setup and verify member, non-member and revoked-member requests before trial; never silently enrol all users.
- Old platform-wide grants can survive an app manifest edit → add a convergence migration and prove fresh and upgraded databases. Preserve task data; do not revive #563's deletion instructions.
- A themed host can hide an unthemed app → inspect the app itself in light/dark at 1280px and 375px, using an independent verifier and an owner-agreed checklist.
- App-contract work in #617 may be unfinished → resolve the required grant seam before access implementation, with hidden-logic review; do not treat every #617 enhancement as a prerequisite.

## Migration Plan

Before implementation, boot and smoke-test the checkout and inspect the target's installed app state. Prepare a new Tasker version, migrate legacy grants without losing work, and explicitly configure the initial members. Prove retained tasks, projects, activity and preferences on fresh and upgraded local databases. Rehearse any data-changing shared-instance migration on a restored snapshot with the target environment. Deploy only under docs/DEPLOY.md; test the exact deployed commit with ordinary members. Recovery must preserve the tightened access boundary, not restore broad All grants.

## Open Questions

The owner will review the concrete screen arrangement and labels before UI implementation; the product workflows and membership model above remain fixed. Initial trial participants and the target instance will be selected before rollout.
