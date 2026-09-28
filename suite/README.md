# Manager-owned Gate-3 suite

No candidate or reference Todo app is included. `selftest/` contains **harness-only counter, transport and semantic fault controls**; do not distribute it to candidate workers. Tests import no candidate code. Gate 1/2 approvals supersede older artifact labels; the manager owns integration and candidate launch.

## Run

Use Linux, Node 22+, PostgreSQL 15 binaries, and the lockfile-pinned browsers. Run as a non-root user (`initdb` refuses root):

```sh
npm ci
npx playwright install --with-deps chromium firefox webkit
# Install PostgreSQL 15 via the OS package manager if pg_config is absent.
npm run suite:selftest
npm run suite:list
CANDIDATE_CONFIG=/absolute/path/manager-candidate.json npm run suite:test
```

`PG_BIN` can select another PostgreSQL binary directory; use the **same version for all six**. Every run initializes its own loopback SCRAM-authenticated cluster; every test gets a private database and non-superuser role. There is no external database URL/reset option: retained R1 databases cannot accidentally be reset by this suite. The manager separately retains and backs up R1 data for R2. Disposable backup/restore is tested here.

Copy `manager.example.json` outside candidate code and fill it from published OpenAPI and run instructions. Its routes are examples, not requirements. Commands are argv arrays, executed serially for install/build/check/test, with `DATABASE_URL`, `PORT`, `BASE_URL`. `NODE_ENV` is production except install (development, so build tooling is installed) and tests (test). Use foreground production commands; the harness owns their process groups and teardown. These short-lived test processes are not development services. Commands must not access retained/shared databases or externally deploy. `migrationHistoryQuery` is a manager-reviewed, stably ordered SELECT of applied migration records.

## Mapping, not missing behavior

- Exact `$title`, `$id`, `$proof`, `$completed`, `$filter`, `$key` strings substitute typed arguments; missing arguments are omitted. `$key` is available only if the published API requires a creation request identity. No handler, generated client or application source is loaded.
- `fields` use JSON Pointer; `record` is the single-record envelope, `list` the array envelope. `createId` optionally points to an identity-only creation response. `proofHeader: "etag"` supports header versions instead of `proof`. `pathArgs: {"todoId":"$id"}` supports arbitrary path parameter names.
- For enum completion states, use `fields.stateValues: {"open":"open","completed":"done"}` and operation `values: {"completed":{"true":"done","false":"open"}}`. Keys are JSON-encoded input values, preserving invalid string/boolean distinctions.
- `http.browser` can override operation `{method,path,postDataIncludes}` matching for externally observed server-action transport. The default is the published API route. Matches are same-origin and every injection must record a hit. For server-rendered initial reads, set `http.serverRenderedRead: true`; the suite denies PostgreSQL login and verifies SQLSTATE 28000 instead of pretending a nonexistent browser API request was intercepted.
- Error categories must be distinguishable status/code pairs. Successful request bodies and response bodies/statuses are checked against published OpenAPI 3.1 schemas. Published HTTP `$ref`s are allowed; local filesystem references are disabled. Parameter presence/documentation is checked; comprehensive OpenAPI linting remains a contract-review task.
- If a valid published contract cannot be represented (for example non-scalar identity or a Location-only creation response), change the **manager mapping layer**, disclose the correction, and rerun all affected candidates. Do not change candidate architecture to suit an example mapping or count an adapter limitation as an app failure.

## Coverage and evidence

`tests/http.spec.mjs`: lifecycle/identity/duplicates/filtering, exact title normalization and Unicode boundaries, malformed JSON/types/filter/proof, stale rename/complete/reopen/delete, changed-away-and-back, deletion elsewhere, simultaneous different-field writes, unchanged sentinels, schema validation.

`tests/ui.spec.mjs`: accessible role/name-only interactions; create/edit/filter/persistence; validation/plain text; pending duplicate prevention; failed read and every mutation; committed-but-lost creation response; two-context conflicts with B's already-formed request held until A commits; deleted draft retention; keyboard lifecycle; axe; desktop/mobile/narrow/wide/long-title/text-enlargement geometry. All tests run Chromium desktop/mobile; `@core` flows also run Firefox/WebKit desktop/mobile. Firefox mobile is viewport emulation (not its unsupported `isMobile` option); none is a real device.

`tests/operations.spec.mjs`: production setup, SQL isolation, graceful/forced same-build restart, migration failure/retry/rerun/concurrency/ledger, truthful readiness, database outage/recovery and backup restoration. Timeouts are diagnostic limits, not performance scores. No test retries; readiness polling and eventual UI assertion waits are not write retries.

`suite-results/` retains JSON/HTML results, redacted command output/timings, failed-test traces/screenshots, injection receipts, and only three successful candidate captures: desktop list, mobile long title, conflict draft. `suite-results/selftest/` retains negative-control assertions and browser traces, plus one deliberately overflowing semantic-fixture capture. Inspect captures before sharing. The selftests prove the harness detects specific faulty controls, **not** that a nonexistent candidate passes the complete suite.

Database credentials are generated in memory and redacted from process logs. Browser test data is synthetic and there is no auth; inspect/redact candidate-origin error pages and trace resources before distributing artifacts, since an app could expose credentials in its own response. Never upload raw environment/config dumps.

**Manual/unassessed:** real screen-reader announcements, reading/focus order quality, visible-focus contrast, color-only meaning, actual browser 200% text zoom and real devices. Computed-font doubling and axe are partial automated checks, not WCAG certification. Migration interruption after arbitrary DDL boundaries requires candidate-specific intervention beyond the common denied-write test; do not claim exhaustive crash-point coverage. Manager scores code quality/toolchain/dependency/iteration measurements separately; this suite does not fabricate scores.
