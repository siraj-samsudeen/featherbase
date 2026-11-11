# ADR 0025: MySQL is not a supported data source

**Status:** Accepted · **Date:** 2026-11-11 · **Supersedes in part:** the MySQL provisions of [ADR 0007](0007-app-and-database-topology.md) (MySQL among the source engines), [ADR 0012](0012-coverage-targets-and-dead-code.md) (MySQL among the services the suite needs), [ADR 0016](0016-backend-coverage-includes-branches.md) and [ADR 0017](0017-backend-coverage-non-regression-baselines.md) (coverage measured with MySQL enabled), and [ADR 0023](0023-coverage-ignores-at-the-unreachable-spot.md) (the MySQL driver counted only where it runs) · **Issue:** [#1199](https://github.com/siraj-samsudeen/featherbase/issues/1199)

## Context and Problem Statement

ADR 0007 gave external data sources one driver per engine, MySQL among them,
and the coverage ADRs measured the MySQL driver wherever a MySQL server was
reachable, which in CI meant a `mysql:8.4` service beside every server shard.

No instance uses MySQL. Production and staging each have one data source, on
MotherDuck (checked on 11-Nov-2026). Keeping MySQL costs a driver dependency,
a MySQL service in every CI run, a coverage exclusion that changes the
denominator between a laptop and CI, and tests and docs for an engine nobody
connects.

## Considered Options

- Keep MySQL: no work, but every cost above stays for an unused engine.
- Hide MySQL from the Connect page but keep the driver: the CI service, the
  tests and the coverage special case all stay.
- Remove MySQL, and refuse by name any MySQL source saved before.

## Decision Outcome

Chosen by the owner on 11-Nov-2026: **remove MySQL as a supported data
source.**

- The supported engines are PostgreSQL, DuckDB, MotherDuck and a folder of
  CSV files. The MySQL driver, its `mysql2` dependency, its tests, the Connect
  page's MySQL choice, the CI MySQL service and `MYSQL_TEST_URL` are removed.
- Migration 0161 drops MySQL from the Data Source engine's choices; shipped
  migrations are unchanged.
- A data source saved on MySQL before this is refused wherever it is used:
  "MySQL is no longer a supported data source: delete <name>"
  (`sources/registry.ts`), not an unknown-engine error.
- Server coverage no longer has a MySQL special case: a laptop and CI measure
  the same files. The rest of ADRs 0007, 0012, 0016, 0017 and 0023 stands.

### Consequences

- CI runs one service fewer per server shard, and the server's coverage
  denominator is the same everywhere.
- A client with data in MySQL connects it another way: copied into Postgres or
  MotherDuck, or read through a CSV export. Bringing MySQL back would be a new
  decision, with a new driver.
