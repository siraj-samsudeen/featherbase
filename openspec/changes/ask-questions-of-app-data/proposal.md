> **DRAFT, not yet reviewed by the owner.** Steps 2 and 3 were built ahead of this
> proposal on branch `analyst-semantic-model`. The grill-me review of each decision
> happens with the owner before the PR leaves draft.

## Why

Managers ask business questions of their figures ("which subcategories are furthest
behind target?", "how is Lakeside doing this month?"). Today each answer needs
someone to build a report. Featherbase already knows who may see which store and
section, and an app already declares the data it serves. With a description of what
that data means, Featherbase can answer such questions itself, in words and figures,
inside the same limits the report keeps. This is the capability Snowflake calls
Cortex Analyst, built on Featherbase's own scoping.

## What Changes

- **An app describes what its data means.** A new `semantic` section in an app's
  manifest names, for one of its datasets: the things a person groups or filters by
  (store, subcategory), the figures that add up (target, sales), the figures worked
  out from those (gap, achieved), and a few example questions with the answer plan
  for each. It is checked when the app is installed or upgraded.
- **A question is answered from a plan, never from generated SQL.** A plan names
  only things the description declares. The platform checks it, limits the rows to
  the asker's stores and sections exactly as the app's own read does, and computes
  the figures. A plan that names anything else is refused in plain words.
- **Questions in words.** A language model turns a question into a plan, shown the
  description and the example questions. The examples are also the tests. The
  model is configurable per instance; Claude is the default.
- **Every answer says what it is:** the figures, how each was worked out, whose
  stores and sections it covers, and how recent the data is.
- Feather Dash declares the first description, `sales_vs_target`, over its
  month-to-date sales.

- **An Ask box on Feather Dash's report page.** A reader types a question, or picks
  one of the example questions, and the answer is drawn like the report's own table.

- **Follow-ups and questions asked back.** "And by store?" builds on the last answer;
  a question that could mean two things is asked back, not guessed at.

Not in this change: document search, actions, comparisons with
earlier months (the dataset holds the current month only). Each gets its own issue.

## Capabilities

### New Capabilities

- `ask-questions-of-app-data`: ask a question of an app's data and get a checked,
  scoped answer.

### Modified Capabilities

- None at spec level. `trusted-runtime-packages` gains the manifest section; its
  promises do not change.

## Impact

- Server: new `semantic-model.ts`, `semantic-question.ts`, `plan-model.ts`; manifest
  validation in `runtime-packages.ts`; two endpoints, `POST /api/app_analyses/:app/:model`
  (a plan) and `POST /api/app_questions/:app/:model` (a question in words).
- Three new instance variables: `ANTHROPIC_API_KEY` (secret), `ANALYST_MODEL`,
  `ANALYST_API_BASE`.
- Feather Dash manifest: the `sales_vs_target` description. No version bump here.
- No migration, no new Table.
