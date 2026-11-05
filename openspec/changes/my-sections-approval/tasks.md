## 1. Platform

- [x] 1.1 Test first (`apps/server/test/change-proposals.test.ts`, a proof app): declared and listed reads; propose, approve, reject, stale, self-approval, role fallback, nobody else; race with real commits.
- [x] 1.2 Migration: the system-written Change Proposal and Change Proposal Column Tables. The person registry classifies them.
- [x] 1.3 `baseTables` in the manifest; the `baseTables` and `changeProposals` helpers on action and read contexts.
- [x] 1.4 A bar control can stay away from a page.

## 2. Dash server

- [x] 2.1 Test first (`platform-test/my-sections.test.ts`): reads and every proposal and decision rule, on made-up base Tables.
- [x] 2.2 Reads and actions; the manifest declares them. Version bump with an empty step and the old version kept in `previousVersions`.

## 3. Dash screens

- [x] 3.1 Test first: component tests for both pages and the links from the empty screens.
- [x] 3.2 Your sections and Waiting for your approval, in Shop Floor components.
- [x] 3.3 The made-up seed creates base Tables and people to try every state.

## 4. Check and release

- [ ] 4.1 Codex standard and adversarial reviews until clean.
- [ ] 4.2 The independent UI verifier against the issue's checklist.
- [ ] 4.3 Pre-deploy path proved locally; CI green; change archived.
