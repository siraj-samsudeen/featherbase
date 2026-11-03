# Feather Tickets stage-one design

## Context

The approved prototype is a local demonstration, not an installed app. The
existing Tasker package demonstrates manifest-owned **Tables**, prepared client
assets, runtime actions and transactional document operations. The built-in
Helpdesk sample is a different app and stays unchanged.

ADRs 0011, 0013 and 0014 establish the **Product app** / **Instance** boundary.
ADR 0015 supersedes their old process and mutable-ADR provisions; ADR 0017
supersedes ADR 0016's immediate backend coverage gates. No platform boundary
change is proposed.

## Goals / Non-Goals

**Goals:** Turn the approved inbox into a separately installable **App**, with
persisted requests, regional approval, manual fulfillment and accountable
investigation. Preserve a useful requester view without exposing support work.

**Non-Goals:** Live StyleHR, inbound email, external access grants, warehouse
queries, autonomous agents, GitHub writes and production deployment. Stage one
does not create an automation worker or require integration credentials.

## Decisions

### Reuse the app runtime, not a second ticket service

Put the product in `example-apps/tickets/`, with manifest-defined storage and
declared server/client contributions. Use existing authenticated runtime reads,
actions and documents, not raw SQL or platform-internal imports. Instance setup
supplies actual people, routing and resource policy. The rejected alternative
is a separate backend/database: it duplicates identity and transactions and
would no longer prove the requested independently installed Featherbase app.

This applies existing architectural decisions rather than introducing one.
No new service is deployed. The client runs in the existing app host; data
remains in the instance's control database.

Review exposed one missing runtime seam: save validators do not run for
generic rename or deletion. Add an optional server export `destructiveGuards`,
keyed only by owned **Tables**, with the existing structural row/user/reject
context. Bind it to the host's deletion hook and a `before_rename` hook inside
the rename transaction; it cannot grant authority or bypass permissions.
`before_lock` is not suitable because saves and runtime reads also acquire
those locks. Existing packages without
the export stay unchanged. Tickets refuses both operations on all its records,
preserving stable references and append-only events even for Administrator.
Reusing save validators on partial rename/delete rows was rejected because
existing validators expect complete save data and must not change behavior.

### Share the public queue without sharing private records

Owner chose a shared queue. Signed-in requesters can read ticket summaries and
public progress across the instance, not just tickets they submitted. This
does not authorize editing others' requests, verifying employment, approving or
fulfilling access. Keep original request details and recipient information
separate from the shared summary; they remain visible to the requester and
authorized support. Verification details, diagnostic evidence and internal
notes remain support-only records with explicit grants.

Use separate manifest-owned records for shared summaries/public progress,
private request details and support-only evidence/decisions. Runtime reads must
not rejoin private content into shared responses. Internal records are
append-only through validation, including direct generic writes, not just
hidden in the custom UI.

The rejected alternative is one ticket containing all private notes with
client-side filtering: it leaks through generic reads, exports and activity.
An owner-only queue was offered and rejected by the owner in favor of shared
visibility.
The platform's existing Table permissions remain authoritative; this design
does not invent an independent ACL engine. Exact access checks must be proven
through both app reads and ordinary document/activity APIs.

### Treat access as an attributed decision over a current request

Use server validation for protected state, actor, original-message and history
changes, with explicit actions for verification, regional decision and manual
fulfillment. Every action reads the current request and checks its revision
inside the host transaction. The state change and its attributed event commit
together; stale decisions cannot replace a newer one. Reuse host action
idempotency instead of inventing a second receipt mechanism.

Only a matching current verification and approval authorize fulfillment.
Recipient changes clear verification and approval; region, employment or scope
changes clear the dependent approval. Restricted resources cannot be unlocked
by ordinary regional approval. The rejected alternative is an editable status
plus hidden UI controls: generic writes and stale browser tabs bypass it.

### Manual verification first, with configurable authority

Owner approved: initial verification admins are Bala, Siraj and Shahul. They
must record the exact email, active-employment result, region and evidence
reference; the server supplies actor and time. There is no stage-one employee
lookup result unless a human recorded it. Membership is an **Instance** setting,
not names or email addresses embedded in product code.

The rejected alternative is letting requesters assert their own employment or
shipping a simulated StyleHR match as production verification. Manual checks
are slower but usable without credentials, and their provenance stays visible
when a later integration replaces the lookup.

### Reference external work without impersonating automation

Stage one stores evidence references and existing issue/PR links; staff record
their findings and resolution. No diagnosis button implies a live query or
agent run. Fictional walkthrough data belongs to an explicit development seed,
separate from ordinary installation. The rejected alternative is copying the
prototype's deterministic classifier/fixture diagnosis into the real app as AI.

## Risks / Trade-offs

- Manual identity checks can be wrong → retain the evidence, verifier and time;
  show that the source was manual, not StyleHR.
- Support evidence can contain sensitive information → separate permissions,
  test list/detail/history/export paths, and use references rather than copied
  credentials or unrestricted warehouse dumps.
- Permissions and validators must work beyond the app UI → direct-write,
  unauthorized-read and concurrent-decision HTTP checks are acceptance gates.
- Runtime extension points may prove insufficient for safe append-only
  attributed writes → stop that slice and identify the smallest generic seam;
  do not bypass caller permissions or silently broaden platform scope.

## Migration Plan

1. Prepare and install the new package in an isolated development instance.
2. Apply manifest storage/permissions through existing installation machinery.
3. Configure roles, routes and restrictions for that instance. Missing routes
   or membership leave actions unavailable, never permissive.
4. Seed fictional walkthrough data only on explicit development request.
5. Prove a fresh install without Tickets, an explicit install and a second
   differently configured instance. Existing apps must remain unaffected.

No existing Helpdesk or prototype data is migrated. A failed install must
follow the host's existing rollback behavior. After real tickets exist, rollback
means disabling access/reverting code while retaining stored records; do not
uninstall or delete ticket data as an automatic recovery action. Production
installation and data operations need separate authorization.

## Open Questions

No integration credentials are needed for this stage. Real account identities
will be supplied privately during instance setup, not inferred from names.

The owner confirmed a shared requester queue with private support information.
No in-force ADR needs supersession.
