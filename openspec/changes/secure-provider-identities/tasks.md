## 1. Contract and proof environment

- [x] 1.1 Confirm the fail-closed Google freshness limitation and exact-target operator recovery described in design.md without weakening the owner's two-proof rule; verify the implementation starts from the separately committed authentication baseline and strict `pnpm exec openspec validate secure-provider-identities --strict --no-interactive` passes.
- [x] 1.2 Load the available TDD workflow (the named mattpocock skill was not available in the planning session); create directly local, worker-owned stamped disposable test and browser databases and supervised API/web services; verify the existing login → Table list → form journey before behavior changes without using init.sh's unmanaged server-launch path in an orb.

## 2. Provider-neutral ownership and sessions

- [x] 2.1 Write failing tests for two unrelated provider subjects, same-email/different-subject refusal, changed-email/same-subject continuity and nullable-email User creation; add protected External Identity/provider storage and optional User email/native-method metadata; verify asymmetric tests, generic-API denial and reserved-table-name/SQL qualification checks pass.
- [x] 2.2 Write failing tests for legacy JWT refusal, logout revocation, expiry, two sessions on one User and disable/re-enable non-resurrection; add durable Login Sessions and User/provider/identity generations; verify each test moves red → green without a stateless fallback.
- [x] 2.3 Make session issuance and identity mutation serialize with disable/unlink; verify two independent database connections racing disable against issuance and two Users claiming one subject yield no surviving invalid session and at most one owner in a dedicated disposable committed-proof database.
- [x] 2.4 Update every session issuance/consumption path, including handoff, native login, preview and test harness, without manufacturing reauthentication evidence; verify handoff revoked-between-callback-and-redemption fails and shared server/web fixture authentication still works.
- [x] 2.5 Test native method/reset eligibility and password-change revocation before implementing it; verify a contact-email-only external User cannot obtain a local password by reset or ordinary assignment and existing Administrator native login remains available.
- [ ] 2.6 Revalidate WebSocket subscriptions and queued deliveries using the same session authority; verify a socket authenticated before User disable, provider disable, unlink or logout receives no newly authorized event and closes, while an unrelated valid session still receives events in order.

## 3. Hosted Google foundation

- [ ] 3.1 Select a maintained OIDC client based on authoritative supported Google/Microsoft flows and pin its dependency; build a test-only loopback OIDC issuer with real signing and code redemption; verify normal runtime cannot be configured to trust that synthetic issuer and no real credentials are needed.
- [ ] 3.2 Replace Google email resolution with validated issuer/subject and durable browser-bound operations; verify red → green hosted redirect/callback cases for valid proof and wrong issuer/audience/signature/nonce, missing cookie/verifier, code replay, expiration, subject change and provider disable during consent.
- [ ] 3.3 Implement source freshness evidence separately from ordinary login; verify absent/stale/future/malformed auth_time, fresh iat with old auth_time, another subject's proof, and expiry between source proof and target completion all refuse sensitive mutation without unnecessarily refusing ordinary Google login.
- [ ] 3.4 Preserve exact safe Tasker return state through hosted login and replace the single-provider login UI with discovered enabled methods; verify component behavior plus real-browser Tasker query/fragment return, disabled/missing-provider states and accessible native-vs-hosted controls.

## 4. Enrollment, linking and recovery

- [ ] 4.1 Implement manager-issued one-use initial invitations only for new never-enrolled Users; verify wrong User/provider, expiry, replay, already-owned subject and legacy-account enrollment refuse without account or privilege changes.
- [ ] 4.2 Implement session-bound source reauthentication then fresh target-provider proof for one linking operation; verify two distinct Google subjects can resolve one User, separate people remain distinct, stale/different-browser/source-revoked attempts fail, and concurrent subject ownership is atomic.
- [ ] 4.3 Add unlink and last-method protection with retained ownership tombstones; verify unlink revokes only dependent sessions/operations, prevents cross-User reclamation, and refuses last-method removal until a replacement is actually proved.
- [ ] 4.4 Add exact-target controlled recovery with fresh operator proof and independent verification-method/case recording; verify invitation plus attacker-chosen identity alone cannot bind, stale operator proof fails, disabled Users remain disabled, approval cannot be replayed or substituted, and old sessions are revoked.
- [ ] 4.5 Add account-method and manager enrollment/recovery UI in existing styles; verify browser paths reached by clicks for successful link, stale-Google refusal, collision, last-method refusal and recovery approval, then inspect representative screenshots.
- [ ] 4.6 Prove the three-Google-identity acceptance journey with generic fixtures only: one preprovisioned User initially enrolls one personal-context identity and explicitly links two different Workspace-context subjects; independent logins preserve the same User, Tasker rows/roles/preferences; collision refuses atomically, disable revokes all three sessions, unlink protects recovery, and stale source evidence follows controlled recovery. Do not use actual owner addresses except in a later explicitly authorized private acceptance setup.

## 5. Microsoft, StyleHR gate and cross-provider safety

- [ ] 5.1 Add hosted Microsoft organizational/personal provider using documented multi-tenant issuer validation; verify real protocol exchange against the synthetic issuer, public redirect construction, tenant/subject collision isolation and no retained long-lived tokens.
- [ ] 5.2 Add the non-activatable StyleHR boundary without a password form or verifier cache; verify configuration and direct credential submissions fail before upstream calls/storage. Exercise provider-neutral credential outcomes with a clearly synthetic adapter only, not a claim of live StyleHR compatibility.
- [ ] 5.3 Prove heterogeneous-user access and whole-User offboarding A: separate Google/Microsoft/synthetic credential Users retain their own Tasker identity/permissions; one multi-linked User loses all sessions and pending operations on disable; provider-only disable leaves unrelated-provider sessions valid; re-enable never revives old sessions.
- [ ] 5.4 Apply shared provider-separated rate limits, typed safe provider errors and allowlisted audit; verify cross-process admission before exchange and sentinel passwords/hashes/tokens/codes/raw response fragments absent from HTTP responses, captured application logs and audit.

## 6. Final integration and handoff

- [ ] 6.1 Prove fresh database install and migration from the baseline with existing native, legacy Google and disabled Users; verify no automatic subject backfill, no fabricated emails, preserved Tasker assignments/history, and metadata/storage access guards.
- [ ] 6.2 Add matching descriptive `@spec` markers at deciding code and asymmetric tests; retire replaced baseline markers only with the governed behavior change; run focused suites, complete server/web/shared tests, typechecks, SQL lint, strict OpenSpec and `pnpm check:specs` without weakening STC baselines.
- [ ] 6.3 Obtain independent final-diff review using the repository code/spec/test axes, plus scoped Oracle review of the actual final linking/revocation races; fix and independently re-review substantive findings, then rerun relevant verification in the coordinator workspace.
- [ ] 6.4 Run Prove Before Handoff with deterministic fake identities, inspected browser evidence and independent exploration of the running build; document unavailable live-provider configuration and StyleHR activation distinctly from synthetic proof; prepare a PR without merge/deploy/shared-data writes and report exact commands, artifacts and remaining gates to the parent.

## Evidence boundary for the rejected password-cache proposal

No cache is being built. Same-password cache hits, TTL expiry and acceptance of an
old password before cache expiry therefore are not promises to test or claim. If
StyleHR is later activated, its separate contract must prove each fresh attempt
goes online, changed passwords reject immediately according to upstream, and an
outage after prior success cannot create a new session. The gate tests in 5.2 do
not claim any live upstream behavior. No production deployment or real-credential
test is needed to complete the provider-neutral foundation.
