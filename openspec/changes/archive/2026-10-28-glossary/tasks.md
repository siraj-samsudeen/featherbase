# Tasks

## 1. Storage and the app's terms

- [x] 1.1 Migration 0138 creates the platform Table for terms, with its words to avoid and the Tables and columns it describes, and lets everyone signed in read it, pinned by a migration test on a fresh database.
- [x] 1.2 An app's manifest declares its terms (a versioned extension point); a term describing a Table or column the app does not own or declare refuses the app and names the term, pinned by server tests.
- [x] 1.3 Installing an app adds its terms under the app, pinned by a server test.
- [x] 1.4 An upgrade refreshes the terms the instance has not reworded, keeps the ones it has, marks when the app's wording changed, and taking the app's wording replaces the local one, pinned by server tests.
- [x] 1.5 A removed or turned-off app's terms leave the glossary and return, with local rewording, when it comes back, pinned by server tests.

## 2. Reading and editing

- [x] 2.1 Everyone signed in reads the glossary; editing needs a write grant, which System Managers always hold, pinned by server tests.
- [x] 2.2 An instance's own term has no app and shows in the instance's group, pinned by a server test.

## 3. Admin

- [x] 3.1 A Glossary page lists the terms by app, searchable by name, words to avoid and definition, pinned by web tests.
- [x] 3.2 A Table title and a form field that a term describes offer its meaning in place; others offer nothing, pinned by web tests.
- [x] 3.3 An independent verifier checks the #629 spec checklist at 1280px and 375px in light mode.
