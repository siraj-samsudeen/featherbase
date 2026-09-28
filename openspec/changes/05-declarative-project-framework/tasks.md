# Tasks

## 1. Extract the existing application
- [ ] 1.1 Define the resource vocabulary and typed named extension contracts; document declaration examples, invocation order, transaction boundaries and failure semantics.
- [ ] 1.2 Move standard persistence/API/UI behavior into a generic implementation and define Todos/Projects declaratively; verify all existing behavior and populated data survive without resource-specific core branches.
- [ ] 1.3 Implement explicit definition migration/activation; verify same-build activation, invalid-definition preservation of the previous app and active-definition API documentation.

## 2. Extend project management
- [ ] 2.1 Add Milestones through declarations and named extensions where necessary; verify CRUD, Project scoping, reference protection and restart persistence without core edits or copied handlers/forms.
- [ ] 2.2 Exercise registered server validators and field presenters; verify rejection leaves no partial writes, unknown names fail activation, and keyboard/error behavior survives custom presentation.
- [ ] 2.3 Document how to define and extend the complete application; run cumulative API, migration, recovery and UI checks against the declarative implementation.
