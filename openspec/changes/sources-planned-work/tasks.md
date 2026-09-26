## 1. External data sources — drift, reconciliation, stricter conflicts

- [ ] 1.1 Cache each connection's introspected shape and detect drift (a
      mapped column dropped or retyped) when a connected table is used;
      fail that table's requests with a named-column error instead of
      silently misreading it.
- [ ] 1.2 Add a "bring in changes" view that diffs a connection's current
      shape against a connected table's mapping and lets a builder accept
      added/removed/retyped columns one at a time.
- [ ] 1.3 Add a reconcile record for a connected row's comments, files,
      assignments and similar Featherbase-side additions when the row
      disappears or changes id at the source; add a review list.
- [ ] 1.4 Add a per-table stricter-conflict-catching setting for sources with
      no last-changed column (compare every loaded value instead of none),
      and a persistent notice on the table while it's off.

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
- [ ] 2.5 Add the saved-connection health surface (status, last success,
      failing-since, failing phase, affected table count) and re-test/
      update-password actions on the same page.

## 3. Virtual data sources

- [ ] 3.1 Define the code protocol an app implements to back a table (read
      one row, list rows, count, save, delete) and type it in the shared
      package.
- [ ] 3.2 Validate a registered backing at startup — refuse to bring the
      table online if anything required is missing, naming what's missing.
- [ ] 3.3 Route a backed table's reads and writes through its code instead of
      the database, keeping the same generic list and form screens.
- [ ] 3.4 Refuse a repeating-rows column and exclude backed tables from
      link-integrity checks on delete; say so on the table's own screen.

## 4. Verification (once implemented)

- [ ] 4.1 HTTP tests against a running server for each requirement above,
      following `docs/TESTING.md`.
- [ ] 4.2 Playwright coverage for the connection console's guided flow and
      the drift/reconcile review screens.
- [ ] 4.3 Sync the delta specs into `openspec/specs/` and archive this change.
