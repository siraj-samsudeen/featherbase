# Tasks

## 1. Revoke the signed-out session

- [x] 1.1 Add failing tests: after sign-out the same token is refused on ordinary requests and on live updates; another session of the same person keeps working; sign-out through the cookie alone revokes too; a session without an id is refused; expired revocations are pruned; access tokens are unaffected.
- [x] 1.2 Give every session a unique id, record it on sign-out, refuse a recorded id when a session is used, and prune records past the session's expiry on each sign-out.
- [x] 1.3 Close the signed-out session's open live-update connections, including for an expired session; leave the person's other connections open.
- [x] 1.4 Close a connection that registers just after its session was signed out, and re-check open connections against the shared record every minute so other servers converge.
- [x] 1.5 Report a sign-out that could not be recorded as incomplete (server answers an error, the app tells the user).
- [x] 1.6 Cover a bearer header and a cookie that name different sessions.

## 2. Verification

- [x] 2.1 Run the server suite, server and web typechecks, `pnpm check:specs`, and the sensitive-content check; note the one-time sign-in for every user in the deploy guide.
