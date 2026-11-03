## 1. Acceptance first

- [x] 1.1 Reproduce destination dismissal failure through public browser interaction before changing source; cover pointer and keyboard activation, including the current destination.
- [x] 1.2 Execute the fenced destination and replay scenarios through acceptance steps.

## 2. Implementation

- [x] 2.1 Dismiss on destination activation without route-change effects or history changes; preserve search replay and commands.

## 3. Completion

- [x] 3.1 Run focused browser/component checks, typecheck, strict OpenSpec validation and boot smoke.
- [x] 3.2 Independently verify the issue checklist at desktop width and inspect a real-pointer/keyboard recording.
- [x] 3.3 Prepare a tested PR with exact-head CI and comment subscriptions; leave archive, merge and deployment gated by the owner.

PR: https://github.com/siraj-samsudeen/featherbase/pull/824. Local validation and independent UI verification passed. The implementation head's complete test workflow passed. The manager inspected the before/after/replay screenshots and interaction clip, presented the evidence, and conveyed Siraj's explicit authorization to finalize and merge this small fix once gates pass. This records authorization, not a claim that Siraj watched particular frames. Specs are synced and the change is archived on the same PR branch; finalization-head CI remains a merge gate. The manager owns merge; no manual deployment is authorized or performed.
