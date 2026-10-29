## MODIFIED Requirements

### Requirement: Review team workload

Together SHALL show shared tasks that are not Done or Cancelled, grouped by responsible person with unassigned work together. Private tasks SHALL NOT appear in this team view or its counts, even for their creator or an administrator.

#### Scenario: Open work by person

- **WHEN** the user opens the team workload with one shared task assigned to Shahul, one unassigned shared task, one completed shared task and one private task
- **THEN** Shahul's task and the unassigned task appear in their groups
- **AND** neither the completed task nor the private task appears in the active workload
