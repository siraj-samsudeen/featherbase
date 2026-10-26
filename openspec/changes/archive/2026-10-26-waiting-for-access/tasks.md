# Tasks

## 1. Waiting list

- [x] 1.1 Add failing server tests: who is listed (no role of their own; not built in, disabled or merged away), newest first, domain only, method and first and last sign-in, the count, System Manager only.
- [x] 1.2 List people waiting for access and count them, System Manager only.

## 2. Alert

- [x] 2.1 Add failing server tests: one email to each enabled System Manager with an address when a sign-in rule creates a person; none for an invited person; none past the daily cap, with one log line; sign-in unaffected when mail fails.
- [x] 2.2 Queue the alert after a sign-in rule creates a person, once per person, capped per day, never failing the sign-in.

## 3. Page

- [x] 3.1 Add failing web tests: the page lists waiting people and opens the Person form, the menu count, the empty state, nothing for someone who is not a System Manager.
- [x] 3.2 Build the page and the menu link with its count.

## 4. Review round

- [x] 4.1 Start a nameless new person's name from the part of the address before the @; show only the domain where a name is an address.
- [x] 4.2 Count the daily cap by the India day; log the alert with the system as actor and the person in the text; one mail per address; no alert for test-mode or mock sign-ins.
- [x] 4.3 Index the sign-in log for per-person and alert lookups.
- [x] 4.4 Refresh the waiting list and count after a person or role assignment is saved.

## 5. Verification

- [x] 5.1 Run the server and web suites, both typechecks, `pnpm check:specs` and the sensitive-content check.
