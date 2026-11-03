## 1. Acceptance first

- [x] 1.1 Reproduce destination dismissal failure through public browser interaction before changing source; cover pointer and keyboard activation, including the current destination.
- [x] 1.2 Execute the fenced destination and replay scenarios through acceptance steps.

## 2. Implementation

- [x] 2.1 Dismiss on destination activation without route-change effects or history changes; preserve search replay and commands.

## 3. Completion

- [x] 3.1 Run focused browser/component checks, typecheck, strict OpenSpec validation and boot smoke.
- [x] 3.2 Independently verify the issue checklist at desktop width and inspect a real-pointer/keyboard recording.
- [x] 3.3 Prepare a tested PR with exact-head CI and comment subscriptions; leave archive, merge and deployment gated by the owner.

PR: https://github.com/siraj-samsudeen/featherbase/pull/824. Local validation and independent UI verification passed. Remote CI is subscribed, not yet claimed green. Owner video review and archive remain pending; no merge or deployment performed.
