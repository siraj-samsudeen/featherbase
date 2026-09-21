## 1. Server handoff

- [ ] 1.1 Preserve the exact runtime-app path and encoded query in canonical login's
  `next` parameter, verified by root, nested, encoded-query, non-app, and malformed
  server navigation tests.

## 2. Client return

- [ ] 2.1 Restrict login returns to canonical Featherbase or shared runtime-app
  routes and verify external, ambiguous, technical, legacy, and malformed inputs
  fall back safely.
- [ ] 2.2 Merge an inherited login-page fragment only when the validated destination
  has no explicit fragment, verified by asymmetric root/query/hash unit tests.

## 3. Journey and gates

- [ ] 3.1 Add a real browser password-login journey from a runtime-app deep link to
  the same query and selected-work fragment, and inspect the selected work state.
- [ ] 3.2 Run affected suites and typechecks plus strict OpenSpec, evidence, and STC;
  record the exact isolated database and ports used.
- [ ] 3.3 Archive the proven change and rerun strict OpenSpec, policy, and STC checks.
