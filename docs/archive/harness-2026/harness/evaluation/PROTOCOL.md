# Evaluation protocol for enhancements (adopted from the PR-2 harness)

`harness/features.json` (the original 126) is frozen — statuses there were
self-verified by the building session, per the original protocol. Everything
built AFTER the 126 uses this stricter, PR-2-style contract instead, because
agents overrate their own work:

1. **Default-FAIL contract.** Every enhancement is listed in
   `enhancements.json` and starts `"passes": false` in `results.json`.
   The session that BUILDS an enhancement may never flip its own entry —
   it only captures evidence (HTTP transcripts, test logs, screenshots)
   under `harness/evidence/<id>/`.
2. **Fresh-context evaluator.** A separate session runs
   `.claude/agents/evaluator.md` ("Grade enhancement <id>") with read-only
   tools. Only that evaluator flips `results.json`, and only after reading
   real evidence. Its `NEEDS_WORK` findings feed the next build session.
3. **Two grading paths** per the enhancement's `eval` tag:
   - `differential` — compare the clone against a REAL Frappe instance (the
     oracle) with `diff-request.sh`: same request to both, volatile fields
     normalized (`normalize.jq`), deep-diff must be empty and status codes
     must match. Requires `FRAPPE_REF` to point at a running Frappe
     (`docker run -p 8080:8080 frappe/bench ...` where Docker Hub is
     reachable); if the oracle is down the evaluator must return NEEDS_WORK,
     never PASS-by-default.
   - `criteria` — a written checklist in `criteria/<id>.yaml` (UI and infra
     features where diffing is noisy), judged check-by-check.

The clone speaks Frappe's wire format (sid-cookie login via
`/api/method/login`, `{data}`/`{message}` envelopes on list/RPC, `exc_type`
errors), which is what makes differential grading meaningful.
