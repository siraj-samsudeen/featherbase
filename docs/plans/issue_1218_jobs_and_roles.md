# #1218 — Jobs and roles: one idea people can follow

Status: **design in progress** — nothing built. Questions are asked one at a time; each answer is recorded below.

## The problem in one line

Two things decide what a person gets in Dash — their **job** (from StyleHR) and their **roles** (ticked by hand) — and they overlap, so no one can say in one sentence why someone sees a report.

## Map: where each is used today (origin/main, 16-Nov-2026)

### Jobs (Job Assignment: job, designation, site, floor, section, reports_to, dates — loaded from StyleHR)

| # | Where | What the job decides | Example |
|---|---|---|---|
| J1 | Dash reach (`dash/src/provider.ts` `reachOf`) | Which stores and subcategories a person's figures cover | A Team Leader at KNP sees their section's subcategories at KNP; a Store Manager sees all of PKD; a Cluster Manager sees their cluster; Director / COO / MD see every store |
| J2 | Dash reach — no reach | Gives the reason shown when someone reaches nothing | "Head office staff" reaches no store, so the page says why |
| J3 | Report access (`report-access-server.ts`) | A report can be given to a **job** | "Vendor Sales" given to Store Manager, Floor Manager, … one row per job |
| J4 | Department Manager reach (#1195) | Which department's sections | A Department Manager reaches the sections of the department they manage at their store |
| J5 | Team picker (#1217, shipping) | "My team" = people whose job assignment reports to me | A category head gives a report to their direct reports |
| J6 | Person identity (#1216) | Shown beside a name so same-named people can be told apart | "Team Leader · KNP" |

Merchandise Assignment works like a second kind of job for buyers and heads:

| # | Where | Example |
|---|---|---|
| M1 | Dash reach | A Buyer for Women Ethnic Wear subcategories in Kerala sees those subcategories in every Kerala store |
| M2 | (not used) | Report access cannot be given to "Buyer" or "Category head" today |

### Roles (Person.roles — ticked by hand by a System Manager)

| # | Role | What it decides | Example |
|---|---|---|---|
| R1 | Dash Reader | Opens Dash's front door (`can_open`); a report can be given to it | A Team Leader saw a report because they held Dash Reader, not because of their job |
| R2 | Dash All-Stores Reader (#1192) | Opens Dash and reaches **every store**, like a Director's job | Head-office staff with no store job |
| R3 | Report Access Manager | Gives any report to anyone; sees every grant; adds Dives | Company-wide power |
| R4 | Team Report Manager (#1217, shipping) | Gives reports to own direct reports only | A category head and their buyers |
| R5 | System Manager | Everything, including all of R3 | Administrators |
| R6 | Master Data Editor, Data Quality Manager, Tickets Support, Tasker Member, Access Auditor, Dash Section Editor/Reviewer, Dash Review Reader | Platform and other apps: which Tables a person may edit | A Master Data Editor edits stores and sections |
| R7 | Report access by role | A report can be given to a **role** | Report given to "Dash Reader" reaches everyone holding it |

### The three confusions, traced

1. **Team Leader saw a report through "Dash Reader"** — R1 + R7: the report was given to a role many people hold, so it reached people whose job wouldn't.
2. **Category head locked out** — Dash's front door (R1) needs a Dash role; the category head's Merchandise Assignment (M1) still reached stores, but taking the role away shut the door before reach was looked at.
3. **Vendor Sales re-given to 8 jobs** — J3: a grant names one job; there is no "group of jobs", and grants only add, so eight rows.

### Already decided (do not re-ask)

- 27-Oct-2026 (#392 → #449): roles should be real floor jobs, not screen permissions; Dash access should come from the job.
- 10-Nov-2026 (#1172): Dash opens for anyone holding a Dash role.
- 11-Nov-2026 (#1192): a role can reach every store, for head-office staff.

## Owner's correction, 17-Nov-2026 (supersedes the first Q1)

The first Q1 treated "job" as given. It isn't:

- **Designation** is HR's title, and it often isn't what the business calls the person. One store manager's designation is an operations title, but he runs a store. An AGM Operations is a cluster manager. Buyer head, assistant category manager and buyer are all buyers.
- Today the job is guessed from the designation by a whole-title match hard-coded in a script (rama_dw `scripts/prepare_store_org_chart.py`, `JOB_ALIAS`: "store manager" → Store Manager …). Anything else goes to "needs matching" and is fixed by hand.
- Roles today are named after apps and tables (Tasker Member, Dash All-Stores Reader), not after the business.
- Sometimes a designation and a role are the same thing; sometimes a designation maps to a role; sometimes a person needs one or more roles of their own.
- The owner asked: should fine-grained roles be grouped into combined roles ("role bundles")? A person or a designation could then receive one or more roles or bundles. The model should follow how Unix and Postgres handle permissions.

### The model proposed in answer (Postgres-style)

| Layer | What it is | Who sets it | Example |
|---|---|---|---|
| Designation | HR's title, as StyleHR has it | StyleHR, never edited here | "AGM Operations" |
| Business role | What the business calls the position | A designation maps to one by default; a person can be given one directly | Cluster Manager |
| Permission | One thing in one app | Ships with the app | "Open Dash", "Give reports to my team", "Edit master data" |
| Place | Where the role applies: store, floor, section, cluster, region, subcategories | The assignment row | Cluster "Kerala South" |

- In Postgres, a user and a group are the same thing: a role. A role can be made a member of another role and inherits what that role may do. There is no separate "bundle". Unix groups can't contain groups, which is why Postgres is the better pattern here.
- So: **one word, "role"**, and any role can include other roles. Business roles include permission roles: Store Manager includes Open Dash; Category Head includes Open Dash and Give reports to my team.
- **What and where stay apart**: the role says what you may do; the place on the assignment says where. This is Postgres's privileges plus row-level security.
- Job Assignment and Merchandise Assignment both become "this person holds this business role at this place, from–to". A Buyer is a role whose place is subcategories plus a region.
- Reports are given to roles. "Vendor Sales" goes to one role, "Store leadership", which includes Store Manager, Floor Manager and Department Manager: one grant, not eight.

## Owner's second steer, 17-Nov-2026, and an independent review

The owner asked for:
- platform-level admin roles (an instance admin, today's System Manager, and an app admin per app);
- business roles inside apps;
- the "overlay" idea: app → retail domain → customer → store or department;
- no "X Member" roles ("just say who has access to Tasker");
- apps → tables → actions, where most actions are CRUD and some are not;
- one picture that maps it all without overwhelming people;
- a second opinion from Fable.

**Fable's review (17-Nov), in short:**
- Keep "the role says what, the assignment says where", with HR and merchandise feeding assignments.
- **Cut unlimited role nesting.** Use three fixed levels: business role → bundle → permission. Postgres-style depth makes "why can she do this?" unanswerable.
- **A role never travels without its place.** A Store Manager at A who is also a Buyer for region B gets no buyer rights at A.
- **"Everywhere" is an explicit place** ("Whole company"). Dash All-Stores Reader is a place, not a role.
- **Overlays are over-engineering today.** Ship a starter set, copy it in at setup, and tag each role "from starter / changed / our own". Add live layers only when a second retail customer exists. Below the customer there should be no overlay; delegate *assigning* roles instead.
- **Two buttons for hand changes:** "Correct" replaces the role from the title; "Also give" adds one, with a reason and an end date. Access only adds up; nothing subtracts.
- **Permissions grid:** app → thing → View/Add/Edit/Delete, plus plain verbs on the same row. Bundles are named app plus level ("Dash – Reader").
- **Build "Explain a person" first:** all three real failures were failures to explain.
- Precedents: Workday (role at an organisation, derived from position), Google Cloud IAM (role R on place P), Salesforce permission-set groups, Odoo per-app levels, Frappe role profiles.

**Explainer page:** https://claude.ai/artifact/2pBL38avaX3Hykg6DY38Gf (source `docs/plans/issue_1218_roles_map.html`). The people in it are made up.

## Questions queued

- ~~Q1 (16-Nov): job decides, roles only as exceptions~~. Withdrawn after the owner's correction.
- ~~Q1 (17-Nov, first form): one concept with nesting, or roles plus bundles~~. Reframed after Fable's review.
- Q1 (asked 17-Nov): three fixed levels (business role → bundle → permission), or Postgres-style roles inside roles?
- Q2: Hand changes as two actions, "Correct" (replace) and "Also give" (add, with an end date)?
- Q3: A starter set copied in at setup, or live layers (app → retail → customer → store)?
- Q4: Reports given to business roles only, with a single person as a rare exception, and one grant able to name several roles?
- Q5: From the manager session, 16-Nov: should Data Quality Manager merge into Master Data Editor? On 16-Nov, with the owner's approval, Master Data Editor got read/create/update (no delete) on 42 master tables. Data Quality Manager covers 35 of those same tables. The owner wants Master Data Editor to be the superuser for master data.

## Decisions

_(one per question, in order; each with the options shown, the owner's answer and the date)_

## Owner's steer, 17-Nov-2026: app access is the first thing people think of

Clients think "give these apps to these people or roles". The finer detail comes after that, inside each app.
So level 2 is renamed **"App and level"** (Dash · Reader, Tasker · Manager). Holding any level of an app means the person can open that app.
A business role reads as a list of apps, each at a level. Explain-a-person shows "Apps it opens, and at what level".
Open: may an app and level be given straight to one person (for example a consultant given Tasker · User), or only through a business role? This is folded into Q1.

## Decisions

### D1 — Shape (owner, 17-Nov-2026: "Yes, agree")
Three fixed levels: business role → app access → permission. Normally a person gets apps through their business role. As an exception, one person can be given an app directly, with a reason and an end date (consultants, guests). No roles inside roles. No "X Member" roles.

## Owner's steer, 17-Nov-2026: fine-grained by area, and fewer words

- Master data needs fine-grained rights: a category manager manages their category, and a store manager manages the sections in their store.
- The location hierarchy is store → cluster → region → whole company. Site, store and plant are near-synonyms. How should they be handled?
- "Use Dash" / "Dash Reader" / "Reports: View" is redundant. There should be one Basic bundle that gives most apps, with CRUD on your own things. A manager adds team level.
- Team, location and category are separate hierarchies that cut across each other, like a consulting n×n matrix. How do we present that simply?

The answer drafted in the explainer: every permission is a thing, a verb and a **reach**: Own, Team, Area or All. The area comes from the assignment, as one point on each axis (location, merchandise). Its place in the people tree gives the team. To be asked as Q2.

## Owner's steer, 17-Nov-2026: no "Guest"; leavers kept separate

"Guest" would become a catch-all, since a consultant could be a guest too. Proposed, all worked out from the HR record, with nothing new stored:
- **Employee**: has a current Employee row. Gets Basic plus their business role.
- **Former employee**: has only Left rows. Gets nothing automatically.
- **External**: has no Employee row. Gets only what someone gives by hand ("Also give", with an end date). "Consultant" is an optional label.

The platform's built-in "Guest" role (anonymous visitors) is another reason to avoid the word. Sent to the Person page session (#1267).
