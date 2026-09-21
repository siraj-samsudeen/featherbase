## Context

The runtime API is version 1; packages are trusted Node modules, not sandboxed.
`appOperation` already holds a shared advisory lock through post-commit work;
disable/discovery use its exclusive counterpart. `withTransaction` already
composes nested document transactions as savepoints. Document post-commit work
currently runs after the inner savepoint, so actions must defer that work.

## Goals / Non-Goals

One caller-authorized atomic command with durable retry. No raw transaction/SQL,
privileged caller override, HTTP route contribution, background queue, external
data-source transaction, or app-system authority. Existing trusted process access
is not a sandbox promise; supported host helpers are the enforced boundary.

## Decisions

Proposed manifest extension (existing manifestVersion/apiVersion remain 1):

```json
{
  "actions": {
    "version": 1,
    "names": ["promote"],
    "tables": ["example.task", "example.project", "Comment"]
  }
}
```

The server exports `actions = { promote: async context => result }` alongside
`apiVersion = 1`. Declaration and exports must match exactly. Table allowlisting
is a ceiling, not a grant: ordinary caller permissions still apply. Shared tables
must also appear in the package's permission declarations. Owned tables must be
listed too. Dangerous metadata/security tables are not an action capability.

```ts
interface ActionContext {
  user: string
  payload: unknown
  reject(message: string, fields?: Record<string, string>): never
  documents: {
    get(table: string, rowId: string): Promise<Record<string, unknown>>
    list(table: string, args?: ListArgs): Promise<Record<string, unknown>[]>
    create(table: string, values: Record<string, unknown>): Promise<Record<string, unknown>>
    update(table: string, values: Record<string, unknown>): Promise<Record<string, unknown>>
    delete(table: string, rowId: string, updatedAt: string): Promise<void>
    activity(table: string, rowId: string): Promise<{ comments: unknown[]; versions: unknown[] }>
    deletionState(table: string, rowId: string): Promise<{ comments: number; versions: number; references: number }>
  }
}
```

The handler validates unknown payload using `reject`; the host validates a strict
JSON request envelope. No private exception identity is required. Get locks the
row for the action duration. Update requires row_id and updated_at; delete
requires the loaded updated_at. Activity follows document read permission and
redacts history fields as the existing activity API does. It is read-only and
does not require broad Comment/Version permission. Moving comments/history to a
different document is not offered in v1; updating/moving the original row keeps
its existing identity and discussion.

Guarded deletion is deliberately conservative: `deletionState` locks and checks
document access, then counts Comment, Version and declared Reference rows.
`delete` repeats this check and rejects nonzero counts with string-valued
`fields.comments`, `fields.versions`, `fields.references`. The app can use counts
to return a structured refusal and suggest its own retained-work state. Creation
has no Version in the native document model; all existing Version rows count.
Counts include hidden history without disclosing its values. Runtime Reference
and Comment writers lock the target row in their transaction and recheck that
it exists, closing the insert-after-delete race. Comment target changes also
lock the old target so activity inspection cannot race a discussion move.

```ts
await fetch('/api/app_actions/example/promote', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), payload: { /* app-defined */ } })
}) // success: { result: JSONValue }; normal host error envelope on failure
```

Key scope is caller + app + action, deliberately not package version: a lost
response retried after an upgrade must not execute again. The canonical JSON
payload fingerprint is compared under a database advisory transaction lock.
Successful JSON results live in a private ledger in the same commit as document
writes. Replays recheck current availability and entry-table read permission;
they return the original result without re-running code or effects. Keys do not
expire in v1. A failed transaction does not consume a key.

Post-commit effects are attempted only after the ledger and documents commit,
while lifecycle admission remains held. Effect failures are logged and do not
change the successful response or allow re-execution. This is best-effort effects,
not durable delivery; no automatic retry of notifications/webhooks is promised.

## Risks / Trade-offs

- Single-process activation remains the existing deployment assumption.
- Actions reject bound, settings, child and platform-control tables. Shared
  Comment access needs both declared permission and target document permission.
  Comment is append-only; read discussion through document activity. Delete is
  owned-row-only. List does not accept cross-table `related` filters.
- Serialized helper calls avoid overlapping savepoints. Escaped helper contexts
  become invalid when the handler returns; the handler must await its work.
- Runtime discovery and API routing overlap upgrades; both use the same
  lifecycle lock, and neither action execution nor replay calls lifecycle APIs.
  `db.ts` remains unchanged. Helper rows are JSON-normalized, including timestamp
  strings, so a returned result has the same representation on replay.
- The generic runtime DELETE path uses the same revision and retention guard;
  it cannot bypass action safety. Nonruntime deletion behavior is unchanged.

## Migration Plan

Add an inaccessible internal ledger by `0096_runtime_action_results.sql`; no
backfill. 0094 belongs to schema convergence and 0095 to upgrades. Existing
packages without actions keep working. Rollback code leaves inert ledger rows.
Pre-integration disposable databases with the earlier 0094 ledger must be rebuilt
or explicitly reconciled before applying 0096; this is an unreleased renumber.

## Open Questions

None blocking the narrow v1 contract. Privileged app-system operations, durable
effects and distributed activation remain explicitly deferred.
