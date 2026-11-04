# ADR 0014: Revive Tasker as a product app

**Status:** Accepted · **Date:** 2026-10-30 · **Amends:** [ADR 0013](0013-client-apps-and-product-apps.md) · **Issue:** [#563](https://github.com/siraj-samsudeen/featherbase/issues/563)

## Context

Tasker meets an immediate need for personal work and team follow-up. Its
existing projects, task states, private focus and saved views remain useful.
The owner chose to revise that app and deliver its revival in one PR.

## Decision

Keep Tasker as a product app and revise it in place. This supersedes only
ADR 0013's consequence that Tasker would be retired after stage B.

Membership is explicit. Personal work belongs to its creator and is hidden
even from administrators. Moving it into a shared project deliberately and
permanently shares it with members. The server enforces that rule through
declared, generic extension points; the platform never names Tasker.

## Consequences

Preserve existing identities, relationships and personal settings through an
app version upgrade. Historically shared work requires an explicit migration
classification; the new privacy promise must not silently rewrite its history.
The `revive-tasker` change records the approved behavior and its verification.
