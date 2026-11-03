## Decisions

### Isolate before deleting

Use a database-specific child directory beneath the checkout's local storage area, selected by the same environment resolver as setup/start/health. Include host, port and database identity, not credentials or the display instance name: an explicit database override must select the same storage for every command. Keep an explicit FILE_STORAGE_DIR usable for normal operations, but refuse reset unless it is the managed selected directory. Arbitrary paths do not establish exclusive ownership.

Rejected deleting the existing shared root or files referenced by one database: another database can refer to those same files. Legacy shared files remain untouched; no automatic copy or move can prove exclusive ownership. Existing local users are warned about the new location. This is the owner-approved isolation scope, not a hosted storage change.

### Fail closed before either deletion

Reuse assertLocal and additionally require the database's persisted development stamp. Refuse every existing connection, not just one guessed application name, and name its PostgreSQL PID/application for the user to stop. Close the inspection connection before DROP DATABASE; never FORCE or terminate a backend. PostgreSQL's ordinary drop refusal covers a connection arriving after inspection, before any file deletion.

Reject symlinked managed storage paths. Delete only the selected managed child after a successful database drop. No automatic setup, no unstamped-database escape hatch, no environment-check override.
