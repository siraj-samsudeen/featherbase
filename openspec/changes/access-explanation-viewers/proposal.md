## Why

#628's first slice let only the person and System Managers open "What can
this person see". The owner decided on 4 Nov that auditors get a platform
permission, and that a manager whose places cover a person's places may open
that person's page (C1), with no app changes.

## What Changes

- A built-in role, **Access Auditor**: its holders may open anyone's page.
- A viewer whose places, from the instance's scope provider, cover every
  place of a person may open that person's page. A person with no places is
  never covered, and a viewer with none covers no one.
- Anyone else is still refused, before the page says whether the person
  exists.

## Capabilities

### Modified Capabilities

- `access-explanation`: who may open someone else's page.

## Impact

- Migration `0141_access_auditor_role.sql` adds one Role row.
- `apps/server/src/access-explanation.ts`: the viewer rule.
- The page's refusal message names who may open it.
