# Dependable API contracts

## Purpose

Provide application consumers with discoverable JSON operations whose documented structure, runtime behavior and client types agree.

## ADDED Requirements

### Requirement: Publish the application contract

The application MUST serve a generated OpenAPI 3.1 document describing its operations, inputs, successful responses and distinguishable invalid-input, missing-record and server errors. An ordinary HTTP client MUST be able to use every operation without application source. Business rules not expressible in the structural schema MUST be documented separately.

#### Scenario: Use the API independently
- **WHEN** a client reads the published document
- **THEN** it can create, list, read, update and delete Todos and interpret their responses and errors.

### Requirement: Enforce input and output structure

Incoming requests and outgoing application JSON MUST be runtime-checked against their declared constraints, including required fields, primitive types and restricted values. Invalid input MUST fail without writes. Invalid application output MUST produce a controlled server error rather than a successful invalid payload. Raw responses, type assertions and serialization coercion MUST NOT bypass these guarantees.

#### Scenario: Invalid data crosses a boundary
- **WHEN** a request contains an invalid priority or malformed JSON
- **THEN** it receives a documented client error, changes no saved data and leaves valid requests usable.
- **WHEN** application code produces a missing required field, wrong primitive type or forbidden priority in a response
- **THEN** the outgoing boundary rejects it instead of sending it as a valid success.

### Requirement: Keep browser contracts aligned

Browser request and response types MUST derive from the server contract. An incompatible change MUST be detectable by client type checking rather than hidden behind separately maintained interfaces or unchecked fetch assertions. Browser runtime response validation is not required.

#### Scenario: An endpoint changes incompatibly
- **WHEN** a response field used by the browser changes to an incompatible type without updating its consumer
- **THEN** client type checking fails.
