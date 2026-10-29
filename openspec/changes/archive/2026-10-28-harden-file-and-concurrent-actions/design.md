## Context

Issues #680, #575 and #572 identify missing trust or transaction boundaries. #599 already has parent key-share locks and rename/delete update locks; verify those contracts without changing them.

## Decisions

Use a server-only save option to authorize the exact path returned by upload storage. Check the final row after hooks, including immutable paths on updates. Do not add the issue's suggested unique index: the existing table-deletion spec explicitly preserves shared storage, and its #123 regression creates shared registry references deliberately. Upload-only assignment closes arbitrary path claims without changing that contract. Existing data is not rewritten or deduplicated.

Normalize only the limiter's IPv6 source key to its first 64 bits. Leave clientAddress unchanged so audit logging retains the full address. IPv4 and mapped IPv4 retain current budgets. A global username limit is not included: #575 only suggests considering it, and locking an account across unrelated networks needs an owner decision.

Take the workflow target's update lock inside its existing write transaction, after the managed-settings lock, and run row reads and transition checks there. Losing requests produce no action or email.

## Verification

Use sandboxed HTTP tests for file forgery and IPv6 limits. Use guarded, opt-in independent committing connections for workflow and activity races. Keep fixtures in private disposable local databases for inspection.
