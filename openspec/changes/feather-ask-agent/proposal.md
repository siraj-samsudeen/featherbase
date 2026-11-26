# Feather Ask: the agent behind the answers

Issue: [#1377](https://github.com/siraj-samsudeen/featherbase/issues/1377).
Built by Mohammad with Claude Code on branch `issue-1377-ask-ui`, after the page
(`feather-ask-ui`). Today every question gets a placeholder answer; this change makes it real.

## Why

A person's question can touch any app they use (tickets, sales, people), and they should not have
to know where the data lives. An AI agent that reads every app the person can use, as that
person, can answer in plain words, and can never show them something they could not open
themselves.

## What Changes

- Ask's answers come from an agent: a model is given the question and Featherbase's read-only MCP
  tools (the same tools Claude Code gets over `/mcp`: list the Tables, describe one, find rows,
  open a row), calls them as often as it needs, at most 8 steps a question, then writes the answer.
- Every tool call runs as the person, under their permissions, in every app.
- The platform lets an app's slow read declare that it uses Featherbase's MCP tools, and hands it
  those tools as the person. Ask is the first app to use it.
- The model, for now: Gemini and Groq with the owner's own keys, through one OpenAI-style adapter.
- Later steps in the same change: every app's own reads offered as tools, a sum and group tool for
  figures questions, and limits, a budget and a log.

Kept from #1377, to be specified with the model (step 3): the answer says what was left out (a
filter, a row limit) so it never calls a part "all" (point 8); text in a question, a name or a row
is data, never an instruction, and a provider's error text is shown only to an admin (point 19).

Departs from #1377's Agreed design, by the owner's decision (26-Nov-2026): no tools of Ask's own
(point 6), no fixed retries (point 7), no admin list of askable Tables (point 12), no prepared
queries for joins (point 13), and OpenRouter later instead of OpenCode Zen.

Not in this change: writes on request (#1372), and a scheduled Ask with nobody signed in.

The specs follow Selvi, who can read her own tickets in the Tickets app, and Ravi, who has no
tickets.

## Capabilities

### New Capabilities

None (adds to `feather-ask`, which `feather-ask-ui` creates).

### Modified Capabilities

- `feather-ask`: answers come from the person's own data, across apps, read-only.
- `trusted-runtime-packages`: an app's slow read can use Featherbase's read-only tools, as the
  person.

## Impact

- `packages/shared`: types for the tools and the manifest flag.
- `apps/server`: the flag's check (`app-access.ts`), the in-memory tools and the pass
  (`mcp-app-reads.ts`, reusing `mcp.ts`'s tool server), handing them to an outbound read
  (`runtime-actions.ts`), a sweep of expired tokens.
- `example-apps/ask`: a `think` read with the agent loop and model adapter; secrets for the keys.
