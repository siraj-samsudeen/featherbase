## ADDED Requirements

### Requirement: A person's places say why they have them

Each place Feather Dash's scope gives a person SHALL carry, as its reasons,
the job assignments that give it, each named by its job, "Acting" when it is
acting, from the assignment's first day and to its end day when it has one. A
place from the old rules SHALL name the old rule that gives it, with no days.

#### Scenario: A Team Leader's section says which assignment gives it

- **GIVEN** a person holds a Team Leader job assignment on Silk Sarees from
  1 Jul 2026 to 31 Dec 2026, and an acting Staff assignment there from
  6 Aug 2026
- **WHEN** their places are worked out
- **THEN** Silk Sarees carries two reasons: "Acting Staff job assignment"
  from 6 Aug 2026, and "Team Leader job assignment" from 1 Jul 2026 to
  31 Dec 2026

#### Scenario: A store not yet live says which old rule gives it

- **GIVEN** a person is a store's manager by the old rules and the store is
  not live yet
- **WHEN** their places are worked out
- **THEN** the store's places carry "Store Manager, by the old rules"
