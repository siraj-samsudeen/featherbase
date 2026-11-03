# ADR Review Manifest

- Status: completed
- Review date: 2026-11-03

## Review Summary

ADR review completed for this change. The theme attribute and event are one more entry in the app/platform
contract ADR 0011 already defines (declared extension points, VS Code style), delivered the way #650
delivered `featherbase:bar-change` and `--featherbase-bar-height`. No new boundary, dependency, data model,
migration or security policy is introduced.

## In-Force ADRs Reviewed

- ADR 0011 (platform, app, instance) and ADR 0013 (client and product apps): an app reaches the platform only
  through declared extension points; this adds one and the platform still never reads the app's internals.
- ADR 0014 (one repo for platform and apps): the fixture app stays under `test-apps/`.
- ADR 0015 (ADRs are never edited): no ADR file is touched.

## New Durable ADRs Created

None. No major durable architectural decisions were introduced and no new repository-level ADR files were
created.
