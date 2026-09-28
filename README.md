# Project management, from Todos to a declarative application

Start with a simple shared Todo list. Evolve it into a project-management application, then extract reusable application behavior into a framework and use that framework to add Milestones.

## Product evolution

These changes are ordered and cumulative. Each introduces only its own scope; later features are not prerequisites for the first working application. Existing data and behavior carry forward.

| Change | Product outcome |
| --- | --- |
| [1. Basic Todos](openspec/changes/01-basic-todos/proposal.md) | Create, read, rename and delete persisted Todos. |
| [2. Priority and API contracts](openspec/changes/02-task-priority-and-contracts/proposal.md) | Introduce priority, then require it without losing existing data; provide typed, validated APIs. |
| [3. Projects and reliable editing](openspec/changes/03-projects-and-reliable-editing/proposal.md) | Organize Todos, complete/filter work and recover safely from conflicting or failed edits. |
| [4. Everyday usability](openspec/changes/04-keyboard-and-ui-polish/proposal.md) | Consistent keyboard behavior, focus, feedback, accessibility and responsive layouts. |
| [5. Declarative application and Milestones](openspec/changes/05-declarative-project-framework/proposal.md) | Define the existing app declaratively, provide named extension points and add Project Milestones using the framework. |

Each change contains a proposal, behavior specifications, technical design and implementation tasks. [Engineering requirements](ENGINEERING.md) describe shared constraints and when they begin to apply. The numbered changes describe planned product increments, not an already implemented application. `openspec/specs/` receives the implemented specifications through the normal OpenSpec lifecycle.

This scope ends with Milestones. Accounts, users, guests, permissions, assignments, scheduling and task dependencies are not included. They can be introduced through subsequent product changes.

## Validate the documents

```sh
npm ci
npm run spec:check
```
