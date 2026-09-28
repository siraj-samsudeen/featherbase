# Engineering requirements

These constraints support the product behavior; they do not prescribe a particular backend framework, ORM, route layout or error envelope.

## From the initial Todo application

- Persist data in PostgreSQL and access it only through the server. Use safe parameterized data access and render user text literally.
- Provide reproducible install, build, check, test and production-start commands with locked dependencies. Document the HTTP operations and database setup.
- Keep credentials outside source and logs. Normal startup never resets or reseeds user data.
- Keep the implementation specific to the current product needs. Generic application extraction belongs to change 5.

## From priority and API contracts

- Use an established versioned migration tool, committed migrations and a migration command separate from normal web startup. Do not invent migration bookkeeping. Document unsupported native-tool behavior and use a supported compatible tool rather than silently weakening data guarantees.
- Keep a single authoritative source for endpoint schemas, derived browser request/response types and generated OpenAPI 3.1. Prefer supported framework facilities; add integrations only where needed to meet the contract.
- Runtime-check incoming requests and outgoing application JSON, including errors, required fields, types and declared restrictions. Raw responses and casts must not escape those checks. Serialization and generated documentation alone are not validation.
- Document and test business rules that cannot be expressed in structural schemas. Browser runtime response validation is optional; server runtime checks are required.
- Demonstrate contract safety with an incompatible-change client compilation failure and tests of actual outgoing handler paths containing invalid fields/values. Remove temporary faults afterwards. Verify fresh, populated, repeated, failed/retried and concurrent migrations against disposable databases as well as normal populated upgrades.

## From Projects and reliable editing

- Keep relation integrity, version checks and writes atomic. Preserve each unresolved operation's identity and values independently of unrelated UI actions.
- Readiness reflects usable database/schema state. Shutdown controls the actual application instance, including any daemon-owned process; restart does not reset data or leave a duplicate listener.
- Verify committed-but-lost replies and competing writes, not only failures before requests reach the server. Back up populated data and verify restoration before schema transitions.

## From everyday usability

- Reuse accessible controls and consistent visual tokens. Test direct input Enter/Escape, not only Enter after tabbing to a button.
- Assert focus after rendering settles. Exercise default, pending, invalid, uncertain and conflicting states; inspect rendered desktop and mobile layouts.
- Automated accessibility checks do not establish screen-reader usability, actual browser zoom or physical-device behavior. Record unperformed checks honestly rather than claiming certification.

## From declarative extraction

- Keep application declarations, trusted extension implementations and framework core separate. No resource-name conditionals or copied resource implementations in the generic core.
- Runtime definitions drive dynamic field validation and API documentation; static types cover the generic protocol without pretending to know fields introduced after compilation.
- Document extension types, order, transaction boundaries and failure/side-effect semantics. Do not claim an external side effect is transactional or exactly-once without providing that guarantee.
- Preserve the populated application's APIs and behavior through extraction. Add Milestones through the public definition/extension mechanism, not an internal shortcut.
