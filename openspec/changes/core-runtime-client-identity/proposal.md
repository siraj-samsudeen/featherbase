## Why

Independent review of b97b1ab found that Tasker's advanced-fields link opens a generic core form whose requests omit the required runtime version header. The server correctly rejects it. Generic metadata-driven clients need an explicit identity bootstrap without weakening stale-client admission.

## What Changes

- Expose an authenticated read-only snapshot of active runtime package identities.
- Pin that snapshot for the core client's signed-in page lifetime and carry it on JSON and multipart requests, including indirect File/Comment/reference operations.
- Accept a strict list of distinct app/version identities in the existing header; continue comparing each accessed application's identity to its installed version and rejecting unavailable or obsolete access.
- Prove core forms, attachments and retained stale generic tabs through a literal v1→v2 upgrade.

## Capabilities

### Modified Capabilities
- `trusted-runtime-packages`: generic core client identity bootstrap and pinning.

## Impact

Core API client, two multipart upload callers, runtime admission/header parsing, authenticated identity endpoint, server/web tests and literal package proof. No migrations, Tasker-specific behavior, server-side identity inference, auto-refresh after conflict or deployment.
