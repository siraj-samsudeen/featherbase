# Feather Tickets — stage one

Issue: [#810](https://github.com/siraj-samsudeen/featherbase/issues/810).
The owner approved the interactive prototype and staged delivery in the
[working thread](https://ampcode.com/threads/T-01a19e6f-6895-769e-aaad-c0e79506d687).

## Why

Data warehouse support arrives as scattered messages, access requests and data
complaints, leaving people to chase the next action. Feather Tickets gives each
request a durable home, a responsible person and a visible path to resolution.

## What Changes

- Ship Tickets as a separately installed **Product app**, following the existing
  **App** packaging contract. Its pages and **Tables** belong to the app, not to
  Featherbase's platform or the existing Helpdesk sample.
- Turn the approved desktop inbox and case file into a real, signed-in
  experience with server-backed persistence. Requesters share a queue of ticket
  summaries and public progress; support staff triage and work requests within
  their granted access. Shared visibility does not grant editing or approval rights.
- Accept structured access, data freshness, data quality, report/export,
  source, column/model, pipeline and backfill requests, or an unstructured
  message. Classification and completion preserve the original request.
- Route access requests to configured approvers, then make approved requests
  available to configured fulfillment admins. Enforce the gates on the server;
  changing an ordinary ticket must not bypass them. Record manual fulfillment,
  not a claim that Tickets granted access itself.
- Record employee verification, approval decisions, requested scope, evidence,
  expected/actual outcomes, related work and resolution history. Only configured
  verification admins may manually confirm employment, with the verifier, time
  and evidence reference recorded. Initial membership: Bala, Siraj and Shahul.
- Keep regional routing, people and restricted-resource rules in **Instance**
  configuration rather than hard-coding Jeyarama into the reusable product.
- Show live integrations as unconfigured. Stage one does not manufacture
  employee matches, AI diagnoses, received emails, invitations, GitHub issues
  or PRs. Fictional sample data is an explicit development-only choice.

Stage two remains part of the product direction, but not this change: StyleHR
enrichment, inbound email, read-only warehouse investigation, agent execution
and GitHub issue/PR creation. No real service credentials are needed to build
stage one.

## Capabilities

### New Capabilities

- `tickets-intake-and-triage`: capture and track structured or free-text
  requests; classify them without losing the original; keep requester and
  support-only information appropriately separated.
- `tickets-access-fulfillment`: employee verification, configurable regional
  approval, policy review and manual fulfillment of exactly the approved scope.
- `tickets-investigation-and-resolution`: collect attributed evidence and
  related-work references, distinguish findings from unverified claims, and
  record resolution without pretending to run an unconfigured integration.

### Modified Capabilities

None intended. Installation, shared app navigation, generic permissions and
workflow promises already belong to existing platform specifications and will
be exercised rather than restated. Any required extension-point change must
be justified by the design before adding a platform capability delta.

## Impact

- New `example-apps/tickets/` package: manifest-defined **Tables**, permissions,
  server validation/actions and the approved client UI, using declared host
  APIs rather than importing platform internals.
- Existing app preparation/discovery and packaged-app proof paths must include
  Tickets when explicitly selected; ordinary Featherbase startup stays app-free.
- An opt-in development seed/setup provides fictional people, routing and
  tickets without installing business data or sending notifications externally.
- Acceptance scenarios under this change will drive real HTTP/browser checks;
  regression checks must cover direct-write bypasses, shared public visibility
  without private-detail disclosure or other-requester editing,
  stale/concurrent decisions and approval invalidation when scope changes.
- No data warehouse code or live external systems change in stage one. The
  reusable product's first-client setup must respect the existing layer-access
  policy rather than treating business approval as a Bronze entitlement.
