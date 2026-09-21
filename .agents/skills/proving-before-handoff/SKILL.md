---
name: proving-before-handoff
description: Use Prove Before Handoff when asked to “prove before handoff”, “ready for me to test”, “hand this build over”, or whenever a development build is complete and about to be offered to its owner.
---

# Prove Before Handoff

## 1. Prepare

Reset under standing authorization only after positively identifying a local
Featherbase database stamped `development` whose PostgreSQL server is directly
local—not merely reachable through loopback. A dedicated disposable/test database
may be reset only by a proof explicitly expecting its `test` stamp. Never treat a
loopback URL as proof of locality. SSH tunnels, port forwards, reverse or
transparent proxies, shared development databases, QA, staging, production,
external services, and production data are excluded. The identity checks close
detectable redirect, environment, and remote-database mistakes; they cannot prove
that no transparent proxy exists, so policy forbids proxies. Create deterministic,
realistic scenarios from the product discussion. Keep development scenarios outside
production installation artifacts; never ship demo/test rows as production install
fixtures unless that is an explicit product requirement.

## 2. Prove

Exercise automated happy paths and boundary/edge paths at the right test layers. Then ask an independent agent to explore the running, seeded product as a user. Every finding needs reproducible evidence. Fix findings and rerun both the affected checks and the relevant journey until no correctness or usability blocker remains. Record legitimate deferred gaps rather than hiding them.

## 3. Hand off

Give the owner the URL and credentials, name the seeded scenarios/rows, suggest exactly three useful things to try, summarize verification results, and link the inspected screenshots or other live artifact. State known gaps. The owner should spend attention on product judgment, not rediscovering broken paths.
