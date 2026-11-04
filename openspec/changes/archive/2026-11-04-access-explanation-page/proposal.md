## Why

#628: a person's access comes from several places: their roles, the Tables those
roles reach, Data Scope rows and rows shared with them. Nobody can see the
result in one place. When someone says "I can't see my section", or an auditor
asks "why can this person see that store?", someone has to read the database.

The owner settled the design on 4 Nov 2026 (decisions recorded on #628). This
change is the first slice: the page and the platform's own items.

## What Changes

- **A page per person**, "What <person> can see", at
  `/featherbase/account/access/<person>`. It works on every address, like the
  other account pages, so a person without Admin access can open their own.
- **Four sections, each item with its reason:**
  - roles, each with who gave it and when;
  - Tables reached, to read and to change, each naming the roles that grant it;
  - Data Scope rows, each with who set it and when;
  - rows shared directly with the person.
- **Who may open it:** the person themselves and System Managers. Everyone else
  is refused.
- **Never shows row data.** It shows that access exists and why, never the data.
  A row is named by its title only when the viewer can read it.
- **Links** from the user menu ("What can I see?") and from a Person's row.
- `principalReach` (#852) also returns, per Table, the roles that grant it.

Out of scope here, and next in #628:

- the app's places with their reasons;
- the "View access explanations" permission;
- managers whose places cover a person's;
- past dates, which come with #617.

## Impact

- **Server:** `apps/server/src/access-explanation.ts`, `GET /api/access_explanation/:person`
  and `token-reach.ts` (roles per Table).
- **Web:** the new account page, a user-menu item and a link on the Person form.
- No schema change and no migration.
