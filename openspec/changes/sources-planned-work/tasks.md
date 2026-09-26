## 1. External data sources — drift, reconciliation, stricter conflicts

- [ ] 1.1 Cache each data source's introspected shape and detect drift (a
      mapped column dropped or retyped) when a connected table is used;
      fail that table's requests with a named-column error instead of
      silently misreading it.
- [ ] 1.2 Add a "bring in changes" view that diffs a data source's current
      shape against a connected table's mapping and lets a builder accept
      added/removed/retyped columns one at a time.
- [ ] 1.3 Add a reconcile record for a connected row's comments, files,
      assignments and similar Featherbase-side additions when the row
      disappears or changes id at the data source; add a review list.
- [ ] 1.4 Add a per-table stricter-conflict-catching setting for data sources
      with no last-changed column (compare every loaded value instead of
      none), and a persistent notice on the table while it's off.
- [ ] 1.5 When a save is refused because the row changed at the data source,
      return the row's current values with the error and show them next to
      what the user tried to save.

## 2. Connection console

- [ ] 2.1 Promote the winning prototype (`apps/web/src/pages/
      PrototypeConnectSource.tsx`) design to a real page wired to real
      endpoints; retire the mock's simulated test/introspect.
- [ ] 2.2 Add typed connection fields (host, port, database, user, password)
      and encrypted storage for the password, with a write-only edit and no
      read path that returns it.
- [ ] 2.3 Add the phased connection-test endpoint (reach host → agree on
      encryption → sign in → read database) with a classified reason on the
      first failing phase.
- [ ] 2.4 Add the database-list endpoint used once host/user/password
      authenticate, and the account-privileges report on a successful test.
- [ ] 2.5 Add the saved-data-source health surface (status, last success,
      failing-since, failing phase, affected table count) and re-test/
      update-password actions on the same page.
- [ ] 2.6 On a deployment where anyone can sign in, show the notice that a
      saved data source is readable by every System Manager.

## 3. Verification (once implemented)

- [ ] 3.1 HTTP tests against a running server for each requirement above,
      following `docs/TESTING.md`.
- [ ] 3.2 Playwright coverage for the connection console's guided flow and
      the drift/reconcile review screens.
- [ ] 3.3 Sync the delta specs into `openspec/specs/` and archive this change.
