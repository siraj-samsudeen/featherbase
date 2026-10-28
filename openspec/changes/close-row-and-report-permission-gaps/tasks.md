# Tasks

## 1. Files follow their row (#609)

- [ ] 1.1 Scope a list of files, and opening one, by the row it is attached to; files on a whole table or on nothing keep the File grant.

## 2. Deleting a comment checks its row (#610)

- [ ] 2.1 Refuse deleting a comment or a file on a row the caller cannot open; editing a comment already checks the row.

## 3. A create-only grant keeps what was typed (#608)

- [ ] 3.1 On insert, a column is writable when the caller's create or edit grant reaches its tier.

## 4. A scheduled report's definition (#611)

- [ ] 4.1 Refuse a change to a Report that a schedule sends unless the editor set up every such schedule or is a System Manager.
