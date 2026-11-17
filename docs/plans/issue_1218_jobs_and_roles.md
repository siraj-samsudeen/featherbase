# #1218 — Jobs and roles: one idea people can follow

Status: **design agreed 17-Nov-2026 (D1–D9)**. Nothing built. Building needs the owner's yes. Questions are asked one at a time; each answer is recorded below.

## The problem in one line

Two things decide what a person gets in Dash — their **job** (from StyleHR) and their **roles** (ticked by hand) — and they overlap, so no one can say in one sentence why someone sees a report.

## Map: where each is used today (origin/main, 16-Nov-2026)

### Jobs (Job Assignment: job, designation, site, floor, section, reports_to, dates — loaded from StyleHR)

| # | Where | What the job decides | Example |
|---|---|---|---|
| J1 | Dash reach (`dash/src/provider.ts` `reachOf`) | Which stores and subcategories a person's figures cover | A Team Leader at Store B sees their section's subcategories at Store B; a Store Manager sees all of Store C; a Cluster Manager sees their cluster; Director / COO / MD see every store |
| J2 | Dash reach — no reach | Gives the reason shown when someone reaches nothing | "Head office staff" reaches no store, so the page says why |
| J3 | Report access (`report-access-server.ts`) | A report can be given to a **job** | "Vendor Sales" given to Store Manager, Floor Manager, … one row per job |
| J4 | Department Manager reach (#1195) | Which department's sections | A Department Manager reaches the sections of the department they manage at their store |
| J5 | Team picker (#1217, shipping) | "My team" = people whose job assignment reports to me | A category head gives a report to their direct reports |
| J6 | Person identity (#1216) | Shown beside a name so same-named people can be told apart | "Team Leader · Store B" |

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

### D2 — Reach (owner, 17-Nov-2026: "q2 yes")
Every permission is a thing, a verb and a reach: **Own, Team, Area or All**. The area is read from where the person's assignment sits on the axes: location (company › region › cluster › store › floor › section) and merchandise (division › subdivision › category › subcategory). Team is read from the reporting line. No permission is named after a place. Dash All-Stores Reader goes away, because a head-office assignment's area is "whole company".

### D3 — Basic (owner, 17-Nov-2026: "yes option B")
Basic, for everyone with a current HR record: Tasker and Tickets, working on their own things. Dash is not in Basic. It comes with a business role from Team Leader up (Team Leader, Floor, Department, Store and Cluster Manager, Buyer, Category Head, Head Office, leadership). Floor staff can be given Dash later by changing the Staff role once.

### D3a — End dates (owner, 17-Nov-2026)
An end date is **optional** on every role assignment, including "Also give" and External people. Without one, access lasts until someone removes it, or for employees until they leave.

### D4 — Who reports go to (owner, 17-Nov-2026: "Yes, option A — but we have report bundle as well as reports")
A grant gives **one report or one report bundle**, as today, to **one or more business roles** named in that one grant. Giving to a single person is an exception and needs a reason. Grants to a job or to an app role (Dash Reader) go away. Each receiver still sees only their own area (D2). Example: Vendor Sales becomes one grant to Store, Floor, Department and Cluster Manager, instead of 8.

Follows from D2, so it is stated here rather than asked: who may give is the permission **Give reports**, with a reach.
- **Team** goes to managers (today's Team Report Manager, #1217).
- **All** goes to one hand-given role (today's Report Access Manager).

Neither stays a separate role.

### D5 — No overlays, no starter set (owner left it to the agent, 17-Nov-2026; decided by "simplest that stays flexible")
Business roles are designed for Jeyarama alone, and kept as **data in the instance** (rows an instance admin edits), never in app code. Each app ships only its own permissions. Nothing is copied in from a starter set and nothing inherits from a layer. If a second retailer comes, Jeyarama's roles can be exported as the first starter set, because they are already data. There is no store or department layer: a store's differences are its area (D2).

### D6 — Hand changes (owner, 17-Nov-2026: "option A")
Two actions on a person, with an optional end date on both:
- **Correct** replaces the role the HR title gave, and survives StyleHR reloads until someone removes it.
- **Also give** adds a second role, each with its own area.

HR-derived roles are never edited directly. Explain-a-person shows the source of every role: HR title, merchandise assignment, corrected by hand, or also given by hand.

### D7 — One word per thing (owner, 17-Nov-2026: "yes")
- **Site** on admin screens, for any physical place.
- **Store** on Dash and staff screens, which only show sites that sell.
- **Plant** is SAP's code. It is never shown to staff and is never on the location axis; reaching a site reaches its plants.
- The Glossary keeps the other names people use ("outlet", "branch"), and search matches them.

### D8 — Vendors (owner, 17-Nov-2026: "yes")
- **Vendor** is a ready-made business role for External people, given by hand with an optional end date.
- Its area sits on a new **Supplier** axis: a vendor sees only their own supplier's articles.
- **Consultants** get apps one at a time ("Also give").

### D9 — Master Data Steward (owner, 17-Nov-2026: "yes")
- Master Data Editor and Data Quality Manager merge into one role, **Master Data Steward**.
- It can read, create and update master tables at All reach, and cannot delete.

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

## Owner, 17-Nov-2026 (via the Person page session): Vendor and Consultant confirmed as labels on External

He expects to give vendors some access. Proposed: **Vendor** is a ready-made business role, given by hand with an end date. Its area sits on a fourth axis, **Supplier**: a vendor sees only their own supplier's products, for example a Vendor Sales report narrowed to their articles. Consultant has no fixed shape, so a consultant gets apps one at a time ("Also give"). Queued as a question after Q2, because it depends on the reach and axes answer.


## What building this means (for a later issue, not started)

1. **Business role** becomes instance data. It lists what it includes, as rows of permission × reach.
2. **Title map**, owned by Jeyarama. Titles nobody has mapped yet wait on a visible list.
3. **One assignment shape**: person · business role · area (a point on each axis) · source · optional end date. It is fed by Job Assignment, Merchandise Assignment and the two hand actions.
4. **Dash moves onto the model**:
   - The front door opens through a business role that includes Dash.
   - Reach follows the area.
   - Report grants name business roles.
   - The roles Dash Reader, Dash All-Stores Reader, Report Access Manager and Team Report Manager go away.
5. **An "Explain a person" screen.** Build this first, because every real failure was a failure to explain.
6. **Moving people over:**
   - map today's hand-given roles onto business roles;
   - turn grants that name a job into grants that name roles;
   - merge Master Data Editor and Data Quality Manager into Master Data Steward.

Each of these is its own issue with its own review.

## Note from the manager session, 17-Nov-2026: one encoding for the merchandise area

Dash's reach now sends merchandise as **code prefixes**, and Dives match them with `starts_with` (dash-reach-prefixes; this fixed HTTP 413 on the embed API):
- 2 digits for a division (02 Home, 03 Grocery);
- 4 digits for a category;
- 9 digits for a subcategory.

D2's Area on the merchandise axis must produce exactly this shape, so one encoding serves both the permission check and the Dive filters. A Category Head's area is therefore one 4-digit prefix, not a list of 9-digit codes.

(Store codes in this plan were replaced with "Store A/B/C" before pushing to the public repo.)

## Relational navigation: the final structure (17-Nov-2026)

The owner reviewed the options page (https://claude.ai/artifact/Sx27C7Z95q7Pq4wHcpzHaY, source `docs/plans/issue_1218_relational_navigation.html`):
- Lens: good.
- Map, showing both sides: very good.
- Grid: good idea, but it looked ugly with rows stretched tall, and a long y-axis is hard to read. The page is now fixed with compact rows, a sticky first column and horizontal headers.
- Columns and Sentences: good.
- Explore: unusable today.

Production was toured the same day. Its record panel, path bar, Map and Tree draw the same links in three places, and they show link rows by their codes.

The structure: one walk in the path bar, and each place does one job.

| Place | Job | What changes |
|---|---|---|
| List page | Find rows | "Add filter" gains Linked to… and Not linked to…, so Explore's chains are built from the list. |
| Record panel (side) | A quick look | Its groups list one row per line, by the far side's name. |
| Record page | Work on one record | Tabs: Form · Links · Map · Activity. Tree becomes Links, with Edit as ticks, source chips, Why? and Open as grid. |
| Map | See and explain | Link tables collapse to their far side. Why mode where a path is declared. "Open in Explore" goes. |
| Grid | Compare and tick many | Offered only for small pairs, about 40 × 40. Replaces the permission matrix. |
| Path bar | Where I came from | Adds a sideways ▾ for siblings. |
| Explore | — | Retired once the filter bar can follow links. |

A view appears only where it makes sense. The app admin sets each table's default view, and each person's last choice is remembered.

**Slice 1, being built overnight** on local branch `relational-nav-slice1-far-side` (worktree featherbase-wt-links): links read by what they point to, in the record panel, the Tree and the Map. Its spec is `docs/plans/relational_navigation_slice1.md`. Filing its GitHub issue was blocked by a permission check; the owner files it.

## Owner, 17-Nov-2026: what is built must match what is shown, and simplicity comes first

- **The main disappointment last time was the gap between the design pages and what got built.** Every slice is therefore checked by an independent verifier, who puts the built screen beside the mockup and lists each difference. The build must be close to the mockup, not just pass a checklist.
- **Reusable components, used the same way everywhere.** One far-side rule, one "linked rows" group component, one tick list and one grid. The record panel, record page, Person page and app pages all use the same ones.
- **Tableau or Apple simplicity, not Power BI or Excel.** The screen stays simple: smart defaults suited to the task do the work for most people, and power users can change things. Concretely:
  1. One obvious default per place. Each option is offered only where it applies (Grid only for small pairs, Why only where a path is declared).
  2. Options are found where you look, not on settings tabs. Each control sits beside what it changes, and a "View ▾" menu holds the rest.
  3. Every change a person makes is remembered: per view where a saved view is open, otherwise per person per Table. The app admin sets each Table's default.
  4. No dialogs full of tabs. If an option needs explaining, it isn't a default-level option.
