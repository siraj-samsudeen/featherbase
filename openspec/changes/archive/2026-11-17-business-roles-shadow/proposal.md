## Why

Two things decide what a person gets in Dash today: their job from HR and roles ticked by hand. They overlap, so nobody can say in one sentence why someone sees a report (#1218). The owner agreed a model of business roles (D1–D9, `docs/plans/issue_1218_jobs_and_roles.md`) and chose to build it in shadow first (option A, 17-Nov-2026): the new model is worked out beside today's, and nobody's access changes until a later switch-over on the owner's yes.

## What Changes

- Business roles become rows an admin edits: each with its permissions, written as an app and level, a verb, a thing and a reach (Own, Team, Area or All). Jeyarama's twelve roles are offered as a starting set.
- A Title Map says which business role each HR title holds; a title nobody has mapped waits on a visible list.
- A person's business roles are worked out, with the area each applies to and where it came from: their HR title, their merchandise assignment, a named cluster, or a hand change ("Correct" replaces the role from the title, "Also give" adds one, each with an optional end date).
- Explain a person: one person's roles, the apps and levels they would open, and the reports they would get, each with why.
- Who would gain or lose access: everyone whose Dash would change under the new model, grouped by kind of change. A report given to a role such as Dash Reader is shown as needing a decision.
- Today's access is untouched: what opens Dash, which stores a person reaches and which reports they get stay as they are.

## Capabilities

### New Capabilities

- `business-roles`: business roles, the Title Map, a person's roles with their areas, and the shadow comparison.

### Modified Capabilities

## Impact

- Dash: four new Tables and a version step that adds them; three pages beside Report access for Report Access Managers and System Managers; reads of the HR title on job assignments.
