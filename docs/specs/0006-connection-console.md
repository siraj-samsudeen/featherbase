# Feature: Connection Console — connect a Data Source through the UI

**IDs:** `CONN-J*` journeys · `CONN-R*` rules · `CONN-I*` invariants ·
`CONN-H*` hazards · `Q*` questions
**Evidence:** `docs/specs/evidence/connection-console.csv` (never status in this file)
**Provenance:** owner session 2026-08-11 (VMS/MySQL connection attempt).
The owner ratified five requirements after a three-variant UI prototype
(branch `claude/vms-database-connection-test-e19799`; the "connection
console" variant won). Extends spec 0001 (External Data Sources): the
env-var credential mode (EDS-1) survives as the infra-as-code path; this
spec adds the human path. Depends on the `mysql` engine (in flight,
separate session).

## The job

CONN-J1 — "I was given a host, database, user, and password for a MySQL
system called VMS. I want to connect it and see its tables in
Featherbase — without touching environment variables, Railway, or a
redeploy — and when the connection fails I want to know exactly which
step failed and what to tell the DBA."

CONN-J2 — "A source that worked for weeks broke. I need to see when it
broke, which step fails now, fix the credential, and confirm it's
healthy — without recreating anything."

## Prior state *(residue-shaped)*

A reachable SQL engine the tests control: the local MySQL instance the
`mysql`-engine feature seeds for its own verification (tables with and
without primary keys, a read-only user and a read-write user). The
motivating real-world instance — MySQL 8.4.10 on RDS, database `vms`,
user `analyst`, `caching_sha2_password`, TLS — is the acceptance
scenario, not a test dependency.

**Limits, stated on purpose:** journeys exercise MySQL only; Postgres
shares every rule via the engine-parametrised properties, and DuckDB /
CSV folder are out of scope here (different credential shapes, CONN-R3).

## CONN-J1 — Connect VMS, diagnose, reflect *(shape: sequence)*

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J1.1 | Admin, "Connect a data source", signed in as System Manager | One page: engine selector, source name, credential form, and a **Live checks** panel listing the five phases, all pending | R3, R4 |
| J1.2 | Pick **MySQL**; type host/database/user/password (or paste a `mysql://` URL) | Fields and the Connection URL stay in sync both ways; the URL view always shows the password as `••••••••` | R2 |
| J1.3 | Click **Test connection** against a firewalled host | Checks run in order; **Reach the port** turns ✕ with its diagnosis inline under that row (firewall/security-group hint, "password not checked yet"); later phases stay pending | R4 |
| J1.4 | Firewall fixed; **Retry** | All five checks ✓; a success card with server version, TLS state, latency, and the **grants verdict** for the user | R4, R6 |
| J1.5 | Open the **Database** field | It is now a dropdown of the databases this user can actually read, current value preselected | R5 |
| J1.6 | **Save & choose tables** | The source is saved (`conn_status: ok`, stamped); landed on the table picker — its own page, back-navigable to the console | R1, R8 |
| J1.7 | Pick tables, **Reflect** | Reflected Tables appear in the Admin sidebar (per spec 0001) | — |

**Branch at J1.3 — wrong password.** Port ✓, TLS ✓, **Authenticate** ✕
with its own inline hint (network path works; check the password / that
the user exists). *(→ R4)*
**Branch at J1.4 — user can write.** Success card shows the grants
verdict as a warning: the database user can modify data, Featherbase's
read-only flag is a guard rail, ask for a SELECT-only user. *(→ R6)*
**Branch at J1.1 — not a manager.** The connect affordance is absent;
the underlying actions already refuse non-managers (spec 0001, P3).
**Isolation strategy:** the journey creates its source under a
journey-owned name against the local MySQL and deletes it at the end;
failure phases are reached with deliberately wrong inputs (unroutable
host, wrong password), never by mutating shared state. A skip is never
a pass.

## CONN-J2 — Broken source: see it, fix it, prove it *(deltas from J1 only)*

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J2.1 | The saved source, after its password was rotated out from under it | Health surface: status **unreachable/error**, last successful check, **failing since** + failing phase, and the count of reflected Tables affected | R8 |
| J2.2 | **Re-test connection** | The same console as J1: DNS ✓ · port ✓ · TLS ✓ · **Authenticate ✕** — the failing step is visible, not inferred | R4, R8 |
| J2.3 | **Update password** (write-only field), re-test | All checks ✓; status returns to ok with a fresh stamp | R1, R8 |

**Isolation strategy:** the rotation is performed by the test against
its own MySQL user; the source under test is journey-owned.

## Closure sweep

- **actors & permissions:** System Manager only, inherited from spec
  0001 P3; the connect affordance is absent for others (J1 branch).
- **prior state & lifecycle (incl. reversal):** editing a saved source
  re-opens the same console (R8); deleting a source is spec 0001's
  concern; a saved password is replaceable but never readable (R1).
- **concurrency & retries:** re-running test_connection is idempotent
  and re-stamps `last_checked_at`; two concurrent tests may interleave
  but both write only status fields (last writer wins — acceptable).
- **external-dependency failure:** is the feature itself — R4 classifies
  every failure mode into a phase with a hint.
- **durability & recovery:** CONN-H2 (master-key loss); encrypted
  credentials survive restarts; losing the key means re-entering
  passwords, never silent decryption failure at query time (Q1).
- **security & privacy:** CONN-I1 — the password never leaves the
  server once stored; CONN-H1 — public-login deployments.
- **accessibility:** check states are conveyed by text (✓/✕ plus the
  phase name and hint), never colour alone.
- **performance & scale:** a test_connection attempt is bounded by the
  existing per-source `statement_timeout_ms` and a connect timeout; the
  UI never hangs past it (the timeout IS a classified outcome).
- **observability:** `conn_status`, `last_checked_at`, and the failing
  phase are stored on the row (R8) — health is queryable, not only
  visible.
- **compound hazards:** H1, H2.

## The rules

### CONN-R1 — Typed credentials, stored encrypted, write-only · `shape: contract`
The Data Source row gains discrete connection fields (host, port,
database, user) and an encrypted password. `POST /api/table/Data Source`
and `POST /api/table/Data Source/:name` accept a plaintext `password`
field and store it encrypted under a single server master key
(`CREDENTIALS_KEY`); **no read path returns it** — reads serve a masked
sentinel, and sending the sentinel (or omitting the field) on edit keeps
the stored secret. When `url_env` is set (the EDS-1 infra-as-code mode,
now under Advanced — R7), it wins and the password field is disabled.
**Property:** for every saved source, no API response body contains the
stored password in any encoding.

### CONN-R2 — URL and fields are two views of one state · `shape: rule`
**Property:** parse(render(fields)) = fields for every field edit, and
render(parse(url)) masks exactly the password segment — pasting a URL
containing the mask sentinel never overwrites the stored secret.
| Input | → | Why? |
|---|---|---|
| Edit Database field to `vms_prod` | URL view rewrites `…/vms_prod`, password still `••••••••` | fields → URL |
| Paste `mysql://analyst:hunter2@h:3306/vms` | all five fields fill, password field holds `hunter2`, URL view re-masks | URL → fields |
| Paste the displayed (masked) URL back | stored password unchanged | the mask is not a value |
| Paste `http://example.com` | fields unchanged, no error while typing | not a DB URL |

### CONN-R3 — The engine selector drives the form · `shape: rule`
Selecting an engine sets the URL scheme, swaps the default port
(3306 ↔ 5432) only when the current port is a default, and swaps the
credential form for engines whose credentials are not host-shaped
(DuckDB: token/path; CSV folder: directory path).
| Input | → | Why? |
|---|---|---|
| MySQL → Postgres, port untouched | port becomes 5432, scheme `postgres://` | defaults follow engine |
| MySQL → Postgres, port hand-set 3307 | port stays 3307 | never clobber intent |
| → DuckDB | host/port/database/user/password form replaced | different credential shape |

### CONN-R4 — Phased test with inline diagnosis · `shape: contract`
`POST /api/table/Data Source/:name:test_connection` returns per-phase
results — resolve DNS · reach the port · negotiate TLS · authenticate ·
check read access — each `ok`/`failed`/`skipped`, the first failure
carrying a classified hint (timeout → firewall/security-group; DNS →
host name; TLS → mode mismatch; auth → credential; unknown database →
name). The UI renders the diagnosis **inside the failing check's row**;
phases after the failure are pending, never falsely red. Raw driver
errors are classified server-side and never shown verbatim (and never
contain the URL or password — spec 0001's scrubbing rule).
Behaviours: a timeout explicitly states the password was not yet
checked; `conn_status` and `last_checked_at` are stamped on every run.

### CONN-R5 — Database dropdown after authentication · `shape: contract`
Once host/user/password authenticate, the Database field becomes a
dropdown of databases the connected user can read (MySQL:
`SHOW DATABASES` minus system schemas; Postgres: catalog equivalent),
served by an introspection action on the source; current value
preselected; free-text entry remains possible (a database the user
cannot list may still be readable).

### CONN-R6 — Success verifies grants, not promises · `shape: contract`
A fully-successful test also reports the user's effective privileges on
the target database (MySQL: `SHOW GRANTS`). SELECT-only → stated as
"read-only enforced by the database". Any write privilege while the
source is `read_only` → a warning naming the privileges and stating
that Featherbase's flag is a guard rail, not the boundary (the wording
already in the Data Source description). The `access` flag's behaviour
itself is unchanged (→ I2).

### CONN-R7 — Advanced disclosure · `shape: rule`
Pool max, statement timeout, table allowlist, and `url_env` mode live in
a collapsed **Advanced** section — present on every engine, closed by
default, never required for the first connection.
*(none — an example table would only restate the enumeration.)*

### CONN-R8 — A saved source keeps its health visible · `shape: rule`
The saved source surfaces `conn_status`, last successful check, and — on
failure — failing-since, the failing phase, and the count of reflected
Tables affected. **Re-test** re-opens the J1 console against the saved
source; **Update password** is the R1 write-only edit. The console is
one surface used at creation and forever after, not a create-only
wizard.
**Property:** for every source, `last_checked_at` is monotonically
non-decreasing and always reflects the most recent test run.

### Invariants
- **CONN-I1 — the secret stays server-side.** After initial entry, the
  plaintext password appears in no API response, no error message, no
  log line, and no client-side state beyond the field the user typed
  into; every rendered URL masks it.
- **CONN-I2 — grants inform, access enforces.** R6's grant report never
  changes write behaviour: a `read_only` source refuses writes
  identically whether the database user could write or not.

### Hazards
- **CONN-H1 — public-login deployments.** On an instance with a known
  admin password (featherbase-dev today), a UI-stored credential exposes
  the connected database to anyone. Mitigation is operational (don't
  attach real sources there — standing owner rule), but the connect page
  must at least state that saved sources are readable by every System
  Manager.
- **CONN-H2 — master-key loss.** `CREDENTIALS_KEY` lost or rotated
  without re-encryption makes every stored password undecryptable. The
  failure must be explicit at connect time ("credential cannot be
  decrypted — re-enter the password"), never a silent auth failure
  attributed to the database. *(→ Q1)*

## Open questions *(arbiter: Siraj)*

| # | Question | Blocked on |
|---|---|---|
| Q1 | Master-key rotation: is "re-enter every password" acceptable, or do we need dual-key re-encryption? | first real deployment with >2 sources |
| Q2 | Scheduled health checks (the "nightly" in J2's mock): do sources self-test on a cron, or only on demand? | background-job budget decision |
| Q3 | Does the console replace the existing SourceBrowser page (`/admin/source/:name`) or embed beside it? | fold-in of the winning prototype |
