## 1. Tests first

- [x] 1.1 person-scope: a missing optional Table is not available and the rest of the scope stands; an installed one reads as before; undeclared or unmarked is not available; reading an unavailable Table still refuses the scope; `available` is one at a time and only while the provider runs
- [x] 1.2 instance-health: a missing optional Table passes and is named; a missing required one still fails
- [x] 1.3 Loading a provider that names an optional Table it doesn't read, or one of its own Tables, is refused

## 2. Platform

- [x] 2.1 `documents.available(table)` in the scope provider context (shared type and server)
- [x] 2.2 `scopeProvider.optionalTables` in the manifest schema, the binding and the health check
