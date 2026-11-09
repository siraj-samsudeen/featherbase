## Context

A private ticket's request row is read through an own-rows grant (the raiser) or the Tickets Support role. Its assignee is a column of the public ticket; the person it is raised for sits inside the private request. An action reads and writes as its caller.

## Decisions

### A row's extra readers are read-only shares, set by the app as a set

`documents.setReaders(table, rowId, people)` replaces the read-only shares of one row of a Table the app owns with exactly these people. The caller must be able to read the row, a person who is not enabled is left out, and a share that also lets someone change or reshare the row is left alone. Each change is one activity-log line.

Opening a row already honours a share, and the mandatory access ceiling still applies, so nothing else in the permission engine changes. A share is for one row only, so a reader never reaches other tickets.

Rejected: a new grant scope ("rows whose column names you") in the permission engine, because every own-rows check, list and column-tier path would have to learn it, for one app's need. Rejected: letting the app read as itself, because actions read as their caller on purpose.

### A read asks whether its caller was named, not whether it may read

`documents.isReader(table, rowId)` is true only when the caller holds such a share and the row still opens for them. A plain "may I read this row" would also be true for a System Manager or a Tickets Support role holder outside the support settings, and the Tickets screen would start showing them private details it does not show today.

### Readers see what the raiser sees

The request row carries the details and the earlier wordings. Support's history is a list of event rows, which shares do not reach, and stays with support, as it does for the raiser. Reassigning or changing who it is raised for resets the readers in the same action.
