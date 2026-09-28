# A simple Todo application

## Why

People need a shared place to write down work and return to it later. Start with the smallest useful application: a persistent list of editable Todos.

## What Changes

- Create, view, rename and delete Todos through a browser and JSON HTTP API.
- Store stable identities and titles in PostgreSQL; preserve changes across reloads and restarts.
- Keep this first release free of priorities, Projects, completion, custom validation and conflict workflows.

## Capabilities

### New Capabilities
- `basic-todos`: Persistent Todo CRUD.

### Modified Capabilities
None.

## Impact

Introduces the initial application and database schema. No account is required; everyone uses the same shared list. Later changes build on this data rather than replacing the application.
