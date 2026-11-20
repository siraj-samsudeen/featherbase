# Feather Ask: Handoff For A Fresh Session

**Last updated:** 20-Nov-2026, 04:50 UTC. To be refreshed before the account switch on 21-Nov-2026.

A living document so a new Claude project (on another account) can pick the work up cold; the
earlier project could not be moved. Read this first, then the documents it points to. When
something changes, update the line above and add to the section it belongs in: Current State,
Decisions Log, Learnings, Still Open, Next Steps. Add entries with their date; don't rewrite old
ones.

## Current State

- **Build from issue #1377.** It is the agreed design. #1371 is the first design (the model writes
  SQL), kept only as a record and superseded by #1377. #1372 is the later work. #1353 is the earlier
  FeatherBot draft by `albasir4u`.
- **Ownership.** #1377 is assigned to `mohammad-feather` and its body says "Claimed by: Mohammad",
  handed over by Siraj on 20-Nov-2026. Under `AGENTS.md` § Issue ownership, read the issue body,
  comments and assignees before building, and do not start competing work without an explicit
  handoff from the owner.
- **Branch:** `issue-1377-feather-ask`. On 20-Nov-2026 it was 85 commits behind `main`, with no PR.
  Its own commits are the prototype, the #1371 proposal and design, the decisions record, and this
  file.
- **Nothing on the branch is the #1377 build yet.** The prototype is a mockup of the screens.

## Read These, In This Order

1. Issue #1377: the design, the words it uses, the first build scope and the review route.
2. `docs/plans/feather-ask-decisions.md`: every decision of 19-Nov-2026 with what was turned down
   and why, what real models showed, OpenCode Zen as found, and a tour of the prototype.
3. `openspec/changes/issue-1371-feather-ask/` (proposal and design): **out of date**. It describes
   the SQL approach. It is to be rewritten for #1377, not followed.
4. `AGENTS.md` § Project: the repo's standing rules. Note the direct-push-to-main trial
   (2026-11-09 to 2026-11-23) and autopilot as the default change mode.

## The Agreed Design (#1377), In Short

- **One pipeline, in the Ask app**, the same for every question: check the person's limits, ask the
  model what to read, check and run that request as the person, ask the model to write the answer
  from the rows, save everything to the log.
- **One step in Featherbase core:** run a read-only tool call, limited to the person's reach (the
  same reach Dash already uses to limit a report) and to the admin's list of askable Tables and the
  roles that may ask each. Featherbase checks this, never the model.
- **Four tools, none accepting SQL:** read a Table with filters, count, sum, and a prepared query by
  name. No "run any query" door, so the permission rules live in one place. Joins only through a
  prepared query; otherwise Ask says it cannot answer.
- **Retry:** a refused request goes back to the model with the reason, a fixed number of times.
- **Honest answers:** the model is told what was left out (a filter, a row limit), so it never calls
  a part "all".
- **Two plug-in points, and only two:**
  - Plug 1, the model. First a stand-in with fixed word rules that returns real tool calls. A second
    stand-in for tests misbehaves on purpose: a forbidden Table, another person's store, a write
    tool, an unknown prepared query, nonsense, and wrong-then-right (the first five refused, the
    last recovered by the retry). Later real models.
  - Plug 2, the data source. First Featherbase's own database through its Tables. The MotherDuck
    warehouse later, as its own issue.
- **Unchanged from #1371:** one box with no modes; its own app plus a panel beside every page;
  chats and My Questions; how-to answers from guides that are rows in a Table (seeded per app,
  admin-editable); limits for everyone, a role or a person, per model, per hour, day or month, by
  questions or spend, plus a monthly budget, all checked before the model is called; the log keeps
  everything for good (asker reopens their own, Ask Admin sees all, nobody else); text in data is
  never an instruction; provider error text only for an admin.
- **First build:** all of the above, with one askable Table: sales versus target.

## The Prototype In `example-apps/ask/`

A throwaway app (v0.1.1) used as the mockup. It is not the design.

- `src/server.ts`: the door to the model, the limits and the log. `src/brain.ts`: the prompt, the
  checks on a reply, the built-in word rules. `src/answer.ts`: plan to figures. `src/main.tsx`:
  the screens. `src/guides.ts`: ten starter guides. `featherbase.json`: the manifest (Tables
  `ask.question`, `ask.config`, `ask.limit`, `ask.tally`; role Ask Admin; secret
  `OPENROUTER_API_KEY`).
- `apps/web/src/bar/ask-launcher.ts`: the Ask button and panel on every page.
- `client-apps/jeyarama/instances/dash/instance.json` lists the app. Decide before any release
  whether it belongs there.
- How it differs from #1377: it reads figures through Dash's report read from the browser; the
  model returns a plan of names, not a tool call; the log keeps words and the plan, not rows or the
  answer.
- Worth lifting: the AI call is a read and the log write an action, tied by a server-signed
  receipt; limits checked inside the transaction before the call out; a reply cut back to what the
  asker was offered.
- Known gaps: a receipt can be logged twice; admin lists show a name only; stores are plain text,
  not RecordLinks; no tests or review.
- To run: own database and ports in `.env.local`, then `pnpm dev jeyarama/dash --made-up-data`
  and open `/ask/`. No AI key needed; the word rules answer.

## Decisions Log

Decisions taken after #1377 was written. The ones before it are in #1377 and
`docs/plans/feather-ask-decisions.md`.

- **20-Nov-2026, Siraj: real data may go to GLM.** This closes the "may real figures go to an AI
  provider" question that #1377 and the decisions record list as open, for GLM.
- **20-Nov-2026, Siraj: a Gemini adapter on Siraj's own API key, for testing,** as another model
  behind plug 1.

## Learnings

Dated facts found while building or testing. Add new ones at the end.

- 19-Nov-2026, real models on made-up data through OpenCode Zen: $0.0003 to $0.0006 a question,
  two to nine seconds (GLM slowest); GPT, Claude and GLM gave the same correct reading.
- 19-Nov-2026: thinking models spend the answer allowance on thinking; with a small allowance the
  reply comes back empty. Give a larger one.
- 19-Nov-2026: Zen reports each call's cost unasked and refuses OpenRouter's include-cost setting,
  so that setting goes to OpenRouter only.
- 19-Nov-2026: handed only the rows that were behind target, a model called four of nine
  subcategories "all". This is why the model is told what was left out.

## Still Open (ask the owner, one at a time)

1. Does Gemini get real data, or only made-up test data?
2. A fixed set of example questions with the answer each should give, run against the stand-in now
   and against each real model when it is plugged in (proposed in #1377, not agreed).
3. Is the model fixed per environment, or switchable (by an admin, or per question)?
4. Where the provider keys live (instance secrets, per environment, who may set them).
5. Which Table becomes askable after sales versus target.

## Next Steps

1. **Merge `main` into the branch** and get `./init.sh` booting.
2. **Rewrite the OpenSpec change for #1377**, replacing the #1371 proposal and design (and adding
   specs and tasks), through `pnpm exec openspec`.
3. **Build the core step tests-first:** the read-only tool call limited to reach and the askable
   list, with the misbehaving stand-in's cases as tests. It is permissions, so propose an
   adversarial review for it (with the owner's consent).
4. **Build the pipeline** in the Ask app with the stand-in model and the full log, limits and
   retry.
5. **Add the real model adapters:** Gemini (Siraj's key) and OpenCode Zen.
6. **Wire the UI** to the pipeline, lifting from the prototype's screens; then the independent
   verifier against #1377 points 14 to 16, with the RecordLink checklist line.
