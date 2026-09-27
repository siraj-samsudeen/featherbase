---
id: shared-multitenant-saas-runtime
kind: design-option
title: Shared multitenant SaaS runtime
disposition: deferred
order: 84
parent: packaging-escape-hatches
summary: Operate unrelated customers inside one provider-owned Featherbase application runtime and database boundary.
related:
  - runtime-application-package
  - application-extraction-import
---

# Shared multitenant SaaS runtime

## Question considered

Should Featherbase operate like Salesforce or Airtable, with unrelated
customers sharing a provider-controlled runtime?

## Advantages

- Customers avoid installation and routine platform operations.
- Central upgrades, security work and capacity management can improve every
  customer at once.
- Shared operation can produce economies of scale and a larger ecosystem.

## Costs

- Provider limits, release decisions and commercial terms become part of every
  customer's application.
- Moving the complete application and operating environment elsewhere becomes
  exceptional rather than normal.
- Tenant isolation and noisy-neighbor controls add substantial complexity
  before the core application model is proven.

## Decision and revisit condition

Deferred. The initial product is one customer per self-hostable installation;
a managed offering runs that same product. Revisit shared multitenancy only if
managed operation creates a demonstrated need that cannot be met by automating
many isolated customer installations.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Packaging and escape hatches](../packaging-and-escape-hatches/README.md)

**Related capabilities:** [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md), [Application extraction and import](../packaging-and-escape-hatches/application-extraction-import.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
