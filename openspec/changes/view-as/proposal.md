## Why

To check what a store person sees in Dash, a trusted tester signs in with that person's own password. Passwords get shared, the log records the wrong person, and the tester could change things as them (#1222). View as lets the tester see exactly what someone sees, without their password; anything they do is their own, never the other person's.

## What Changes

- An app can name a role whose holders may **view as** another person, and a read that finds and describes people. Dash names **View As Tester** and its people search (name, employee code, or job and store, with #1216's code · job · site line).
- While viewing, every read runs as the person viewed: their reports, stores, subcategories and roles. The pages offer no change; any request that changes something runs as the tester themself, never as the person viewed. (Owner, 16-Nov-2026: no server-enforced read-only mode; keep it simple.)
- View as belongs to one signed-in session and ends after 60 minutes, at Exit, at sign-out, or when the tester loses the role.
- Nobody can view as themselves, a System Manager or Administrator, or someone turned off.
- Each start, switch and end is logged under the tester; Recent and Frequently used come from that log.
- The shared top bar shows who is being viewed on every page, says it is for viewing only, with Switch and Exit, and offers the picker in two styles behind a toggle while the owner chooses.

## Capabilities

### New Capabilities

- `view-as`: see the app as another person.

### Modified Capabilities

## Impact

- Platform: the session check swaps the person for reads only; permission checks offer no change while viewing; the Access Log knows about View as; a new internal table for the state; the manifest's `viewAs` declaration.
- Dash: the View As Tester role and its read of the reports list, the people read, change buttons hidden while viewing, a version step (no Table change).
- Web: the banner and the two picker styles in the shared top bar.
