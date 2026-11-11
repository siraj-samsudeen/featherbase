# Dash People

## Purpose

Dash holds who works for the group and in which stints, the HR title beside each
person's org-chart job, how a person's time is split across their job assignments, the approved
headcount of each section, and the jobs above the store up to the Director. The HR load, the
scopes and the reports build on these one set of records.

## Requirements

### Requirement: A person's stints of employment

Each time a person works for one of the group's companies SHALL be one stint, from the day they
join up to the day they no longer work there. A person who leaves and rejoins has a new stint,
and the new stint can carry a new employee number. The person keeps their own permanent number
throughout: an employee number belongs to a stint, never to the person.

#### Scenario: A rejoin carries a new number

- **WHEN** a person who left their company on 22-Jan-2026 rejoins it on 04-Feb-2026 under a new employee number
- **THEN** they have two stints at that company, each with its own number, and the person is the same person

### Requirement: Stints never overlap

The system SHALL refuse a stint that overlaps another stint of the same person at the same
company, and an employee number the company already gave to another person. A person may work
for two companies at the same time.

#### Scenario: An overlapping stint is refused

- **WHEN** a person still employed at a company is given a second stint at that company starting today
- **THEN** the save is refused, naming the stint it overlaps

#### Scenario: A number already held by another person is refused

- **WHEN** a stint is given an employee number the same company issued to someone else
- **THEN** the save is refused

### Requirement: The HR title beside the job

A job assignment SHALL carry the person's HR title (designation) beside their org-chart job.
Titles come from one clean list for the whole group, and each source system's spelling of a
title is kept beside it. A promotion closes one job assignment and opens the next, each with
its own title.

#### Scenario: The same title spelt two ways

- **WHEN** the HR system spells one title two different ways
- **THEN** both spellings lead to the one title on the group's list

### Requirement: A person's time across their assignments

Each job assignment SHALL be the person's home assignment (Primary), a second assignment
(Secondary) or a temporary deployment, with the share of their time it takes. A temporary
deployment takes its share out of the home assignment, which stays Primary. Acting cover is on
top of a person's own job and takes no share.

#### Scenario: A temporary deployment

- **WHEN** a person whose home is one store is deployed full time to another store for two weeks
- **THEN** their home assignment stays Primary and their sales for those two weeks count against the store they work in

### Requirement: Time that does not add up is listed

A person with two Primary assignments on one day, Primary and Secondary assignments over 100%
of their time, or temporary deployments larger than the Primary share they are taken from SHALL
be listed on the conflict list of each store they work in on that day, for the store to correct
before it goes live.

#### Scenario: Assignments over 100%

- **WHEN** a Team Leader whose home assignment takes all of their time is also given a Secondary assignment of 30% in another store
- **THEN** both stores' conflict lists name the person and the 130%

### Requirement: Approved headcount per section

Each section SHALL hold its approved headcount as a range, a minimum and a maximum, never as
named positions. The maximum is never below the minimum.

#### Scenario: A section approved for a range

- **WHEN** a section is approved for 15 to 19 people and 12 are deployed
- **THEN** the section shows its range of 15 to 19, and a maximum below the minimum is refused

### Requirement: Jobs above the store

The org chart SHALL cover everyone up to the Director, with Cluster Manager, Chief Operating
Officer and Director among the jobs. A Cluster Manager's assignment names the cluster they
manage, and a store's staff get their Cluster Manager through the store's cluster, never typed
in person by person.

#### Scenario: A Cluster Manager names their cluster

- **WHEN** a Cluster Manager is given an assignment without the cluster they manage
- **THEN** the save is refused

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
