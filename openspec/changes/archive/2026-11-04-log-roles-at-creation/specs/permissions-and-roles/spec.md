## ADDED Requirements

### Requirement: Roles given at creation are in a person's history

Creating a person with roles SHALL record one history entry naming who created them and the roles they were given. That entry alone SHALL NOT keep the person from being deleted, and SHALL go with them. A later change to the person SHALL still keep them from being deleted.

#### Scenario: A person created with a role shows it in Activity

- **WHEN** an administrator creates a person with the role "Rh Clerk"
- **THEN** the person's Activity shows the administrator created them, with "Roles: ∅ → Rh Clerk"

#### Scenario: A person with only their creation entry can still be deleted

- **WHEN** a person created with a role, and not changed since, is deleted
- **THEN** the person and their roles are removed, and no history is left behind
