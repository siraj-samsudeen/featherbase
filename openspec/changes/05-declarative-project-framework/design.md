# Design

## Context

The existing application supplies concrete reusable behavior. See [declarative applications](specs/declarative-applications/spec.md) and [Milestones](specs/project-milestones/spec.md).

## Goals / Non-Goals

Extract the working Todo/Project application and extend it with Milestones through the public framework interface. Do not build a universal workflow language, untrusted plugin sandbox, account system or permission engine.

## Decisions

Separate resource declarations, generic execution and named trusted extensions. Declarations describe fields, relations, constraints and presentation; the generic engine supplies standard data/API/UI behavior. Unsupported custom behavior is registered outside the core and referenced by name.

Keep definition migration and activation explicit. Dynamic fields use runtime validation from the active definition; static types cover the generic protocol. Unknown extension references reject activation rather than leaving a partially usable application.

Build Milestones only after the existing app runs declaratively. Its resource, Project relationship and presentation use the same interface; no new resource-specific core branch is permitted.

## Risks / Trade-offs

Moving copied code under a framework directory does not make it generic. Public definition activation and extension tests must demonstrate the boundary. Validation extensions participate in the write's failure semantics; external side effects are not automatically transactional.

## Migration Plan

Preserve existing data and public behavior through extraction, then add Milestones with an explicit migration. Invalid declarations leave the previous application active. Verify backups before schema transitions and do not assume rollback can safely discard new user data.
