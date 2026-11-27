# ADR 0028: A stand-in dataset is a flagged snapshot, bound per instance

**Status:** Proposed · **Date:** 2026-11-27 · **Issue:** [#1409](https://github.com/siraj-samsudeen/featherbase/issues/1409) · **Change:** `openspec/changes/issue-1409-stand-in-datasets`

## Context and Problem Statement

An app declares each dataset it needs once and reads a stored snapshot of it (ADR 0013). When
an app is built, some of that data is often not in the warehouse yet: it exists only as a CSV
or a workbook. The screen then shows nothing until the warehouse model lands, so people cannot
see the real screen, and building the app and landing its data block each other. How can an
instance serve such a dataset from a file for a while, without the app knowing, and without
sample figures ever passing for real ones?

## Considered Options

- A stand-in is an ordinary snapshot with a flag on its registry row, loaded through the
  snapshot lifecycle, and a per-instance binding says whether the warehouse or a stand-in may
  fill the dataset.
- A separate store of stand-in rows, read by a branch in the dataset read.
- A CSV-backed Data Source the dataset's declaration points at while the gap lasts.

## Decision Outcome

Chosen: **a flagged snapshot and a per-instance binding.** The file's rows are checked against
the declared columns and activated as the dataset's snapshot, in the same table and through
the same build, validate, activate and keep-last-good steps as a refresh. Reads, scope
filtering and ordering are untouched, so an app's code is the same for real and stand-in rows.
Whether an answer is marked is read from the snapshot that served it, never from the binding,
so sample rows cannot be served unmarked. The binding (`Dataset Binding`, a system Table the
settings file can set per environment) decides only what may fill the dataset: one bound to a
stand-in is not refreshed from the warehouse and needs no Data Source.

Four rules follow from it. A stand-in is never a guard's baseline and is not itself guarded,
so sample figures cannot make a check refuse the real ones. A stand-in is tied to the
dataset's columns, keys and scope mapping, not to its query, so correcting the query while
it serves does not blank the screen. The platform marks every response that carried stand-in
rows and its page shell draws the line, so an app cannot forget the mark. On production a
stand-in needs a tick on its binding that the settings file cannot set.

### Consequences

- Good: no app code changes to use a stand-in or to leave one; the switch is the ordinary
  refresh.
- Good: one read path, so a stand-in is limited to a reader's places exactly as real rows are.
- Good: a refresh that fails after a stand-in keeps the stand-in serving, still marked.
- Bad: a snapshot's identity now has two forms (the whole definition, or its shape for a
  stand-in), which every reader of the registry must know.
- Bad: a separate store would have made "no sample data in this table" checkable at a glance;
  here it is a flag that every writer of snapshots must set correctly.
- Rejected, the CSV-backed Data Source: it moves the choice into the app's declaration, so
  switching to the warehouse is an app release, and nothing marks the rows.
