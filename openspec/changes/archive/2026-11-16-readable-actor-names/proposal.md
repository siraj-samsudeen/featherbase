## Why

Someone given a role opened "What you can see" and read "given by svc-installer" and "given by Unnamed person". The second was a real System Manager: the name was hidden because the viewer may not read Person. Who did something is not secret from the people who see it done (#1224).

## What Changes

- Wherever the platform shows who did something on a record the viewer may already see (who gave a role, set a limit, shared a row, wrote a comment or a version), it names them: a person by their display name, even without Person read; never an address.
- A service account reads as "Automation (<its name>)", or by a display name a System Manager gives it. The short name stays the key other code finds the account by.
- System steps read as phrases: "Staff roster sync", "Google sign-in".
- An app can name the actors of its own data; any other id stays unnamed.
- "What you can see" is redesigned (Summary, By role, By area), with every record shown as a link the viewer can open.

## Capabilities

### New Capabilities

- `actor-names`: who did something is named, by one rule, everywhere it is shown.

### Modified Capabilities

- `agent-access`: a service account's change reads as "Automation (<name>)" in history.
- `access-tokens`: a service account may carry a display name.

## Impact

- Platform: `actor-names.ts` (new), `access-explanation.ts`, `document-activity.ts`, `people-directory.ts`, `token-reach.ts`, `service-accounts.ts`, `runtime-actions.ts`; migration 0163.
- Web: `AccessExplanation.tsx`, `AccessLayouts.tsx` (new), `ActivityTimeline.tsx`, `Comments.tsx`, `lib/people.tsx`.
- Apps: `ctx.people.actorNames(ids)`. No Dash change.
