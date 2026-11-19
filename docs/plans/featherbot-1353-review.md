# FeatherBot (#1353): Walkthrough For The Owner

Written 19-Nov-2026 on branch `issue-1353-featherbot-current`. It carries draft PR #1354
(`analyst-semantic-model`, 3 commits, about 8,500 lines, based on main of 31-Oct) forward onto
today's main. Nothing here has touched staging or production. Every example below is made up
(Lakeside, Bayside, Kumar Test-Staff).

**Status: stopped for your decision.** Phase 2 (the task list at the end) starts only on your OK.

---

## 1. What It Does

- An app describes what its figures mean in its manifest: a **semantic model** names the things you
  group by (store, subcategory, section, department), the figures that add up (target, sales) and
  the figures worked out from them (gap, achieved), plus a few example questions.
- A person types a question in words. A language model (Claude) turns it into either **SQL** or a
  **plan** (a list of names from the model). It never sees the figures at that point.
- The platform then works the answer out itself, over only the rows that person's job reaches, and
  shows the table with how each figure was worked out, what it covers and how recent it is.
- Dash declares the first two models (`sales_vs_target`, `sales_by_month`) and a chat called
  **FeatherBot** with four modes: Agent (answer in the chat), Reports (answer drawn on the page),
  Ask (how things work, from help pages), Action (send a "target review" request for a person to
  approve).

**One example.** Kumar Test-Staff, Store Manager of Lakeside, asks *"Which subcategories are
furthest behind target?"*

1. The platform checks he may ask: it runs Dash's `report` read rules (his role, his places).
2. It reads his own rows of the cached `sales_to_date` copy and gives the model only the *names* in
   them (his store, his subcategories).
3. The model replies with one SELECT. The platform loads Kumar's rows, and nothing else, into a
   throwaway in-memory DuckDB, switches off file and network access, checks the statement is a
   single SELECT, and runs it for at most 5 seconds.
4. In Agent mode the answer's rows (at most 40) go back to the model to be put into two or three
   sentences. Kumar sees the sentences, the table, "Covers: …", the data date and the SQL.

---

## 2. Where The Agent Surfaces To Users

The earlier standing preference was "no AI features in Featherbase". You asked for this one, so it
is treated as decided; these are the places a person or their data now meets a language model.

| Where | Who sees it | What leaves the instance |
|---|---|---|
| **Ask FeatherBot** button on a Dash report's header line, beside "Report an issue"; opens the side panel | Only someone holding one of the five `Dash Chat …` roles. Given to nobody on install or upgrade | The question, and the names of the asker's own stores, subcategories, sections and departments |
| Agent mode's written sentences | Holders of `Dash Chat Agent` | Also the rows of that one answer (up to 40), figures included. `CHAT_WRITTEN_ANSWERS=off` stops this |
| Reports mode: a card above the report on the page | Holders of `Dash Chat Reports` | Question and names only |
| Ask mode | Holders of `Dash Chat Ask` | Question and up to six help passages |
| Action mode and the Requests list | Holders of `Dash Chat Action`; reviewers hold `Dash Chat Reviewer` | Question and names only |
| Direct routes with no screen: `/api/app_questions`, `/api/app_analyses`, `/api/help/ask` | Today: **anyone signed in** who passes the read's own rules (see risk A3) | As above |

Nothing calls a model unless `ANTHROPIC_API_KEY` is set on the instance. This branch sets it nowhere.

---

## 3. What Was Ported, And What Was Replaced

The branch is a merge of the PR's three commits (authorship kept) plus one forward-port commit.
14 files conflicted. Each thing the PR built on that has since changed was moved to today's
pattern, never kept as the older copy.

| # | The PR had | Today's pattern used instead |
|---|---|---|
| 1 | Routes added to `apps/server/src/index.ts` | Moved to `app-routes.ts`, where app routes now live |
| 2 | Its own System Manager check on `/api/analyst/usage` | `assertSystemManager` |
| 3 | Migrations 0006–0011 | Renumbered 0176–0181 (main is at 0175) |
| 4 | App `feather_dash`, roles `Feather Dash Chat …`, help under `help/feather-dash` | App `dash`, roles `Dash Chat …`, `help/dash` |
| 5 | Dash manifest edited at 0.10.x | Rebuilt on 0.13.40 as step `featherbot`, **0.13.40 → 0.13.42** (#1345 holds 0.13.41). The five chat roles also open Dash, as #1172 requires of every Dash role |
| 6 | Sections and departments looked up from Dash's own Tables (`feather_dash.section…`), which no longer exist | Looked up from the org chart's base Tables (Plant, Section Subcategory, Section, Department Section, Department) through Dash's declared base-Table read: only the declared columns, no retired row |
| 7 | A join could start only from the dataset or from one earlier lookup | A join column may name an earlier lookup (`plant.site`). Needed because a store's figures are filed under its plant, and a section is found by the plant's *site* plus the row's subcategory, the same way the scope provider reaches a section |
| 8 | A chat column docked beside the report, with its own buttons, inputs, pills and tabs | A button on the header line and the shared side panel (the "Report an issue" pattern), so the report keeps the full width after the sidebar. Built from Shop Floor: `Button`, `Segmented` (modes), `Notice`, `StatusPill`, `EmptyState`, `inputClasses`, icon buttons |
| 9 | "From Selvi Store-Manager" as plain text | The sender through the platform's people path (`person-standing.ts`, Dash's `people.describe` read) and Dash's `PersonName`: name, then **code · job · place** |
| 10 | Its own date wording ("10 Nov", locale time) | `fmtDateTime` (17-Nov-2026 09:05) |
| 11 | Sentence-case headings and buttons | Title Case (Sessions, Requests, Waiting For Your Review, Sent By You, Send Request, Show It Again) |
| 12 | Literal borders and its own colours in `style.css` | Tokens only (the `tokens-only` test passes); parts set apart by space and fills |
| 13 | The report-answer card with its own link buttons | Shop Floor `cardClasses` and `Button` |
| 14 | Button always on show for a tester viewing as someone | Hidden while viewing (`data-action`), and the server refuses the question routes until Exit (see A8) |
| 15 | `@huggingface/transformers` added with pnpm 10's build list | pnpm 12's `allowBuilds`: its three install scripts are **declined** until you decide (decision 6) |

Not replaced, on purpose: answer tables still use Dash's own `.fd-table` (the quick view's table),
so an answer reads as the report does. Both should move together when #1348's calmer look lands.

---

## 4. What Is Good And Worth Keeping

1. **Access is decided before the model is asked anything.** A question runs *as* a read the app
   already declares, with the platform's handler in place of the app's: same role check, same
   places, same access log. A person who may not ask costs no model call.
   `apps/server/src/runtime-packages.ts` (`asModelRead`, `askPackageQuestion`).
2. **Generated SQL runs where it cannot reach anything else.** A new in-memory DuckDB per question
   holds only the asker's rows; outside access is off and locked; one SELECT only; 5-second stop;
   1,000-row cut. `apps/server/src/semantic-sql.ts` (`runSql`).
3. **A plan is data, never SQL**, and every name in it is checked against the model.
   `apps/server/src/semantic-model.ts` (`planFault`, `readPlan`, `runPlan`).
4. **Example questions do three jobs.** They are shown to the model, they are the test set, and
   each is turned into SQL by the platform so the SQL examples can never drift from the plans.
   `semantic-sql.ts` (`planSql`).
5. **Missing is never zero.** No figure, or a division by nothing, is blank.
   `semantic-model.ts` (`evaluate`), `semantic-sql.ts` (`nullif`).
6. **One door to the model.** Every call goes through `planModel()`, which checks the month's
   allowance and appends the same safety rules; the provider's error text is never shown to the
   asker. `apps/server/src/plan-model.ts`.
7. **The Action mode cannot act.** The model only fills a form. A store or subcategory must be one
   of the sender's own names; nothing is sent without a plain yes; a reviewer is never the sender
   and decides once. `apps/server/src/chat-requests.ts`.
8. **The manifest is checked at install**, so a model naming a column, Table or role the app does
   not declare never loads. `semantic-model.ts` (`validateSemantic`),
   `chat-declaration.ts` (`validateChat`).
9. **Injection tests with a model that has been "talked into" misbehaving**: read every row, run a
   second statement, delete, copy to a file, attach a database, open the network, approve its own
   request. `apps/server/test/semantic-model.test.ts`, `semantic-sql.test.ts`.
10. **Every answer says what it is**: how each figure was worked out, what it covers, the data
    date. `client-apps/jeyarama/dash/src/ask.ts`, `ask-panel.tsx`.
11. **Usage is counted without the person.** `model_usage` keeps time, model and two token counts.
    `apps/server/src/model-usage.ts`.

---

## 5. What Should Improve, Ranked By Risk

Severity is mine. "Codex" marks a finding the Codex adversarial review raised too (section 6).

### A. Access And Leakage

**A1. A question skips the check that the report was given to the person. — High (Codex)**
The model's read is Dash's `report`. The platform keeps that read's role and places, but swaps out
Dash's own handler, and that handler is where Dash checks the report was *given* to the person
(`reportsFor` in `client-apps/jeyarama/dash/src/server.ts`) and that the places came from the
rules now in force (the business-roles switch). So someone whose job reaches Lakeside but who has
not been given Sales vs Target can still get its figures by asking. No crafted question is needed.
Reach limits *which rows*; it was never meant to say *which reports*. → Decision 1.

**A2. Saved answers outlive the access they were given under. — High (Codex)**
A conversation keeps each answer as shown, figures included, for good. Someone moved off Lakeside
can reopen last month's conversation and read Lakeside's figures; nothing is rechecked on reopen
and nothing is ever deleted. `apps/server/src/app-chat.ts` (`chatSession`). → Decision 7.

**A3. Three routes go round the chat's roles and its daily limit. — High (Codex, in part)**
`/api/app_questions/…` and `/api/app_analyses/…` ask for no chat role, only the read's own rules,
so the "each mode opened by its own role" promise holds on the panel but not on the API.
`/api/help/ask` asks for no role at all. None of the three counts against the 200-messages-a-day
limit, which lives only in the chat's send. One signed-in person could use up the whole instance's
month. `apps/server/src/app-routes.ts`.

**A4. A reviewer sees every waiting request, from any store.**
The review list is not limited to the reviewer's reach: store name, subcategory name and the
sender's reason for stores they do not look after, plus the sender's name read straight from the
Person table whether or not the reviewer may open that person. `chat-requests.ts`
(`requestsToReview`).

**A5. "Covers" shows internal place labels.**
The line under an answer prints the scope provider's labels, which are plant codes
("Covers: 9901"). Readers are never meant to see codes. `runtime-packages.ts`, `ask.ts`
(`coversLine`).

**A6. What goes to the model provider.**
Always: the question and the asker's own names. In Agent mode by default: up to 40 rows of
figures per answer. In Ask: help passages. Kept by the instance for good: every question,
including refused ones (`app_question`), and every chat message. → Decisions 5 and 7.

**A7. Help searches more than help. — Low (Codex: medium)**
`help/sources.json` also lists Dash's README, `openspec/specs/` and all of `docs/`. This
repository is public, so nothing secret leaks, but a store manager's "how do I…" can be answered
from a deploy runbook or a plan like this one. → Decision 6.

**A8. View As. — Fixed in this branch (Codex)**
While a tester views as someone, only reads run as that person; the new routes are POSTs, so the
chat beside the viewed person's report would have answered with the *tester's* figures and
conversations. Now the button is hidden and the four route families answer "Questions are asked
only as yourself. Exit View As to ask." (`app-routes.ts`; test in `view-as.test.ts`). Whether a
tester should instead be able to ask *as* the person viewed is a later choice.

**A9. Names from the data are put into the prompt.**
Store, subcategory, section and department names are shown to the model. A name written to
mislead it ("ignore the rules above…") can at worst produce a wrong plan or wrong sentences about
the asker's own rows; it cannot widen what is read, because the rows are fixed before the model
is asked. The written sentences are shown as plain text, never as links or markup. Low.

**A10. One of the app's own Tables used as a lookup is read whole.**
For a lookup into an app's *own* Table the platform runs `select *` and joins every column. Only
declared dimensions reach an answer or the SQL sandbox, and Dash's lookups now all go through the
declared base-Table read instead, so this path is unused by Dash. It should read declared columns
only. `runtime-packages.ts` (`withRelationships`).

**A11. The SQL sandbox has no proven escape, and two loose ends.**
Codex probed it and found none; nor did I. Still: each question may take 512 MB, so several at
once could exhaust a small server, and a large sort may spill to a temp folder for up to 5
seconds. Cap questions in flight and switch the temp folder off.

### B. Correctness Of The Semantic Layer

**B1. "Last month" now means two things in Dash.** The report's month picker (#750) shows the
whole of last month. FeatherBot's `sales_last_month` counts only the same days of last month as
this month so far. Both are defensible; side by side they will read as a mistake. → Decision 8.

**B2. `sales_by_month` has no refresh guard** and adds a fourth warehouse query (four months, every
store and subcategory) to each four-hourly refresh. The report's datasets all have guards.

**B3. Achieved can be overstated.** `achieved = 100 × sales ÷ target` adds every sale but only the
targets that exist, so a store with untargeted subcategories shows more than 100% sooner. The
report says this in a note under its totals; an answer does not.

**B4. SQL can be valid and still mean the wrong thing.** A plan cannot leave a filter out; SQL can.
The model also declares for itself which columns are percentages. Agent mode is SQL only.
→ Decision 9.

**B5. Two placements at once: the first one found wins, silently.** If a subcategory is placed in
two sections of a site on the same day, the answer picks one without saying so.

**B6. Only the first 200 names of a dimension reach the model.** A whole-company reader has more
subcategories than that; the rest cannot be matched by name.

**B7. The lookup day falls back to the UTC date**, not the day in India, when a model has no data
date. Dash's models have one, so this bites only a future model.

**B8. The verified questions are proved against a real model only by a script someone runs by hand**
(about forty calls). CI proves the plans and the SQL of the plans, not that the model picks them.

**B9. The spec's 39 scenarios are not bound to tests**, which today's `check:scenarios` requires.
The behaviour is tested (141 tests in `semantic-model.test.ts`), but as ordinary tests. The
proposal, design and tasks also still describe the 31-Oct shapes. This is the one red gate.

### C. Cost And Latency

| Mode | Model calls per message | Longest wait |
|---|---|---|
| Agent | 2 (the SQL, then the sentences) | 30 s + 5 s + 30 s |
| Reports | 1 | 30 s |
| Ask | 1, plus embedding the question | 30 s, plus minutes the very first time |
| Action | 1 (none for a yes or no) | 30 s |
| `/api/app_questions` | 1, or 2 when the SQL cannot be used | 65 s |

- **Model:** `claude-sonnet-5-5` unless `ANALYST_MODEL` says otherwise; 1,024 output tokens; no
  streaming; no retry. The person watches "Working on it…" for the whole request.
- **No allowance by default.** `ANALYST_MONTHLY_TOKENS` unset means use is recorded and never
  stopped. Set it before anyone is given a role.
- **The same work is done two or three times per message.** The asker's places are worked out,
  all their rows of both datasets loaded and every lookup Table read in full, once to list names
  and again to answer. For an all-stores reader that is the whole dataset each time. Cache per
  message at least.
- **Prompts are long and not cached.** Up to 200 names for each of four or five dimensions, for
  both models, on every call. The provider's prompt caching is not used.
- **The local help model** (`@huggingface/transformers`) is a few hundred megabytes downloaded
  from huggingface.co on first use, minutes of processor time to embed everything once, and every
  question re-reads and re-hashes every source file. → Decision 6.

### D. UX Against Today's Design System

Checked against `docs/design/look-and-relationships-spec.md` and the house rules.

1. **Not yet seen in a browser.** The panel is proved by 33 tests in a simulated DOM. It still
   needs the UI route: a numbered spec checklist in the issue, then a verifier's "spec vs built"
   table with screenshots.
2. **Four modes named for the machinery.** "Agent", "Reports", "Ask", "Action" ask a store manager
   to know how the answer is made. → Decision 3.
3. **A request is not a record.** TR-12 has no page and no link, and reviewing happens inside the
   chat. Every record should be a link. → Decision 4.
4. **Stores, sections and subcategories in an answer are plain text**, not RecordLinks (spec item 11).
5. **"Covers" shows codes** (A5).
6. **SQL is shown to every reader** under "How These Figures Were Worked Out". Useful to you;
   noise to a Team Leader. Show the definitions to everyone and the SQL to administrators.
7. **Answer tables keep row rules** (spec item 2 says none), as Dash's quick view does today.
8. **Two side panels can overlap**: "Report an issue" and FeatherBot open in the same place.
9. **A Reports answer pushes the report down the page** instead of opening beside it.
10. Done in this port: Title Case, tokens only, shared components, code · job · place for a
    person, the house date format, content keeping the full width.

---

## 6. Codex Adversarial Review

Run from this worktree against `origin/main`, focused on data leakage and prompt injection.

**Round 1 — verdict: needs attention.** "DuckDB probes did not establish a sandbox escape."

| Codex finding | Severity | Where it is above | What was done |
|---|---|---|---|
| Semantic reads bypass Dash's report-assignment checks | High | A1 | Real. Left for decision 1: the fix shapes the manifest |
| Stored chat answers remain accessible after access revocation | High | A2 | Real. Left for decision 7 |
| Direct help calls bypass Ask roles and chat spending limits; corpus includes all docs | Medium | A3, A7 | Real. First task of phase 2. Docs exposure is low here: the repository is public |
| New chat and analysis routes run as the tester during View As | Medium | A8 | Real. **Fixed**: refused while viewing, with a test |

**Round 2 — verdict: needs attention.** Told not to repeat round 1, it looked at the Action mode,
the sender's identity, the base-Table lookups, the sandbox, history in prompts, how the client
draws model output, and the usage accounting. It raised nothing on the lookups, the sandbox or
the client. Three new findings, all from reading the code:

| Codex finding | Severity | What was done |
|---|---|---|
| **A12.** A request prepared for Lakeside can still be sent with a "yes" after the sender has lost Lakeside: the yes sends the stored inputs without checking them again (`chat-requests.ts`) | Medium | Real. Not fixed: decision 4 replaces this queue. If the queue stays, task 12a |
| **A13.** A "yes" confirms whatever the conversation last showed, not a named draft. With two tabs open, yes to draft A can send draft B, and two yeses at once can send it twice | Medium | Real. Same |
| **A14.** The month's allowance and the daily limit are checked before a call and recorded after it, so a burst of questions at once can all pass and overspend (`model-usage.ts`, `app-chat.ts`) | Medium | Real. Added to task 9 |

A third round was not run: both rounds found real gaps of the same kind (checks that are made once
and not held), the fixes wait on your decisions, and a round on unchanged code would repeat them.

Nothing Codex raised was rejected.

---

## 7. Decisions For You

**Who "the project owner" is.** The PR's design says of several choices "the project owner chose".
That is the author's own project owner, not you; the design leaves retention and the help folder to
"the repository owner". So decisions 3, 5, 6 and 9 below were made once already, by someone else.

### Decision 1 · What Lets Someone Ask About A Report's Figures (A1)

| Option | For | Against |
|---|---|---|
| **A. The model names the app's own gate.** Each semantic model names a read of the app that answers yes or no for this person ("may they open the report these figures belong to"); the platform asks it first | Dash's rule stays in one place; a report taken away is taken away from FeatherBot at once; works for any app | A small manifest addition and one more read per question |
| B. Reach plus the chat role is enough | Nothing to build | Two rules for the same figures; a grid change to reports does not reach FeatherBot |
| C. A FeatherBot permission per report in the Business Roles grid | Fits the grid people already use | Larger; still needs A underneath |

**Recommendation: A now**, C when FeatherBot goes beyond a pilot.

### Decision 2 · How People Are Given FeatherBot

| Option | For | Against |
|---|---|---|
| **A. The five app roles, given by hand, for a pilot** | Built; nobody has it until you say; easy to take back | Outside the Business Roles grid that went live today; five roles is a lot to explain |
| B. Permissions in the Business Roles grid from the start | One place decides everything about Dash | More to build before anyone can try it |

**Recommendation: A for a pilot of a handful of named people, then B before a wider release.**

### Decision 3 · What Ships First

| Option | For | Against |
|---|---|---|
| **A. Figures only, one box, no mode picker.** The answer comes in the chat; "Put This On The Page" is a button under it | One thing to learn; the smallest surface to secure; the picker's jargon goes away | Help and requests wait |
| B. All four modes as built | Everything the PR offers | Four names to explain, four roles, and the two weakest parts (help search, the request queue) ship with the strongest |

**Recommendation: A.** Add help next (decision 6), requests through Tickets (decision 4).

### Decision 4 · Requests: A Queue Of Their Own, Or Tickets

| Option | For | Against |
|---|---|---|
| A. Keep `chat_request` and the Requests list inside the chat | Built and tested | A second review queue beside Tickets and approvals; no record page, no link, reviewer not limited by reach (A4) |
| **B. A target review becomes a Ticket.** FeatherBot only fills it in and asks for a yes | A record with a link, an owner, a history; "Report an issue" already raises tickets from this page | Rework of the Action mode; needs Tickets installed |

**Recommendation: B, after the first release.**

### Decision 5 · Do Figures Go To The Model For The Written Sentences

| Option | For | Against |
|---|---|---|
| A. On (the PR's default) | The sentences are what makes it feel like an answer | Up to 40 rows of sales figures per answer leave the instance; a second call per message |
| **B. Off until you have read the provider's data terms, then on by your choice** | No figure leaves; half the cost; the table and definitions still show | Reads drier |

**Recommendation: B.** Make "off" the default in code; switching it on is one variable.

### Decision 6 · Help: How It Is Searched, And What It Searches

| Option | For | Against |
|---|---|---|
| A. As built: a local embedding model, over help, README, specs and docs | No key, no cost per use, nothing leaves for the search | A few hundred MB dependency with three native install scripts; first-use download; minutes to warm; searches engineering documents |
| **B. No search at all: the help folder is four short pages, so send them whole** | Nothing to install or download; always current; answers only from pages written for users | Stops scaling at a few dozen pages; revisit then |
| C. Postgres full-text search | No new dependency | Misses pages that use other words |

**Recommendation: B, with sources limited to `help/`.** That also removes the dependency whose
install scripts this branch declines.

### Decision 7 · How Long Conversations Are Kept, And What A Reopened One Shows (A2)

| Option | For | Against |
|---|---|---|
| A. As built: kept for good, shown as they were | A conversation reads the same later | Figures outlive the access they were given under |
| **B. Keep the question and how it was answered, not the figures; work the answer out again on reopen. Delete after 90 days** | Always today's access and today's figures | A reopened answer can differ from what was first shown; one more read on reopen |
| C. Keep figures, recheck access on reopen, delete after 90 days | Reads the same later | Harder to get right: access can be partly lost |

**Recommendation: B.**

### Decision 8 · What "Last Month" Means In An Answer (B1)

| Option | For | Against |
|---|---|---|
| **A. Keep "same days of last month", and say so in the column heading and the answer** | A fair comparison mid-month; already built | Differs from the report's month picker unless worded clearly |
| B. Use the whole of last month, as the picker does | One meaning everywhere | This month nearly always looks behind until its last day |

**Recommendation: A**, headed "Sales, Same Days Last Month", plus a refresh guard on the dataset.

### Decision 9 · SQL First, Or A Plan First (B4)

| Option | For | Against |
|---|---|---|
| A. SQL only in the chat (as built) | Answers questions a plan cannot express | A valid statement can still drop a filter or pick the wrong divisor |
| **B. A plan first; SQL only when the plan cannot express the question, and the answer says which** | The checked path answers the common questions; same number of calls | Slightly more to wire |

**Recommendation: B.**

---

## 8. Gates On This Branch

| Gate | Result |
|---|---|
| Server typecheck (source and tests) | Pass |
| Web typecheck | Pass |
| Dash build, typecheck, frontend typecheck | Pass |
| `pnpm check:specs` | Pass |
| `pnpm check:scenarios` | **Fail**: 39 fenced scenarios of this change have no bound test (B9) |
| Env docs current, only `env.ts` reads the environment, SQL lint | Pass |
| App versions, vocabulary, sensitive words, platform imports, coverage ignores | Pass |
| Dash unit tests | Pass, 61 files, 1,461 tests |
| Dash platform tests | Pass, 15 files, 255 tests (on a private local database) |
| Server tests for the changed areas | Pass, 110 files that import the changed modules, 2,435 tests, 6 skipped (same database). One of main's guards caught three new column names that look like secrets and are not; they are now named exceptions |
| Whole server suite, web tests, e2e and tours, coverage gates | Not run here; CI runs them on a pull request |
| Seen in a browser | Not done (D1) |

---

## 9. What Is Left After Your OK

Sizes: S is up to half a day, M about a day, L two to three days.

| # | Task | Size | Depends on |
|---|---|---|---|
| 1 | Close the side doors: the question and help routes ask for the mode's role and count against one per-person limit; set `ANALYST_MONTHLY_TOKENS` (A3) | S | — |
| 2 | The report gate, with tests for "has reach, not given the report" and "report taken away" (A1) | M | Decision 1 |
| 3 | Conversations: store no figures, work out again on reopen, delete after 90 days (A2) | M | Decision 7 |
| 4 | One box and no mode picker; written sentences off by default (D2) | M | Decisions 3, 5 |
| 5 | Help from `help/` pages sent whole; remove the embedding model and its dependency (A7) | M | Decision 6 |
| 6 | "Covers" by name; stores, sections and subcategories as RecordLinks; SQL for administrators only; one side panel at a time (A5, D4, D6, D8) | M | — |
| 7 | Semantic fixes: "Same Days Last Month" wording, a refresh guard, the achieved note, two-placements warning, the day in India, declared columns only for own-Table lookups (B1–B3, B5, B7, A10) | M | Decision 8 |
| 8 | A plan first, SQL second, and the answer says which (B4) | S | Decision 9 |
| 9 | Cost: work out places and rows once per message, cache prompts, cap questions in flight, switch the sandbox temp folder off; reserve the allowance and the daily count before a call, not after (C, A11, A14) | M | — |
| 10 | Bind the 39 scenarios to tests; bring the proposal, design and tasks up to today; verify the change; archive before merge (B9) | L | Decisions settled |
| 11 | UI route: numbered spec checklist in the issue, build to it, verifier's "spec vs built" table with screenshots (D1) | M | Task 4, 6 |
| 12 | Requests through Tickets; retire `chat_request` (A4, D3) | L | Decision 4; after first release |
| 12a | Only if the queue stays: a yes names its draft and is used once; inputs are checked again when sent; reviewers limited by reach (A4, A12, A13) | M | Decision 4 |
| 13 | Whole CI on a pull request from this branch (suite, e2e, tours, coverage); take the next free Dash version if #1345 has landed | S | — |
| 14 | Pilot on staging: the key and allowance set, `sales_by_month` refreshed, roles to the named few, the live check script run once | S | Tasks 1–3 |
| 15 | Tell the PR's author what was ported and what changed; close #1354 in favour of the new pull request | S | Your call |

Tasks 1 to 3 are the ones that must land before any person is given a `Dash Chat` role.
