---
name: proving-before-handoff
description: Use Prove Before Handoff when asked to “prove before handoff”, “ready for me to test”, “hand this build over”, or whenever a development build is complete and about to be offered to its owner.
---

# Prove Before Handoff

## 1. Prepare

Reset only a clearly identified loopback local development database or a dedicated disposable/test database. Never reset shared QA, staging, production, an external service, or production data. Create deterministic, realistic scenarios from the product discussion. Keep development scenarios outside production installation artifacts; never ship demo/test rows as production install fixtures unless that is an explicit product requirement.

## 2. Prove

Exercise automated happy paths and boundary/edge paths at the right test layers. Then ask an independent agent to explore the running, seeded product as a user. Every finding needs reproducible evidence. Fix findings and rerun both the affected checks and the relevant journey until no correctness or usability blocker remains. Record legitimate deferred gaps rather than hiding them.

## 3. Hand off

Give the owner the URL and credentials, name the seeded scenarios/rows, suggest exactly three useful things to try, summarize verification results, and link the inspected screenshots or other live artifact. State known gaps. The owner should spend attention on product judgment, not rediscovering broken paths.
