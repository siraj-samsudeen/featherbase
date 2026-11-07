## Why

Store staff already have a StyleHR ID and password, but no Featherbase login, and nothing connects a staff row to a login. Making every login up front would create thousands of accounts for people who may never sign in. The owner chose to link each person the first time they sign in (#970, 05-Nov-2026).

## What Changes

- A connected service's sign-in method gets a new rule for people it does not know: make a person only when the ID typed is exactly one current row of a staff roster that nobody holds, and the service confirms the sign-in and names that row's record.
- That first sign-in, in one transaction, makes the person, links their sign-in, records their employee identifiers and writes the person onto the row.
- Any other ID is refused in the usual wording without the service being asked. Duplicates and rows or values already held by someone are noted for an administrator.
- Which Table and columns hold the roster is configuration on the sign-in method. The platform names none of them.
- The JeyaRama instance's file gains the StyleHR method, switched off.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: a connected service may admit someone on the staff roster at their first sign-in, and the rule for people a method does not know gains that option.

## Impact

- `apps/server/src`: the sign-in route, a new module for the first sign-in, the sign-in method's checks, one migration for the rule's choice.
- `packages/shared`: the rule's name and the sign-in's actor label.
- `client-apps/jeyarama/instances/dash`: the method in the settings file and its instance notes. The Dash app's manifest does not change.
- `docs/DEPLOY.md`: how the method is set up and switched on.
