## Why

After reinstalling an instance, people still see old destinations remembered by their browser. Their navigation must follow the server's history without losing visits made while that history loads (#769).

## What Changes

- Replace cached history with the server summary, including an empty summary.
- Preserve visits not yet represented by the summary, including queued and in-flight visits.
- Hide cached sidebar and command-bar history until the initial summary settles; fall back to cache on failure.
- Keep existing components and ranking. Event delivery acknowledges the server's stored timestamps so clock skew cannot count one visit twice; the server's timestamp trust window is unchanged. Deleted targets still present in server history are out of scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `search-and-explore`: navigation history follows server history while retaining new local visits.

## Impact

Client history reconciliation and the admin shell, web regression tests and executable acceptance steps. The event POST response additionally returns stored timestamps in request order. No backend schema or permission changes.
