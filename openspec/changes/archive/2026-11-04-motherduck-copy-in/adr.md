# ADR Review Manifest

- Status: completed
- Review date: 2026-11-02

## Review Summary

One durable decision: a pasted warehouse token lives encrypted in Featherbase's database. It
departs from the rule that every secret is a deployment variable, so it gets its own ADR.

## In-Force ADRs Reviewed

- ADR 0012 (coverage and the hosted-service boundary): the live MotherDuck connection stays in the existing hosted-service module; no new coverage exclusion (design D4).
- ADR 0013 (client apps and product apps): no client data enters this repository; tests use a local stand-in with made-up databases.
- ADR 0017 (coverage non-regression baselines): new code is measured; baselines must not fall.

## New Durable ADRs Created

- [ADR 0018](../../../adr/0018-pasted-warehouse-tokens-encrypted-in-the-database.md): a pasted warehouse token is stored encrypted in Featherbase's database.
