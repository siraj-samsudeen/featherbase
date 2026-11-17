# #1218 build: business roles in shadow mode (option A, owner's yes 17-Nov-2026)

The design is `issue_1218_jobs_and_roles.md` (D1–D9) in this folder.

**Owner's choice, option A:** build the whole model tonight and deploy it, but **nobody's access changes**. Today's roles still decide who opens Dash, what they see and which reports they get. The new model is worked out alongside. A comparison page shows, for every person, what they would gain or lose. The switch-over is a later, separate step, done on the owner's yes.

## What gets built

1. **Business roles as data (D1, D5).** A **Business Role** row holds a name, a description and whether it is given by hand only.
   - Its permissions are rows of Business Role × app × thing × verb × reach (Own / Team / Area / All, D2).
   - It is seeded with Jeyarama's roles: Staff, Team Leader, Floor Manager, Department Manager, Store Manager, Cluster Manager, Buyer, Category Head, Head Office, Leadership, Master Data Steward (D9) and Vendor (D8). The contents follow D3, D4 and D9: Basic is Tasker and Tickets, and Dash comes from Team Leader up.
   - These are rows an admin edits, never code.
2. **Title Map (D7 wording; designation → business role).**
   - It is prefilled from today's job values. Each of the ten jobs maps to its business role, and a designation with no mapping falls back to its job.
   - Titles that map to nothing are listed as **Not mapped yet**, never guessed.
3. **A person's roles, with area and source (D2, D6).** These are worked out, not stored, from:
   - Job Assignment: the role from the Title Map, and the area from site, floor, section and cluster, as today's reach does.
   - Merchandise Assignment: Buyer, Category Head and similar roles. The area is the merchandise prefix plus the region, encoded as Dash's code prefixes (2-digit division, 4-digit category, 9-digit subcategory; see the manager note in the plan).
   - **Role Assignment** rows given by hand: Correct (replaces the role from the HR title) or Also give (adds one). Each has an optional end date and a reason.
   - Head Office and Leadership reach the whole company.
4. **Explain a person.** A read-only page. For one person it shows:
   - each role, with its area and source chip;
   - the apps and levels they get;
   - the reports they would get, each with a "why" line.

   It uses the shared `LinkedRowsGroup` look: one quiet line per item and no tables. Mockup: the Lens tab of `issue_1218_relational_navigation.html`.
5. **Who would gain or lose access.** For every current person (Employee), today against the new model:
   - Dash opens or not;
   - stores and subcategories reached;
   - reports given.

   It shows only people with a difference, grouped as "would lose Dash", "would gain Dash", "different stores" and "different reports". Each group has counts, and each person links to Explain a person.
6. **Report grants in the new shape (D4)**, shadow only. Today's grants are read as follows:
   - a grant to a job becomes a grant to the matching business role;
   - a grant to "Dash Reader" or "Dash All-Stores Reader" is shown on the comparison as **needs a decision**, never silently mapped;
   - a grant to a person stays a grant to that person.

## Must not

- Change today's access path: `reportsFor`, `can_open`, the scope provider and `reachOf` keep deciding.
- Rename or delete today's roles.
- Show machine ids or codes where a name exists.

## Checklist (the verifier checks each item)

1. The Business Roles list shows 12 roles. Opening one shows its permissions as sentences ("Store Managers can Edit Sections in their Area"), with the reach chip.
2. The Title Map lists every designation in use. Those with no mapping sit on top as "Not mapped yet", with how many people hold each.
3. In Explain a person for a made-up store manager:
   - Store Manager appears with the area "<store>" and the source "From HR title";
   - Dash · Reader, Tasker · Manager and Tickets appear;
   - their reports appear with a Why line.
4. In Explain a person for a made-up buyer, the area reads as the category and region, from their merchandise assignment.
5. "Also give" and "Correct" can be added for a person, with an optional end date, and the page updates.
6. The comparison page lists only people with a difference, with counts per kind. A made-up person whose access is identical does not appear.
7. A grant to Dash Reader shows as "needs a decision" on the comparison, not as a gain or a loss.
8. Today's access is unchanged. The existing Dash access tests pass untouched, and one new test proves that the shadow model's tables can't change `reportsFor`.
9. No codes or ids appear on these pages where a name exists. Every person, role, store and report shown is a link.
