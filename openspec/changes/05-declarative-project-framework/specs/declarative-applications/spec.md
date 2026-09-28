# Declarative applications

## Purpose

Let application authors define and extend project-management features without duplicating persistence, API contracts, forms or lists.

## ADDED Requirements

### Requirement: Define the existing application declaratively

The Todo and Project application MUST be expressed through inspectable declarations covering resources, fields, defaults, constraints, relationships, standard actions, filters and list/form presentation. Generic framework behavior MUST supply ordinary persistence, API and UI paths. Existing identities, data, deletions and previously specified behavior MUST survive extraction. Renamed copies of resource-specific controllers, clients, forms or lists do not satisfy this requirement.

#### Scenario: Continue using the extracted application
- **WHEN** the populated application is upgraded to the declarative implementation
- **THEN** users can perform the same actions with the same saved records, validation, recovery and keyboard behavior.

### Requirement: Activate definitions at runtime

Resource definitions MUST load without rebuilding the server or browser. Explicit schema migration and activation MUST preserve existing data; ordinary requests MUST NOT trigger incidental schema changes. Invalid definitions MUST fail activation with an explanation while leaving the previous definition usable. Runtime fields MUST be checked against the active definition, and published API documentation MUST reflect it. Static types describe the generic protocol; fields added after compilation do not require fabricated compile-time types.

#### Scenario: Add a resource
- **WHEN** an author adds a valid resource definition and explicitly migrates and activates it
- **THEN** its API, forms, lists and constraints become available through the existing build without resource-specific core edits.

### Requirement: Extend through named contracts

Behavior not supported by declarations MUST attach through documented named extension points referenced by the application definition. Extension code MUST stay outside framework core. Each point MUST define typed inputs/outputs, invocation order, transaction boundaries, failure handling and allowed side effects. Extensions MUST preserve standard validation, concurrency and recovery guarantees. Unknown names or incompatible bindings MUST fail activation before replacing the working application.

At minimum, application authors MUST be able to register custom server validation and custom field presentation. A rejecting validation extension MUST leave no partial writes. A field presenter MUST retain accessible labels, keyboard access and error association. Trusted extension code can be registered at build or startup; runtime definitions select it by name. Arbitrary untrusted-code execution and hot-loading executable code are not required.

#### Scenario: Use a custom validator and presenter
- **WHEN** an application definition references a registered validator and field presenter
- **THEN** direct API and browser writes enforce the validator without partial changes, and the custom field remains usable by keyboard with associated errors.
- **WHEN** the definition references an unknown extension
- **THEN** activation reports its name and reason and the previously active application remains usable.
