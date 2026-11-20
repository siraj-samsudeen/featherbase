> **Out of date since 20-Nov-2026.** #1377 changed how a figures question is answered (named tools, not SQL written by the model; Featherbase's own database first). Build from #1377. This file is to be rewritten; what was decided and why is in `docs/plans/feather-ask-decisions.md`.

## Why

People open a report to answer one question, and ask a colleague when the report does not answer it or they do not know which report to open (#1371). One place to ask anything gives each person a quick answer from the figures they are allowed to see, and gives the owner a view of what people need: what they ask, what it costs, and what could not be answered.

## What Changes

- Ask, a new app: one question box, with no modes. It answers questions about figures, says which report or area to use, and answers how-to questions.
- The same box opens beside every page; on a report it starts from that report.
- A figures answer is read live from the data warehouse, limited to the asker's own stores and subcategories, and says what it covers and how it was worked out.
- An admin decides which warehouse tables can be asked about, and by which roles.
- How-to answers come from guides an admin can edit.
- An admin picks the AI models, sets limits per person, role and model, and a monthly budget.
- Everything asked and answered is kept. A person can reopen their own chats; an admin sees who asks what and what it costs.

This first slice makes one table askable: sales versus target. More tables, other apps and acting on requests are #1372.

## Capabilities

### New Capabilities

- `ask`: the question box, on its own page and beside every page; chats; what an answer shows.
- `ask-figures`: which tables can be asked about, by whom, and how an answer stays inside the asker's stores and subcategories.
- `ask-guides`: the guides that how-to answers come from.
- `ask-limits`: the models on offer, limits and the monthly budget.
- `ask-log`: what is kept, who may read it, and the admin's view of usage and cost.

### Modified Capabilities

## Impact

- A new app shipped with the platform, and a platform capability it uses to run a query against the warehouse as the asker.
- The shared bar every page loads gains the Ask button and panel.
- A new outside service: an AI provider that offers GPT, Claude and GLM models through one account and reports the cost of each call (OpenCode Zen; OpenRouter also works), reached with a deployment secret. Questions, table descriptions and the rows of each answer are sent to it.
- The log holds report figures, so it is backed up and guarded like report data.
- MotherDuck: comments on the askable tables' columns, and a Guide for metric definitions and join rules.
