# Quick Task Capture

**IDs:** `capture_neutral_task`

## Purpose

A team member can record something immediately without first deciding where it
belongs or who should handle it.

### Requirement: capture_neutral_task
Status: governed (#296)

> evidence: proven via quick_capture_flow — component, server and browser tests exercise title-only capture and continued entry.

A non-empty title SHALL be sufficient to capture a task. The task SHALL appear
in Inbox immediately, start Not started and Not urgent, and have no project,
Personal tasks owner or responsible person. Its creator SHALL NOT automatically
become responsible. After a successful capture, the entry SHALL clear and remain
ready for another title. Pressing Enter SHALL submit the title.

#### Scenario: neutral_defaults

- **WHEN** Siraj captures `Review September stock variance`
- **THEN** it appears in Inbox with the neutral defaults
- **AND** Siraj is its creator but not its responsible person.

#### Scenario: entry_stays_ready

- **WHEN** a task is captured successfully
- **THEN** the entry clears and remains focused for the next title.
