# ADR 0019: Retiring a row is a platform standard

**Status:** Accepted · **Date:** 2026-11-04 · **Issue:** [#859](https://github.com/siraj-samsudeen/featherbase/issues/859)

## Context

A row with history, comments, attachments, shares or links cannot be deleted (#321), and that
rule protects the audit trail. People still need to take such a row out of use: a sample plant
mirrored from SAP, a Business Unit superseded during setup. Left to each Table's designer, every
Table would grow its own "active" column, with its own name and no reason, and every picker would
need to know about it.

## Decision

Retiring is one mechanism for every Table that stores its own rows. Three standard columns,
`retired_at`, `retired_by` and `retired_reason`, sit beside `created_at` and the others, and their
names are reserved. Retire and Reactivate are engine row actions: retire needs the delete right,
reactivate the write right, and a reason is required. The server's list reads (list, count,
group count, aggregate, summary) leave retired rows out unless the request asks for them; the
permission predicate, `related` filters and scope providers do not, so retiring never changes
access. Each retire and reactivate is a history entry.

## Consequences

A Table's own active flag, such as `is_active` loaded from a source system, stays the source's
data; retirement is the Featherbase curator's decision and survives loads. A new caller of the
list reads that needs retired rows must ask for them. Sub-tables, Settings tables and Tables
connected to an outside database cannot retire rows until a later decision says how.
