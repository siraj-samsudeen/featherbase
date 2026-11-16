# Importing data

A person brings a spreadsheet into Featherbase and it becomes a Table.

Steps: `uploading`, `proposing`, `confirming`. Each has its own folder with its sentences, tests and code.
The demo for this feature is `journeys/2-importing-a-clean-master.md`. Its screens are in
`features/foundations/pages/screens.html`.

## In this build

**Scope.** No sign-in and no record of who changed a row. CSV only, clean files only

**Types and formats.** Text, Number, Date, Yes/No, Choice; dates `2015-01-01`, yes/no `true`/`false`

## Not in this build

A file with problems: blank or repeated keys, cells that do not fit their Column. Build 1 assumes a clean
file; what happens otherwise is designed in build 2. Excel files; other date and number formats; Issues,
corrections and partial imports (build 2); re-import of a
newer version; references between Tables; signing in, roles and permissions; who changed a row and when, and the history
of every change; outside sources;
definition files; apps.
