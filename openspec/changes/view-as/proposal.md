## Why

To check what a store person sees in Dash, a trusted tester signs in with that person's own password. Passwords get shared, the log records the wrong person, and the tester could change things as them (#1222). View as lets the tester see exactly what someone sees, without their password and without being able to change anything.

## What Changes

- An app can name a role whose holders may **view as** another person, and a read that finds and describes people. Dash names **View As Tester** and its people search (name, employee code, or job and store, with #1216's code · job · site line).
- While viewing, every read runs as the person viewed: their reports, stores, subcategories and roles. Every change is refused by the server.
- View as belongs to one signed-in session and ends after 60 minutes, at Exit, at sign-out, or when the tester loses the role.
- Nobody can view as themselves, a System Manager or Administrator, or someone turned off.
- Each start, switch and end is logged under the tester; Recent and Frequently used come from that log.
- The shared top bar shows who is being viewed on every page, with Switch and Exit, and offers the picker in three styles behind a toggle while the owner chooses.

## Capabilities

### New Capabilities

- `view-as`: see the app as another person, read-only.

### Modified Capabilities

## Impact

- Platform: the session check swaps the person for reads and refuses writes; permissions, app actions and the Access Log know about View as; a new internal table for the state; the manifest's `viewAs` declaration.
- Dash: the View As Tester role and its read of the reports list, the people read, a version step (no Table change).
- Web: the banner and the three picker styles in the shared top bar and the sidebars.
