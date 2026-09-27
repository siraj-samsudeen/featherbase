---
id: one-time-generated-application
kind: design-option
title: One-time generated application
disposition: rejected
order: 87
parent: runtime-application-package
summary: Generate a standalone editable codebase from declarations and remove the Featherbase runtime dependency.
related:
  - whole-custom-client
  - application-extraction-import
---

# One-time generated application

## Question considered

Should Featherbase behave like JHipster and emit an ordinary standalone
application that developers or agents edit directly afterward?

## Advantages

- The generated application has no runtime dependency on Featherbase.
- Every generated file can be changed without framework extension limits.

## Costs

- Once generated files change, regeneration and framework upgrades become a
  merge problem.
- The declaration can stop being the source of truth.
- Improvements to a shared capability do not automatically reach applications
  that copied it into generated code.

## Decision and revisit condition

Rejected as Featherbase's primary model. Durable declarations remain
authoritative and ordinary code connects through named extension points. A
future export may produce a standalone application, but it must be described as
leaving the managed Featherbase capability model rather than round-trippable
generation.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md)

**Related capabilities:** [Whole custom client](../packaging-and-escape-hatches/whole-custom-client.md), [Application extraction and import](../packaging-and-escape-hatches/application-extraction-import.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
