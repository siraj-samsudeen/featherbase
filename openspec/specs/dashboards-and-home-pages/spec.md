# Dashboards and Home Pages

## Purpose

A dashboard is a saved page of number cards and charts computed from live
data. A home page is a saved page of grouped links people land on. Both are
built the same way as any other Table's rows, and both only ever show what
the viewer could otherwise see — except a chart that follows a query report,
which shows that report's results to anyone who can open it.

## Requirements

### Requirement: A dashboard's numbers and charts stay live

Opening a dashboard SHALL compute each card's count and each chart's values
fresh from current data, scoped to what the viewer could otherwise read,
except a chart that follows a query report, which shows that report's
results to anyone who can open it.

#### Scenario: A restricted viewer's card

- **WHEN** a dashboard has a card counting all Orders, and a viewer can only
  read their own
- **THEN** that viewer's card counts only their own orders, not everyone's

### Requirement: A chart can follow a Table or a saved report

A dashboard's chart SHALL show either grouped counts from a Table's rows, or
the current values of a saved report, and a report-driven chart keeps
following that report's own filters and grouping as they change.

#### Scenario: A pinned report chart updates

- **WHEN** a chart pinned from "Open orders by status" is on a dashboard and
  someone later adds an order
- **THEN** the chart shows the new order the next time the dashboard loads

### Requirement: A home page groups links into cards

A home page SHALL show its links grouped into labeled cards in the order
they were curated, and hide any link to a Table the viewer can't read rather
than showing it disabled.

#### Scenario: A hidden link

- **WHEN** a home page has a card with a link to a Table one viewer can't
  read
- **THEN** that viewer sees the card's other links but not that one

### Requirement: A home page can be limited to certain roles

A home page SHALL be visible to everyone unless it names specific roles, in
which case only people holding one of those roles see it. An Administrator
always sees every page.

#### Scenario: A role-restricted page

- **WHEN** a home page is limited to the "Warehouse" role
- **THEN** only people with that role see it in navigation, and everyone
  else does not

### Requirement: A new Table is never lost from navigation

Building a new Table SHALL give it a link on its module's home page
automatically, creating that page first if it doesn't exist yet.

#### Scenario: A table in a new module

- **WHEN** the user builds a Table in a module with no home page yet
- **THEN** a home page for that module appears with a link to the new Table
