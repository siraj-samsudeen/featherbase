# Tasks: ask questions of app data

Branch `analyst-semantic-model`. Last checked 2026-11-16.

## How to read this file

- `[x]` built, and a test in the repo proves it. `[ ]` not done, or built but its test fails.
- **outer**: the scenario's fenced Gherkin in `specs/ask-questions-of-app-data/spec.md`, run by
  cucumber-js (`npm --prefix acceptance-tests test`). **No outer test exists yet for any scenario.**
- **inner**: a server or app test (vitest). Server tests need a Postgres: start Docker Desktop and
  use `scripts/run-server-suite.ps1`, or set `DATABASE_URL` to the throwaway database it starts.
- **owner**: a decision only the project owner makes. Don't build past it.
- A box is ticked only when a command someone else can run says so. Untick a box whose test fails.
- Stages follow the roadmap "Featherbase agent: plan to match Cortex". Stages 4 to 7 are later
  changes, listed at the end without boxes.

## Where it stands

| Roadmap stage | In this change | Built | Left |
|---|---|---|---|
| The Analyst: ask, get scoped figures | sections 2 to 9 | yes | outer tests, UI review |
| 1. Conversation | sections 10 to 12 | yes | outer tests |
| 2. Wider semantic model | sections 13 to 16 | yes | outer tests |
| SQL first (not on the roadmap) | section 17 | yes | outer tests, live check, owner approval |
| 3. Knowledge tool (Help) | section 18 | server only | a place to ask, live run, owner approval |
| 4. Action tool, 5. Orchestrator, 6. Guardrails, 7. Verification | not in this change | no | own changes, see the end |

Checked on 2026-11-16:

- Feather Dash: `pnpm --filter @jeyarama/feather-dash exec vitest run src/ask.test.ts src/ask-panel.test.tsx src/dataset-query.test.ts src/manifest.test.ts`: 47 pass.
- Types: `pnpm --filter server typecheck` and `pnpm --filter @jeyarama/feather-dash typecheck`: clean.
- Server: `semantic-model`, `semantic-sql`, `plan-model`, `help`, `help-embedding`, `system-written`,
  `sales-target` tests: 303 pass, on a clean test database (task 0.1).
- Nothing on this branch is committed yet.

## Order of work from here

1. Section 0: commit, bring the proposal and design up to date.
2. Section 1: owner decisions. They decide what the outer tests should prove.
3. Outer tests, in the order of the sections below (the order a person meets them).
4. Live checks (17.7, 18.5) and the UI review (9.3, 9.4).
5. Section 19 (reconcile), then section 20 (review, PR, archive).

## 0. Before anything else

- [x] 0.1 The 7 failing `semantic-model` tests and 1 `sales-target` test were not a code defect: the
      long-lived test database (Docker `featherbase-verify-pg`) held one committed `view_report`
      row from an interrupted run on 2026-11-16, and those tests count access-log rows. A full run
      leaves no row behind. Removed the row; all pass. If view counts fail again, check first:
      `docker exec featherbase-verify-pg psql -U postgres -d featherbase_test -c "select * from featherbase.access_log"`
      (it should be empty).
- [ ] 0.2 Commit the branch's work as meaningful commits (a test, then its fix). Decide whether
      `.claude-run/`, `.featherbase-dev.pid`, `outputs/` and `scripts/*.ps1` belong in the repo.
- [ ] 0.3 Bring `proposal.md` and `design.md` up to date. The proposal still says answers come
      "never from generated SQL" and leaves out document search and earlier months; the design's
      non-goals still list generated SQL, joins and history. Decisions 9, 11 and 12 changed all three.
- [x] 0.4 Environment variable docs match `src/env.ts` (`pnpm --filter server check:env`).

## 1. Owner decisions

- [ ] 1.1 owner: is asking questions of data wanted in Featherbase at all? (design, open questions)
- [ ] 1.2 owner: review each design decision, 1 to 12, one at a time (grill-me), before the PR
      leaves draft.
- [ ] 1.3 owner: SQL as the first path, a plan second (decision 11).
- [ ] 1.4 owner: a refresh guard for the `sales_by_month` dataset.
- [ ] 1.5 owner: how long kept questions (`app_question`) are kept, and who besides the asker may
      read them.
- [ ] 1.6 owner: the help folder and the embedding model's cache in the image, and the new
      `@huggingface/transformers` dependency.
- [ ] 1.7 owner: where a person asks the help (no page does yet; see 18.6).
- [ ] 1.8 owner: the design's other open questions: facts such as `data_through` as declared
      fields, metrics built from other metrics, live reads or snapshot only.

---

# Stage: The Analyst (ask, get scoped figures)

## 2. The subcategories furthest behind target (@spec Ask about the figures and get figures back)

- [ ] 2.1 outer: the scenario as an acceptance test. The first outer test: it brings the step
      definitions for asking on Feather Dash and the language-model stand-in (`ANALYST_API_BASE`).
- [x] 2.2 inner: manifest `semantic` section, validated against the app's datasets and reads
- [x] 2.3 inner: plan executor (sum, min, max, avg, metrics, group, filter, order, limit)
- [x] 2.4 inner: `POST /api/app_analyses/:app/:model` answers a plan
- [x] 2.5 inner: model client (Anthropic Messages API); key and model are instance variables; a
      stand-in for tests
- [x] 2.6 inner: question to plan, with the model's verified questions as examples;
      `POST /api/app_questions/:app/:model`

## 3. A Store Manager gets the whole store (@spec An answer covers only what the user may see)

- [ ] 3.1 outer: A Store Manager gets the whole store
- [ ] 3.2 outer: Section staff get their section only
- [x] 3.3 inner: an analysis runs as the declared read, with its places
- [x] 3.4 inner: an answer records one view in the access log

## 4. An administrator with no store asks (@spec Someone with no store or section is refused)

- [ ] 4.1 outer: the scenario as an acceptance test
- [x] 4.2 inner: refused by the `person_scope` policy (403), before the language model is asked
- [x] 4.3 inner: checking who may ask records no view of the data

## 5. Achievement shows its definition and its date (@spec Every answer says what it counted)

- [ ] 5.1 outer: the scenario as an acceptance test
- [x] 5.2 inner: an answer carries each figure's definition, the places and the data date (`asOf`)

## 6. Asking for profit (@spec A question the figures cannot answer is refused plainly)

- [ ] 6.1 outer: the scenario as an acceptance test
- [x] 6.2 inner: unknown names refused in plain words (417)

## 7. A subcategory with no target (@spec A figure with nothing to divide by is shown as missing)

- [ ] 7.1 outer: the scenario as an acceptance test
- [x] 7.2 inner: division by zero and no values give null

## 8. Names as typed (@spec Names are understood as the user types them)

- [ ] 8.1 outer: A subcategory typed with different capitals
- [ ] 8.2 outer: A subcategory that is not the user's
- [x] 8.3 inner: filters match whatever the capitals and spaces; unmatched values named in the answer
- [x] 8.4 inner: the asker's own dimension values given to the model (up to 200 per dimension)

## 9. The Ask box on Feather Dash's report page

- [x] 9.1 inner: `ask()` in the app's API; the answer drawn with the report's figures and wording
      (`ask.ts`)
- [x] 9.2 inner: the Ask box (`ask-panel.tsx`) on the report page, with the verified questions to
      start from
- [ ] 9.3 the UI design agreed as a numbered checklist in the issue
- [ ] 9.4 a separate verifier agent runs the real UI at 1280px, headless, and returns a "spec vs
      built" table with screenshots, before the owner reviews

---

# Stage 1: Conversation

## 10. Breaking the last answer down by store (@spec A follow-up builds on the last answer)

- [ ] 10.1 outer: the scenario as an acceptance test
- [x] 10.2 inner: a follow-up carries on from up to 6 of the asker's kept questions; each earlier
      plan is checked before the model sees it
- [x] 10.3 inner: the Ask box keeps the conversation on the page, with Start over

## 11. Rupees or pieces (@spec An unclear question is asked back)

- [ ] 11.1 outer: the scenario as an acceptance test
- [x] 11.2 inner: a question that could mean two things is asked back, with nothing answered or
      recorded (`clarify`)

## 12. A conversation is still there on the next visit (@spec A conversation is still there on the next visit)

- [ ] 12.1 outer: A follow-up after coming back, on another device
- [ ] 12.2 outer: Another person's questions
- [ ] 12.3 outer: Starting over
- [x] 12.4 inner: each question kept in `app_question` (migrations 0006, 0007) with what it became,
      never a figure; a follow-up carries on from the asker's own open questions of the last day;
      the request brings no history
- [x] 12.5 inner: `POST .../earlier` shows the asker's open questions; `POST .../start_over` closes
      them and keeps them

---

# Stage 2: Wider semantic model

## 13. The sections furthest behind target (@spec Figures by section)

- [ ] 13.1 outer: The sections furthest behind target. (Before 2026-11-16 this was ticked as done,
      but the test is a server test, not an acceptance test.)
- [ ] 13.2 outer: A section owns a subcategory only on the days it is placed
- [x] 13.3 inner: relationships declared, checked against the app's Tables, and followed over
      scoped rows (`joinRows`)
- [x] 13.4 inner: Feather Dash: section and department through placement, section, department

## 14. Sales against the same days of last month (@spec This month beside last month)

- [ ] 14.1 outer: Sales against the same days of last month
- [ ] 14.2 outer: The subcategories that fell the most
- [ ] 14.3 outer: A month with nothing to compare with
- [x] 14.4 inner: a measure may count only some rows (`where`), checked, said in definitions and in
      the prompt
- [x] 14.5 inner: Feather Dash `sales_by_month` dataset (four months, same days), proven equal to
      `sales_to_date` for this month
- [x] 14.6 inner: `sales_by_month` semantic model with four verified questions; made-up rows seeded
      for development
- [x] 14.7 inner: a question asked of one model may be answered from another on the same read; the
      Ask box draws the monthly figures

## 15. Fewer are behind than were asked for (@spec Behind means behind)

- [ ] 15.1 outer: the scenario as an acceptance test
- [x] 15.2 inner: a plan may keep only rows whose figure passes (`having`)

## 16. A first draft of a model (a developer tool, no scenario)

- [x] 16.1 `draftModel` drafts a model from a dataset's declared columns:
      `pnpm --filter server exec tsx scripts/draft-semantic-model.ts <featherbase.json> <dataset> <read>`

---

# Stage: SQL first (decision 11, waiting on owner 1.3)

## 17. SQL cannot reach another store (@spec Questions are answered by SQL that can read only the user's own rows)

- [ ] 17.1 outer: SQL cannot reach another store
- [ ] 17.2 outer: SQL that tries to change or reach outside
- [ ] 17.3 outer: The answer shows how it was worked out
- [x] 17.4 inner: a model as a table, its figures as SQL, a plan as SQL (`planSql`), proven to
      answer as the plan does
- [x] 17.5 inner: one SELECT run on a private in-memory database of the asker's rows, outside access
      off, timed and capped (`runSql`)
- [x] 17.6 inner: SQL first and a plan second in `askPackageQuestion`; the SQL kept with the
      question; the Ask box shows the SQL
- [ ] 17.7 live: every verified question gets usable SQL from the real model (needs
      `ANTHROPIC_API_KEY`):
      `pnpm --filter server exec tsx scripts/check-verified-questions.ts ../../client-apps/jeyarama/dash/featherbase.json`,
      then ask a few questions in the browser (`pnpm dev jeyarama/dash`)

---

# Stage 3: Knowledge tool (Help)

## 18. How a figure is worked out (@spec Questions about how things work are answered from the help, with sources)

- [ ] 18.1 outer: How a figure is worked out
- [ ] 18.2 outer: A question the help does not cover
- [ ] 18.3 outer: A changed page changes the answer
- [x] 18.4 inner: `help/` with pages for store managers, and `help/sources.json` (Feather Dash
      README, specs, docs); passages split at headings, embedded by a local model (Arctic Embed M
      v2.0) or Voyage AI, kept in `help_passage` (migration 0178), re-embedded only when changed;
      `POST /api/help/ask` gives the nearest passages, Claude's answer and its sources
- [ ] 18.5 live: download and run the local model (`EMBEDDING_CACHE`) and ask real questions
      (`scripts/ask-help.ps1`)
- [ ] 18.6 a place in the UI to ask the help, once owner 1.7 decides where

---

# Finishing this change

## 19. Reconcile

- [ ] 19.1 Coverage 100% of lines and functions (the full server suite: `scripts/run-server-suite.ps1`
      locally, CI on Linux)
- [ ] 19.2 No unused files, exports or dependencies (knip)
- [ ] 19.3 Types check clean (clean on 2026-11-16; rerun last)
- [ ] 19.4 Mutation testing: every surviving mutant ratified, deleted or asked
- [ ] 19.5 `pnpm check:specs` passes

## 20. Review and hand-off

- [ ] 20.1 Open the PR as a draft once the owner approves the proposal, design and specs
- [ ] 20.2 Code review with the `feather-code-review` skill and a second model (Codex if available).
      This change touches permissions, data and server logic.
- [ ] 20.3 Propose an adversarial review to the owner (needs their consent)
- [ ] 20.4 PR body: what was done, the commands that verify it, how the owner can try it
- [ ] 20.5 The owner watches the acceptance review videos and tries it
- [ ] 20.6 Archive the change as the branch's last commit; merge with `gh pr merge --merge`

---

## 16. Action: requests confirmed and reviewed (stage 4)

- [x] 16.1 the Action mode declares its requests and reviewers; checked against the app's roles and models
- [x] 16.2 `chat_request` (migration 0180); the request worked out, missing inputs asked for, names checked against the person's own, shown, sent on a yes; at most three per conversation
- [x] 16.3 `/api/app_chat/:app/requests` and `/requests/:id/decide`; never the sender, once; activity log
- [x] 16.4 Feather Dash: target review (TR); the Requests list in the panel; the Administrator reviews
- [ ] 16.5 tried in the browser: a reader sends a target review, the Administrator approves it

## 17. Guardrails (stage 6)

- [x] 17.1 `model_usage` (migration 0181); `ANALYST_MONTHLY_TOKENS` with a warning at 80% and a refusal at 100% until the month ends; `/api/analyst/usage`
- [x] 17.2 `CHAT_DAILY_MESSAGES` per person
- [x] 17.3 safety rules added to every call to the language model
- [ ] 17.4 owner: the allowance to set, and whether the daily limit of 200 suits

## 18. Verification (stage 7)

- [x] 18.1 permission, guardrail and injection tests in the suite
- [x] 18.2 `scripts/check-live-agent.ts`: known answers in Agent mode against the verified plans, Reports, Ask, a request through to approval, permissions and injection over HTTP, run by `check-verified-questions.ts`
- [x] 18.3 the live check passes on the made-up data (17-Nov-2026: 38 checks, every one passed)

# Later stages: each needs its own issue and OpenSpec change

Not tasks of this change. Listed so the roadmap stays in one place.

- **Stages 4 to 7** are now part of this change (sections 15 to 18). Left: the live check on a
  schedule; an approved request doing something by itself (today people act on it).
- **Left from stage 2**: models drafted from Tables (today only from datasets), joins across
  datasets, metrics built from other metrics, live reads.

## 15. Chat panel and modes (stages 5 and part of 6)

- [x] 15.1 `chat` in the manifest (title, four modes, the roles that open each), checked against the app's roles and models
- [x] 15.2 `chat_session`, `chat_message` (migration 0179); modes by role; sessions; `send` routed by mode; written Agent answers (`CHAT_WRITTEN_ANSWERS`)
- [x] 15.3 Feather Dash: FeatherBot panel beside the report, four chat roles, Reports drawn on the page; the Ask box removed
- [x] 15.4 made-up people hold all four modes; the Administrator holds Ask alone
- [ ] 15.5 the checks run, and a try in the browser as a reader and as the Administrator
- [x] 15.6 Action mode (stage 4): see 16
- [ ] 15.7 owner: figures sent to the language model for written answers; how long conversations are kept
