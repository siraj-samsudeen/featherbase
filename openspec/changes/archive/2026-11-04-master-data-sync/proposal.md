# Master data sync

Issue: [#927](https://github.com/siraj-samsudeen/featherbase/issues/927). Design approved by Siraj on 04-Nov-2026
(minimal version). Builds on the copy of a warehouse table (#805) and its scheduled refresh (#845).

## Why

Featherbase is becoming the master for people and stores, while StyleHR and SAP stay the systems people work in.
A copied warehouse table shows what the source says today, but nothing keeps the master Table in step with it: a
source change never reaches the master, and an edit in Featherbase never reaches the people who own the source.

## What Changes

- A System Manager gives a copied table a **sync rule**: the master Table it feeds, the Source Link Table that
  matches source rows to master rows, and for each synced column who owns it (the source or Featherbase).
- Each refresh compares three values per column: the source value last seen, the source now, Featherbase now.
  What the source owns and changed is applied, and its history says it came from that source. Every other
  difference raises a ticket in Tickets, routed to the source system's primary contact, once.
- A new source row is never linked automatically, and a gone one is never deleted: the first raises a ticket,
  the second marks the master row inactive when the rule says how, and raises a ticket otherwise.
- Every refresh of a copied table, Copy again or its schedule, runs its sync rule after the copy.

## Capabilities

### New Capabilities

- `master-data-sync`: keep a master Table in step with a copied warehouse table.
