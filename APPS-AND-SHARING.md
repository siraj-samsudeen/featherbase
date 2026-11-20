# Apps, packages, extension points and sharing between instances

The second half of the design. `BIG-PICTURE.md` says what a Table is, where it lives, and how data comes
in and is cleaned. This document says what an app is, how apps add to Featherbase and to each other, how
upgrades work, and how instances share data.

Agreed between the owner and Claude in a design session on 18 and 19 November 2026, separate from the one
that produced `BIG-PICTURE.md`. A third session on 19 and 20 November rethought both halves from first
principles; its decisions are in section 11 and change several things in this document and in
`BIG-PICTURE.md`. Nothing here is built. Every decision is written with the alternatives
that were weighed and why each was chosen or rejected, so that it does not have to be re-argued from a
one-line summary. Read it before any design choice that touches apps, access, upgrades or instances.

Where this document and the rest of this branch differ, neither wins by default: the difference is
brought to the owner (see section 2).

## 0. How to read this

- **"Chosen by"** says who made the call. "Siraj" means he picked it himself, sometimes against my
  recommendation; those are marked. "Claude, delegated" means I chose under his standing permission to
  take small, reversible technical choices. He has not reviewed those individually.
- **"Firmness"** says how settled it is: *firm* (he was explicit), *leaning* (agreed quickly from my
  recommendation, worth a second look when it is built), or *provisional* (my choice, unproven).
- Siraj's own words are quoted where they carry the reason. Several were dictated, so quotes are lightly
  cleaned.
- Nothing here is built. A first attempt at code from that session was discarded (section 8).
- Decisions 30 to 47 come from the first-principles review and are in section 11. Each says which
  earlier decision it re-examines.

## 1. What Siraj wants, in his words

Said on the night of 18-Nov, after the design decisions:

> "This project started by me asking Fable to do a clone of Frappe. Many of the features that it cloned
> are not useful and they are not the ones that I would have designed if I thought through from the
> beginning. My desire is a platform that allows me to build an ERP, build a CRM, help me to bring a lot
> of Excels that are used for bronze to silver cleanup in my data warehouse, things that are only housed
> in Excel, bring and put them into a system that the users can edit. I'm not building a print-based
> system or form or an external website. This is something that I want to use to build the different
> apps my clients have when I'm delivering data warehouse solutions. Really the core is: I bring in
> Excel, I drop it, the tables are set up in Postgres, the backend API is set up, the frontend is set
> up."

And the three concerns that opened this session (18-Nov):

1. "App" mixed two ideas: a way to group things, and a data wall ("a Chinese wall"). It behaved like a
   wall, "which is actually very inconvenient when I'm building multiple client apps".
2. "Apps should be able to contribute to the platform with some minor extension points", VS Code style.
3. One instance holds many apps; he also wants the reverse view: Tasker as an app, run for three
   clients, "now I want to see instances under that, so both types of views are possible".

His instruction on earlier decisions, which governs everything below:

> "Do not assume any previous decision is the decision that I agree to. I am thinking about this from
> first principles... These were the constraints I had when I started. Now we have multiple apps that we
> are building, and there are external contributors who are building. I don't want to hit a wall and
> then start building... I think it's time to build them, even if it is costly, cumbersome or complex."

So ADRs 0011, 0013, 0014 and decisions D1–D11 / S1–S13 of the old system are inputs, not constraints.

## 2. How this fits the rest of this branch

**Where the two design sessions agree:** Bun, ElysiaJS, Postgres, Drizzle; HTML rendered by the server
with htmx, React only where a screen needs it; folders by feature; tests from outside only; each promise
tested once and 100% coverage; start from Excel; a Table can move between `masters` and an app in one
deliberate step.

**Neither half wins by default.** This section first said that this branch's rules win. The owner
changed that on 19-Nov-2026: where the two halves differ, the difference is brought to him as a
question, one at a time, with options and a recommendation. Section 11 holds the answers so far. The
branch's folder map, testing rules and vocabulary have not been re-examined yet and stand until they
are.

**Deliberate decisions of this branch that the second session questioned. They are NOT open.** The owner
confirmed on 19-Nov-2026 that each was a conscious choice:

- People, sign-in and access rules come later, "when people sign in". Decision 42 keeps this timing and
  adds one thing: the gate itself exists from the first build.
- The first import is a comma-separated file with dates written `2015-01-01`.
- Delete really removes the row in the first build; soft delete comes later.
- The import is one transaction and runs while the person waits.
- Drizzle on Bun's own Postgres driver and the `feather-testing-elysia` harness are confirmed at setup.

One finding from the second session is worth carrying to the day people and access are built, as
information and not as an objection: in the old system a token carried no limits and the server forgot
which token made a request, and row permissions were checked in five separate layers. Sharing between
instances (decisions 5 to 7, 16, 17) needs every read and write to pass one gate that knows the person
and the token. Decisions 42 to 47 now design that gate.

**Still to reconcile between the two halves:**

1. **A column that a package adds to another Table (decision 10)** against this branch's rule that a
   Table's physical shape is a contract with the change-data-capture package, and that Featherbase's own
   columns start with an underscore. A package-owned column named `<app>__<field>` would appear in
   `bronze_featherbase`. Whether that is wanted, and what its name should be, is open.
2. **"Seeds"** here means curation data. Packages may still need starting rows of their own; keep the
   two words apart.
3. **Process.** `TESTING.md` says OpenSpec is deliberately not used here. Whether each build still starts
   from a GitHub issue is the owner's call.

**A resource, when Excel workbooks arrive:** the owner's October stack evaluation holds a spec for
"Import from Excel or CSV" with 195 scenarios of reading rules (sheets, the header row, serial dates,
percentages, phones, leading zeros), in the private repository
`siraj-samsudeen/featherbase-stack-evaluation` under `phase-4-backend-bake-off/4d-v2-import/spec/`. Mine
it for sentences; the owner decided not to carry its code.

## 3. Decisions on the app boundary and extension points

Decisions are numbered in the order they were taken, so the numbers are not consecutive within a section.

### Decision 1 — What kind of boundary is an app?

**What the old code does (read 18-Nov).** An app's *server code* is refused another app's Tables
(`apps/server/src/runtime-actions.ts:128`, "Actions cannot access another application's owned Tables").
But an app's *browser page*, the generic Admin screens and MCP already reach any app's Tables that the
person's roles allow. A Reference column to another app's Table is allowed, yet the app's own code
cannot open the linked row. The only supported way round was Dash's: drop its own people Tables and read
the instance's Tables through a `linked_tables` setting. So the wall stopped app code and protected
nothing a person couldn't already reach.

**Options.**
- **A. Keep the rule.** App code never touches another app's Tables; shared data moves out to instance
  Tables. *For:* nothing to build; upgrades stay calm. *Against:* every shared Table has to leave its
  app; two apps for one client can't build on each other.
- **B. An app owns, the instance walls.** The instance is the only data wall. An app owns its Tables'
  shape and upgrades. Other apps may use them when declared; the person's roles still decide each row.
  *For:* matches what the browser and MCP already allow; it is where Salesforce (the org) and Frappe
  (the site) draw the line; the owner still controls its own schema. *Against:* an owner changing a
  Table can break a reader, so a check is needed at upgrade.
- **C. No boundary (Frappe).** Any app reads and writes anything. *For:* simplest to build on.
  *Against:* one app can corrupt another's data; this is what ADR 0011 rejected as the cause of
  Frappe's upgrade pain.

**Chosen: B.** By Siraj, on my recommendation. **Firmness: firm.** It is the direct answer to his first
concern. The "against" of B is handled by decision 4.

### Decision 2 — Which kinds of contribution are built, and when?

**The four kinds an app could not do:** (1) add a section to any record page, including the platform's
or another app's; (2) react to another Table's events; (3) add its own field to a Table it doesn't own;
(4) offer slots of its own for other apps to fill.

**Options.** I first recommended building (1) only, then, when he asked "why can't we do more than one",
(1) and (2) together and holding (3) and (4). My reasons for holding: (3) changes the Table engine and
needs an uninstall rule; (4) had no second app asking for it, and ADR 0013 said a feature joins the
platform only when a second app needs it.

**Chosen: all four, now.** By Siraj, **against my recommendation**. **Firmness: firm.** His reason is
the quote in section 1: several apps and outside contributors already exist, and he does not want to
hit a wall and then start building. He explicitly withdrew ADR 0013's "second app" rule and accepted
the cost.

Later the same night he added three more kinds when discussing plugins (decision 18): renderers for a
kind of field (his examples: a Mermaid diagram viewer, a Markdown viewer), themes, and commands with
keyboard shortcuts.

### Decision 3 — What shape is an extension point?

Example used: Equipment adds an "Assets held" section to the Person page.

**Options.**
- **A. Data only.** The app declares the slot and a read; the platform draws the rows with its own
  list. *For:* no UI code; always consistent; every row a record link for free. *Against:* can't show
  what the generic list can't (a chart, a custom card).
- **B. Kit component.** The app ships a component built from the shared UI kit; the platform mounts it.
  *For:* any layout. *Against:* each app can drift in look; a broken component is a broken section.
- **A and B together.** Data only by default; a component when the section needs it; the manifest says
  which. *For:* most sections cost no UI code and the rest aren't blocked. *Against:* two paths to
  document and test.
- **C. Patch the page (Odoo, Frappe).** App code reaches into the page. *For:* anything is possible.
  *Against:* the page layout becomes a contract by accident; upgrades break. Odoo's upgrade guide lists
  moved view targets as a common break.

**Chosen: A and B together.** By Siraj, on my recommendation. **Firmness: firm on the principle**
(declared slot, host draws, never patch); **provisional on the mechanism**, because the stack changed
afterwards. With HTML-first pages (decision 24) the natural form is: *an HTML fragment by default, a
web component when a section needs behaviour.* That re-statement is mine (Claude, delegated) and
untested. A feasibility read of the old code found the component path was the hard part there (each
app is a separate bundle with its own React), which is the main reason HTML fragments are attractive.

### Decision 4 — Which of an app's Tables can other apps use?

Example: Equipment wants to read Tasker's tasks; Tasker also has working Tables it keeps for itself.

**Options.**
- **A. Everything is readable.** *For:* nothing for the owner to do. *Against:* every column becomes a
  promise the owner can't change safely.
- **B. The owner publishes** (Salesforce's `global`). The owner marks Tables and columns as published;
  others use only those; a published part can grow, and removal needs a deprecation step. *For:* the
  owner knows exactly what it promised. *Against:* the owner must choose up front, and a reader may want
  a column that isn't published yet.
- **C. Readers declare, a check protects them.** Everything is usable; each reader lists what it uses;
  an upgrade that would break a listed use is refused. *For:* no up-front choice; breakage is caught.
  *Against (as I first argued):* an owner's build can't see readers that live in other repositories.

**Chosen: C, with the check done by the instance.** By Siraj, **against my recommendation of B**.
**Firmness: firm.** His reasoning, cleaned: readers declare what they use; all the installed apps in an
instance can always be checked together; the problem I raised only arises when public apps depend on
private ones, "but those are things we can always work around"; and "I need many apps being built by
one team for one client to be as seamless as possible". He was right that the instance sees every
installed app wherever it came from, which removes my objection. The check runs at install and at
upgrade.

**Feasibility (old code):** medium, plain work. The closest existing check was a health check on
declared Tables, plus a link-target check at install.

### Decision 8 — Can one app write another app's rows?

Example: Equipment marks an asset "Needs repair" and wants a task to appear in Tasker.

**Options.**
- **A. Only through the owner's actions.** *For:* the owner's full logic always runs. *Against:* an app
  can do only what the owner thought to offer; each new need waits on the owner.
- **B. Direct, declared writes.** The app declares the Tables it writes and saves through the
  platform's normal save. *For:* seamless. *Against:* logic the owner keeps inside its actions is
  skipped, and the owner can't prevent that.
- **C. Direct by default, the owner can close a Table** to "write through my actions only". *For:*
  seamless for most Tables; the owner protects the few where its action logic matters. *Against:* two
  cases to explain.

**Chosen: C, plus the owner may offer actions that other apps call.** By Siraj. He picked C on my
recommendation and then added the second half himself: "the owner can provide actions and then the app
can use them if needed." **Firmness: firm.**

**Why direct writes are safer here than in Frappe:** every save goes through the server and runs the
Table's validators and triggers in one transaction, whichever app asked. A feasibility read confirmed
that in the old code the owner's validators already ran in the same transaction when another caller
saved its row. The only thing a direct write can skip is logic the owner put in an action instead of on
the Table, which closing the Table covers.

**Open:** whose permissions a call to another app's action runs under. My leaning: the calling person,
re-checked against the owner's rules. Not decided by Siraj.

### Decision 9 — How does an app react to another Table's rows?

Example: Equipment saves an asset as "Needs repair"; Tasker should open a task.

**Options.**
- **A. Inside the save only.** The reaction runs in the owner's transaction. *For:* the asset and its
  task are always both there or both absent. *Against:* a bug or slow step in the reacting app blocks
  the owner's save; with several reacting apps the order needs a rule (Salesforce documents that its
  trigger order isn't guaranteed).
- **B. After the save only.** Queued and retried. *For:* the owner's save never depends on another app.
  *Against:* for a moment the asset exists without its task; a reaction can arrive twice or late; no
  app can refuse another's save.
- **C. Both, and the app says which.** "Check before save" runs in the transaction and may refuse;
  "react after save" is queued and retried. *For:* rules that must hold use the first; everything else
  can't break the owner; the install screen can say "Tasker can refuse Equipment's saves". *Against:*
  two mechanisms, and the after-save path needs a retry log an admin can read, and a way to replay.

**Chosen: C.** By Siraj, on my recommendation. **Firmness: leaning.** Proposed with it and not
contested: checks run in install order and the first refusal stops the save.

**Open, and it matters:** may a "check before save" on another app's Table *change* the row, or only
refuse it? In the old code validators changed the row in place and apps relied on that. Letting one app
rewrite another's row is close to what ADR 0011 rejected. My leaning: refuse only. Not decided by Siraj.

**Evidence:** Shopify tells apps not to rely on receiving after-save events and to run a catch-up job;
hence the retry log and replay. In the old code a job queued during a save already committed or rolled
back with it, but apps had no way to queue one.

### Decision 10 — How does an app add a field to a Table it doesn't own?

Example: Dash wants a "Reach" field on Person.

**Options.**
- **A. A real column carrying the app's name** (for example `dash__reach`), declared in the manifest.
  *For:* it is an ordinary field in the Table's metadata, so filter, sort, export, MCP and the generic
  form all work with no extra code; the prefix prevents two apps colliding (Odoo's docs warn that
  same-named fields "silently overwrite"). *Against:* another app's column sits in the owner's Table,
  so the owner's upgrades must leave foreign columns alone; needs an uninstall rule.
- **B. A side Table the platform shows as fields.** *For:* the owner's Table is untouched; uninstall is
  clean. *Against:* filtering and sorting by the field needs a join the generic list doesn't do; every
  reader, including exports and MCP, needs the same stitching.
- **C. Runtime custom fields shipped by the app (Frappe).** *For:* reuses the path admins use by hand.
  *Against:* app fields and admin fields mix, and two apps' records can overwrite each other; Frappe's
  community reports exactly that drift.

**Chosen: A.** By Siraj, on my recommendation. **Firmness: leaning.** Proposed with it: on uninstall
the field is hidden and its data kept, so a reinstall brings it back.

**This was judged the riskiest in-instance decision by the feasibility read** (large): no field has an
owner in the old metadata; whole-Table grants would expose a new field automatically; the owning app
dropping its Table would destroy it. **Open questions:** who may read and write such a field (my
leaning: the contributing app's grants, not the Table's), and whether an owner may drop a Table that
holds another app's required field (my leaning: no). And see point 1 under "Still to reconcile" in section 2: this
decision was taken before I had read the redesign's rule that Table shape is a warehouse contract.

### Decision 11 — Can an app offer its own slots?

Example: Dash's home page has a row of tiles; Equipment wants to add one.

**Options.**
- **A. One mechanism for everyone.** An app declares named slots on its own pages; other apps fill them
  exactly as they fill a platform slot. The platform's slots are just slots the platform publishes.
  *For:* one thing to learn; one catalogue of every slot in the instance; visible at install; covered
  by the instance check. *Against:* the owner must mount the slot through a platform component so that
  hiding, ordering and failures behave the same everywhere.
- **B. Exported functions (VS Code's `exports`).** *For:* any shape. *Against:* nothing is declared, so
  the install screen and the instance check can't see it; each author versions by hand.
- **C. No app slots.** *For:* nothing more to build. *Against:* an app's own pages stay closed to other
  apps, which is the wall again at the UI level.

**Chosen: A.** By Siraj, on my recommendation. **Firmness: leaning.** Model: Backstage, where a plugin
publishes typed extension points and changes one by adding a new versioned point and deprecating the
old.

### Decision 12 — What happens when an app others depend on is removed or switched off?

**Options.**
- **A. Always blocked, with the list shown (Salesforce).** *For:* nothing breaks by surprise.
  *Against:* a minor dependency can block an admin.
- **B. Removes the dependents too, after confirming (Odoo).** *For:* one click. *Against:* a wrong
  click deletes a second app's data.
- **C. Always allowed; dependents carry on.** *For:* the admin is never stuck. *Against:* an app can be
  left half-working with no one told; Frappe's silent leftovers are this case.
- **D. The dependent says which kind it is.** Each use is marked *required* or *optional*. Required
  blocks, with the reason shown. Optional falls away cleanly. The same mark sets install order.

**Chosen: D.** By Siraj, on my recommendation. **Firmness: leaning.** Fact from the old code: apps
could only be switched off, never uninstalled, so "blocks uninstall" meant "blocks switching off".

### Decision 15 — Who decides where a contribution appears?

**Options.**
- **A. The app decides.** *For:* nothing to do after install. *Against:* two apps can't agree on order;
  a client can't hide a section.
- **B. An admin places everything (Shopify, Salesforce).** *For:* the page is exactly what the admin
  built. *Against:* every install needs placing work; a forgotten placement looks like a broken app.
- **C. Shown on install, an admin can rearrange.** Hide and reorder per page, saved as instance data
  that survives upgrades; a section arriving in an upgrade is shown at the end.

**Chosen: C.** By Siraj, on my recommendation. **Firmness: leaning.** Why not B: Shopify's stricter
rule exists because its apps come from strangers; with reviewed apps (decision 14) there is less reason
to make an admin opt in. Widened by decision 18: hiding applies to every contribution, not only
sections.

### Decision 18 — Apps versus plugins

Siraj asked how to tell an app from a plugin or extension, giving VS Code's examples (a shortcut, a
snippet, a theme, a rendering component) and his own (a chart viewer through Mermaid, a Markdown
viewer), and whether a person could take only part of a bundle.

**Options.**
- **One kind of package.** One manifest, one install route. "App" is a contribution, not a category: a
  package is an app when it contributes a front door (an entry in the app switcher, its own pages,
  usually Tables and roles). A package with no front door that only fills slots is an extension. A
  package can be both. *For:* nobody has to decide "app or plugin" before building; VS Code works this
  way.
- **Two kinds, apps and plugins,** with a separate lighter manifest for plugins. *For:* plugins could
  have looser rules. *Against:* a second format, and a line that things keep crossing.

**Chosen: one kind of package.** By Siraj, on my recommendation. **Firmness: firm.**

Included in what he chose: **each contribution can be switched off by an admin** (except one another
package marked required), and **a pack is a list of packages**, each still separately removable (VS
Code's extension packs). Not allowed: splitting a package's Tables from the code that guards them.

## 4. Decisions on sharing between instances

### Decision 5 — Where does "an app across its instances" live?

Example: one team runs Tasker in three clients' instances and wants all tasks in one list.

**Options.**
- **A. A hub instance.** An ordinary instance; each client instance connects to it as a data source
  through access the client grants and can revoke. *For:* reuses connected Tables, service accounts and
  roles; the client's wall stays whole and its own log shows what was read; works for any app and
  Table; the same app has the same Table definitions everywhere, so rows from several instances fit one
  list without mapping. *Against:* depends on each client being reachable; clients may run different
  versions of the app.
- **B. A control plane above instances** (like Microsoft Lighthouse). *For:* a natural home for both
  views plus operations. *Against:* a whole new system with its own sign-in, permissions and screens.
- **C. One shared instance for all clients,** rows walled by a client column (ServiceNow's domain
  separation). *For:* the combined list is trivial. *Against:* the hard wall becomes a row filter, and
  ServiceNow notes it can't be undone once on.

**Chosen: A, then widened by Siraj.** He first agreed to the hub, then said: Jeyarama's group may run
two or three Featherbase instances itself, and its vendors may run Featherbase and agree to share tasks;
"so every client would want a hub instance". **Result: there is no special hub. Any instance can read
any other instance that agrees, and one instance can be both a reader and a sharer.** **Firmness:
firm.**

**On precedent:** web research found nobody ships a general cross-tenant query (Atlassian has none even
inside one organisation). Siraj's response: "Just because others have not done doesn't mean we don't
want to do." Featherbase can do it more cheaply than they can because a Table whose rows live elsewhere
is already a normal thing, and the same app has the same metadata in every instance.

### Decision 6 — Live, or a copy?

**Options.**
- **A. Live only.** *For:* always current; the source's permissions decide every row; nothing stored
  in the reader. *Against:* slower lists; one unreachable instance leaves a hole; totals across clients
  are heavy.
- **B. Copy only.** *For:* fast; reports easy; works when a client is down. *Against:* client data
  lives outside the client's wall with the deletion duties that follow; a copy can go stale unnoticed;
  this is the pattern Frappe archived in December 2024 after version-skew failures.
- **C. Live, with a kept copy where chosen.** Live is the rule; a copy can be switched on per Table and
  shows its "as of" time; every write goes to the instance that holds the row.

**Chosen: C.** By Siraj, on my recommendation. **Firmness: leaning.** Sending writes only to the source
avoids two sides editing the same row, which is why Airtable's two-way sync restricts edits.

### Decision 7 — Whose identity is used?

**Options.**
- **A. One service account per connection.** *For:* one grant; simple. *Against:* the source's history
  names the account, not the person; the source can't treat two people differently.
- **B. Each person as themselves.** *For:* the source's roles and history name the person; removing
  them there cuts them off. *Against:* a sign-in per person per instance; a kept copy has no person
  behind it.
- **B plus a service account for kept copies only.** A copied row is shown only to people who could
  read it live.

**Chosen: the third.** By Siraj, on my recommendation. **Firmness: leaning.** Salesforce's cross-org
connection offers the same two modes; per-user is the one that keeps the source's permissions
meaningful.

### Decision 16 — How is the agreement recorded?

Example: a vendor lets Jeyarama's group office see only the tasks that belong to Jeyarama.

**Options.**
- **A. Ordinary people and roles** in the sharing instance. *For:* nothing new. *Against:* the
  agreement is scattered; nobody can see "what do we share with Jeyarama" or end it in one step.
- **B. A Connection record only**: which instance, Tables, rows, read or write, until when; everyone
  comes in with the same rights. *For:* one screen, one click to end. *Against:* history names the
  connection, not the person.
- **C. A Connection record as the ceiling, people inside it.** Decision 7 applies inside it, and nobody
  gets more than it allows.

**Chosen: C.** By Siraj, on my recommendation. **Firmness: leaning.** The vendor case is why sharing
needs *which rows*, not only which Table.

### Decision 17 — Can shared data be passed on?

**Options.**
- **A. Never.** An instance shares only rows it holds itself. *For:* every sharer knows exactly who
  sees its data; ending a connection leaves no copies down a chain. *Against:* more connections to set
  up.
- **B. Only if the first sharer allows it** (a switch, off by default). *For:* one connection can serve
  a group. *Against:* the sharer no longer knows who sees its rows; ending the first connection must
  cut every chain and copy behind it.
- **C. Always.** *Against:* the sharer's agreement means little.

**Chosen: A.** By Siraj, on my recommendation. **Firmness: leaning.**

**Feasibility of decisions 5–7, 16, 17 (old code): extra large,** the biggest piece. Fits: a driver
interface that maps one-to-one onto another instance's table routes; a sign-in server that already
issues person-owned tokens. Hard: tokens carried no limits and the server forgot which token made a
request, so a Connection ceiling would have to be enforced on every read and write path, including for
administrators; storing each person's token; one list across several instances; read-only kept copies;
and marking where a row came from so it can't be passed on. **Lesson for the new design: make the
server remember the token through a request from the start, and put every read and write through one
gate.** This is why section 2 carries that finding forward.

## 5. Decisions on code, trust and upgrades

### Decision 13 — Where does the code live?

This had been decided twice in opposite directions in the old system: one public repository for
everything (ADR 0014, 30-Oct), then a private repository per client (#1178, 10-Nov).

**Options.**
- **A. One public repo.** *For:* one checkout, one change for platform plus app. *Against:* client
  work is public; outside contributors need write access.
- **B. Platform public, one private repo per client** (the 11-Nov design). *For:* one team's apps for
  one client sit together; client work is private. *Against:* a platform-plus-app change is two changes
  and a pin bump; no answer for an outside contributor's app.
- **C. A repo per app.** *For:* cleanest for outside contributors. *Against:* worst for the main case:
  two of one client's apps changing together means two repos and two releases.
- **D. Any source, pinned by the instance.** B's layout for his own work, plus: the instance file lists
  every app with its version and where it comes from, so a contributor's app in its own repo installs
  the same way.

**Chosen: D.** By Siraj, on my recommendation. **Firmness: leaning.** Decision 4's instance check is
what makes D safe.

**Sub-choice (Claude, delegated, provisional):** an outside app arrives as a prebuilt archive pinned by
hash, not as source built in the instance's image. Reason: building someone's source runs their build
scripts on the build machine.

### Decision 14 — How far is an app's code trusted?

**Options.**
- **A. Review is the only guard.** *Against:* a reviewer has to catch everything on every version.
- **B. Review, plus declarations enforced through the helpers.** Every app version is reviewed before
  it enters an instance file; the platform guarantees that what an app does *through its helpers*
  matches its manifest; a lint check fails imports beyond the helpers. *For:* reviewing a version bump
  is small. *Against:* still one process; it guards against mistakes, not malice.
- **C. Isolated app code** (Shopify Functions). *For:* safe for unreviewed apps; opens a marketplace.
  *Against:* the largest piece of work; every helper call crosses a boundary, including checks inside
  a save.

**Chosen: B, built so a sandbox can be added later.** By Siraj. His words: "Can we build B in such a
way later on we can allow the sandbox thing when Featherbase, if it becomes famous, then we might have
more volume that we could not review." **Firmness: firm.** Three conditions keep that door open:

1. **Helpers only.** App code reaches the platform through its helpers and nothing else.
2. **Plain data in, plain data out.** A helper never hands the app a live database handle or
   transaction.
3. **Everything declared.** The manifest lists every Table, write, event, slot and outside site.

**Assumption:** every contributor's app is reviewed before it reaches a client. If that stops being
true, C is needed.

### Decision 19 — How do app upgrades work?

Siraj: "the app upgrades seem to me too complex. Does every commit made to an app need a version
upgrade, or are there other ways?"

**What the old code did (measured 18-Nov).** Code-only changes needed no version since 10-Nov. But any
change at all to the manifest forced a new version (the code compared the whole file, wider than his
own decision #1178 D3, "only when the data structure changes"); every version needed a migration entry
even if empty; and every Table change was written twice. Cost to Dash in 19 days: 46 versions; **41 of
45 migration steps empty**; 21 bumps changing nothing but their own number; about seven test files
edited per bump; 13 merges only to renumber a version two branches both claimed; a migration history
that could never be trimmed, already 46% of a 3,513-line manifest.

**Options.**
- **Keep versions and the checksummed step chain.** *For:* an exact record of what each instance has
  seen. *Against:* all of the above.
- **Declarative.** (1) The version becomes a label set at release; an installed package is identified
  by the fingerprint of its files. (2) Declarations that aren't data apply on deploy. (3) Table shape
  is compared and applied: adding a Table or column needs nothing written. (4) A named step exists only
  for what can't be guessed (a rename, a drop, a type change, a data fix); it runs once and is recorded
  by name, so two branches can each add one without colliding. (5) A deploy that adds a role or grant
  lists it before it applies.

**Chosen: declarative.** By Siraj: "Okay, I agree with this thought." **Firmness: firm.** Precedents
(from my knowledge, not re-read): Frappe syncs the Table definition and uses named patches; Django
names migrations and never ties them to an app version; Shopify makes each deploy a version
automatically.

### Decision 20 — How does production move to the new system?

**Chosen by Siraj, his own offer:** "In terms of production, we can even do an install in a new place
and then migrate the data, if that is needed one time to make a better design in the long run."
**Firmness: firm.** Consequence: the new system does not have to read the old installed-app records or
carry any migration history. Kept as conditions: a written, rehearsed data move (export, load, compare
counts and a sample per Table), and production untouched until he approves.

## 6. Decisions on the rebuild itself

### Decision 21 — Rewrite, and from where?

**First question: how far should the rewrite go?**
- **Rebuild in place,** one area at a time behind the existing tests (my recommendation). *For:* the
  app keeps booting; nothing is unusable in between. *Against:* 92,000 lines of server tests pin the
  old shape, and the five worst structural problems are exactly where the new design has to change.
- **From scratch, side by side.** *For:* cleanest result. *Against:* nothing is usable until much of
  it exists.
- **No rewrite.**

**Chosen: from scratch, side by side.** By Siraj, **against my recommendation**. **Firmness: firm.**
His reasons: "Current code is quite messed up. When I asked another review, it said the logic for the
table is in four different places... Right now the test seems to be almost twice the app code... I
want minimal test, minimal code, and more flexible code." Measurements the same night supported him
(section 7).

**Second question: what does "from scratch" start from?** On 19-Nov he was surprised to find I had
started from the October Elysia build of "Import from Excel or CSV" from his stack evaluation.
- **A. Keep that build.** *For:* it already does the core loop; 329 tests. *Against:* React screens;
  choices made before these decisions.
- **B. Truly blank.** *For:* every line follows the decisions. *Against:* the import is the slowest
  part to get right.
- **C. Blank, lift only the workbook-reading engine in** as one sealed feature (my recommendation).

**Chosen: B, truly blank.** By Siraj, **against my recommendation**. **Firmness: firm.** Consequence:
the October build is a source of *sentences and knowledge* (its 195-scenario spec), not of code.

### Decision 24 — The stack

Siraj raised both points and left them to me: "should we even go with React? Should we stick to HTML
with HTMX? Whenever I ask Claude to build something as an HTML artifact, it does such a wonderful job
in a very short time... study the Claude artifacts, what layouts and components it uses, and keep
those simple items here"; and "instead of Hono, use Elysia, because Elysia makes type safety and many
things that make agents' life easier."

**Backend. Chosen: Elysia on Bun.** Alternatives: stay on Node and Hono (what the 15-Nov rebuild prompt
assumed, with Elysia as a later checkpoint). Why Elysia: his own stack evaluation (Sep–Oct 2026, four
phases, builds verified independently) recommended it. He confirmed on 19-Nov: "this is right."

**Front end. Chosen: HTML rendered by the server, htmx for partial updates, React only where a screen
needs it.** Alternatives: keep the React Admin UI. Why: his observation about speed; and it removes the
hardest part of the extension design (decision 3), since a package's section becomes an HTML fragment.
A simple contribution then needs no build step and can be tested over plain HTTP. **Firmness: firm**
(the redesign branch chose the same independently); **unproven in code**.

Where client-side code stays: the editable grid (paste from Excel, keyboard movement) and anything
similar, decided and recorded each time, as the redesign branch says.

### Decision 25 — How the code is organised and policed

Siraj's instructions (firm): "I want to give you the freedom to organize the code base in any way you
feel is right. Group both web servers, design, UI prototype, all under a feature... primarily the code
is going to be written by agents"; "any constraints, any checks, I want you to use deterministic things
like hooks and lints and programmable things rather than writing markdowns and instructions in agents,
gotcha files and markdowns which cannot be enforced, which the agents over time completely forget"; "I
want you to use the deep module concept and not do too much commenting."

So: folders by feature, each holding its code, pages, mock-up and tests; one small entry point per
part and nothing reaching into another part's files; rules enforced by checks that run on commit and
in CI; a rule that can't be checked isn't written down as a rule. The redesign branch's map already
does this; use it.

### Decision 26 — Tests

I got this wrong and he corrected it. My plan dropped the 100% gate in favour of "each promise tested
once". His correction (19-Nov): "It was a misunderstanding. Yes, each promise should be tested once,
but in a way that helps us to reach 100% coverage. I don't see why it is mutually exclusive, because
without 100% coverage, how would I rely on agents writing code and not breaking things that are
previously built?"

**The rule: each promise tested once, from outside, and those tests reach 100% coverage.** Uncovered
code means either a missing promise (he approves a new sentence) or code to delete. This is exactly
`TESTING.md` on the redesign branch. **Firmness: firm.**

Background: in the old system server tests were 1.98 times the code and about 88% of test lines
imported internals, so they pinned how the code was built.

### Decision 27 — Scope: what is core, what is parked

From his purpose statement: peripheral features are parked and work goes in iterations from the core
outward. A first-pass ledger of all 91 old capabilities is in `background/old-capabilities-ledger.md` (an
agent's first pass; I have not reviewed it line by line).

**His corrections to that ledger (19-Nov), all firm:**
- **Glossary and keyboard shortcuts stay.** "These are the two key innovations that I really love. We
  just shipped it, I think, yesterday." The ledger parked them because no app used them; that was
  wrong.
- **Approvals are built on workflow states.** "I think we need to build approvals to use the workflow
  states, or whatever is the right thing."
- **Reports and charts stay.** "Initially I thought reports and charts would not be useful. Now I
  realize this is becoming an app that is a replacement for Claude Artifacts, which has reports and
  charts and many things, so we should be having them."

Still parked by his own statement: printing, public websites and portals.

### Decision 28 — How to work with Siraj on this

- **Plan each iteration together, then build.** (19-Nov: "let us plan each iteration together and then
  you can go to build.") This replaces the 18-Nov night arrangement, under which I was to decide design
  questions alone and continue.
- **Build locally; deploy only when a piece is finished and he asks.** He challenged an early Railway
  deploy: "Why don't you build locally first and then do the deployment only when you are finished?"
- **Never put a tool that can raise a permission prompt in the middle of unattended work.** The night
  of 18-Nov was lost to a Railway permission prompt waiting for him.
- **Small, easy-to-reverse technical choices are the agent's to take and record.** Design-shaping or
  hard-to-reverse ones go to him.
- **Format:** he often reads on a tablet. No wide tables; one short block per option. One question per
  message unless he asks for a batch. Options with pros and cons, one recommendation, then ask.
  Summarise background work as each piece returns.

### Decision 29 — Where do Tables that people bring in for themselves live?

Raised by Siraj on 19-Nov-2026, after the rest was settled. Importing is today a job for a system
manager. He wants "each user to create their own little island": "I am doing something in Excel. I just
want to put it in Featherbase, maybe in an area that does not really collide with others. It's not
private in the data access sense, but a work area, and then I play with it. Maybe if I find it useful,
then I share it with others. Eventually, it becomes a table that can be used. That way we can tell
everybody: bring all your Excels into Featherbase and do your own thing." His worry: "we should have some
clear separation between what is done by me or an administrator with a thoughtful design and what is the
kind of junk drawer that is created by the users. Otherwise both would collide." And: when space runs
short or there are too many things, clean-up should be able to focus on that area.

**Options.**
- **A. A work area for each person.** Anyone can bring a file in; the Table lands in that person's own
  area, in its own schema. It shows under "My work", never in the shared lists, and the person can share
  it with named people. It is never sent to the warehouse: the change-data-capture package skips those
  schemas. Each area shows its size and when it was last used. A good Table is *promoted*: someone who
  designs reviews its name, key and types, then moves it to `masters` or an app. *For:* names can't collide
  (two people's "Budget" are different Tables); the designed side stays clean; clean-up has one obvious
  place to look; when a person leaves, their area is one thing to review. *Against:* many small schemas;
  a shared draft still has a single owner.
- **B. One shared drafts area for everyone.** *For:* simplest; people can discover each other's drafts.
  *Against:* names collide between people; with no clear owner per area it becomes the junk drawer he
  fears.
- **C. No separate area, a "draft" mark on Tables in `masters`.** *For:* nothing moves on promotion.
  *Against:* drafts and designed Tables share one list and one set of names, which is the collision he
  wants to avoid; and the warehouse would need a filter per Table.

**Chosen: A.** By Siraj, on my recommendation. **Firmness: firm on the principle** (a separate place per
person, kept apart from designed Tables and from the warehouse); the details below are open.

**Why A, beyond his stated worry.** `BIG-PICTURE.md` says the physical shape of every Table is read by
the change-data-capture package. A separate schema lets that package ignore drafts wholesale; a draft
mark would have to be respected Table by Table. And promotion needs nothing new: it is the "moving a
Table between `masters` and an app is one deliberate step" that `BIG-PICTURE.md` already describes, with a
name history, plus a review in front of it.

**How it fits the rest.** A Table can now live in three kinds of place: a person's work area, the shared
`masters` (decision 37), or an app. `BIG-PICTURE.md` already says "later a person picks the schema"; this decides what the
default is for a file someone brings in for themselves.

**Open** (also listed in section 9): who may promote; whether others can see that a work area's Tables
exist before they are shared ("not private in the data access sense" suggests they may); what sharing
grants; and the naming of the area and its schema.

## 7. Evidence gathered

**Old code, measured 18-Nov** (branch `main` at the time): server 46,628 lines of source and 92,264 of
tests (1.98×); web 40,414 and 65,499 (1.68×). A Table's shape changed through six code paths plus
hand-written SQL; five filter compilers with four different operator lists; two read/write engines;
row permissions checked in five layers; `index.ts` 2,211 lines with 109 inline routes. Only about 12%
of server test lines avoided internals. 82% of all commits were in the last six weeks. 91 capabilities
and 1,003 requirements in `openspec/specs`.

**Web research, 18-Nov** (three searches; several details unverified, noted below):
- *Extension models* (Shopify, VS Code, Salesforce, NocoBase, Frappe, Odoo, Backstage). The ones that
  last: declare in a manifest and implement in code; the host draws and the app supplies content; add
  and namespace, never replace; version the extension surface on its own; two tiers of events; a
  person decides placement; access declared and approved at install. Replace-style hooks are the ones
  later walked back (Frappe's class override, Odoo's view patches, Shopify's script injection, which
  stops on 1-Mar-2027).
- *Sharing inside one tenant.* Row access follows the person whichever app asks; only the owner
  changes a table's shape; a dependency is declared and fixes install order; uninstalling a
  depended-on app is blocked (Salesforce) or cascades visibly (Odoo); silent leftovers (Frappe) are the
  failure case.
- *One app across tenants.* Nobody ships a general cross-tenant query. What survives is a narrow agreed
  share (ServiceNow Service Bridge) or delegated access per tenant (Microsoft Lighthouse).
- **Not verified from a source:** most Salesforce details (its developer pages blocked direct reading;
  they rest on search excerpts); Shopify's stated reasons for ending script injection; several NocoBase
  and NocoDB behaviours.

## 8. What was discarded

The second session first started code from the October Elysia build of "Import from Excel or CSV". The
owner then chose a truly blank start (decision 21), which is this branch. That attempt (branch `rebuild`,
a Railway test service, issue siraj-samsudeen/featherbase#1308) was deleted or closed on 19-Nov-2026, as
were three unrelated to-do list trial branches from 21-Oct (`featherbase-rewrite`, `-old`, `-trial`).

A first-pass ledger of the old system's 91 capabilities, marked core, rethink, carry later or park, is in
`background/old-capabilities-ledger.md`. It is an agent's first pass; correct it by decision 27.

## 9. Decisions still waiting on Siraj

Grouped by when each is needed. Bring them to him one at a time.

**Needed early. They block no build, but they shape all the work.**

1. **The old system while the rebuild grows.** *Answered, decision 33:* no formal limit; client
   requests and bug fixes continue and the owner keeps it small himself.
2. **What "ready to move Dash" means.** *Answered, decision 34:* a short list of the big pieces now,
   the full list when the move is planned. The short list is owed by Claude.
3. **The words.** `AGENTS.md` has a table of agreed words, and a folder is named exactly as its word.
   This half added *package*, *contribution*, *slot*, *Connection* and *work area*. None is approved.
   The review added *Masters*, *gate* and *sentence* (a rule the gate reads); *Masters* is the
   owner's own choice (decision 37).
4. **Does each build still start from a GitHub issue?** `TESTING.md` drops OpenSpec on this branch; the
   old repository's rules required an issue and an OpenSpec change.

**Personal work areas (decision 29).**

5. Who may promote a Table out of a work area?
6. Can other people see that a work area's Tables exist before they are shared? ("Not private in the
   data access sense" suggests yes.)
7. What does sharing a work-area Table grant: read only, or edit too?
8. What are the area and its schema called? (The shared area is now Masters, decision 37; the
   person's own area is still unnamed.)

**When packages are planned.**

9. May a "check before save" on another package's Table change the row, or only refuse? (decision 9;
   Claude's leaning: refuse only)
10. Whose permissions does a call to another package's action run under? (decision 8; leaning: the
    calling person, re-checked against the owner's rules)
11. Who reviews an outside contributor's package before it reaches a client, and what do they check?
    (decision 14 depends on this)
12. How does the platform learn early that a change breaks a private package?

**When fields on other Tables are planned (decision 10).**

13. Who may read and write a package's field on another Table: the Table's grants or the contributing
    package's? (leaning: the package's)
14. May an owner drop a Table that holds another package's required field? (leaning: no)
15. Should such a field reach the warehouse, and under what name? (section 2, "Still to reconcile",
    point 1)

**Reports and charts.**

16. Siraj put them back in scope on 19-Nov. Where do they live: a kind of page, a contribution a
    package makes, or both? A separate design-study session is producing a charts mock-up in
    `features/foundations/pages/`.

**When people and sharing between instances are planned.** Decisions 42 to 47 have started on people
and access.

17. Which sign-in methods? The old production uses Google and Microsoft sign-in. Design this together
    with signing in to another instance (decision 7).
18. Store each person's token for another instance in an encrypted store? (The old system removed its
    encrypted store.)
19. Show another instance's Table inside the local app, or as a separate Table?

**Left over from the old plan.**

20. The planned move of one client's apps to a private repository (11-Nov). With a fresh install
    planned for production, is it still needed in that form?

**From the first-principles review (section 11).**

21. **The workbook for the links build.** An Excel file with several sheets that point at each other
    (decision 31). Not on this branch; the owner is to supply it.
22. **Does Featherbase also make a visible running code for a row,** beside its own id? (decision 38)
23. **What happens to the anchor and to "a source part and a Featherbase part"** now that every
    worked-on outside Table is a copy in Featherbase's Postgres (decision 41)? `BIG-PICTURE.md` still
    describes both as first written.
24. **Reading between instances: live or a copy?** Decision 6 says live by default; decision 41 says
    always a copy for outside sources. Not yet re-examined together.
25. **"Where" (decision 46):** the remaining cases, among them a role held along two lines at once,
    a role given by hand, and a corrected role.
26. **A link that changes over time,** as a built-in kind of Column: it shows today's value as a plain
    Column, keeps the dated history, and can answer "as of" a date. An idea noted from real data,
    where several "which belongs to which" Tables turned out to be history. Not discussed.
27. **The old vision against this design** (section 11, opening): Table definitions as portable JSON
    against "readable code over large JSON" (section 10, item 3); where Flows sit against checks and
    reactions (decision 9); and when each enters the build order.
28. **Review areas not reached yet:** apps and packages, sharing between instances, how we build
    (including the first build's handover), and the build order.

**Sentences on this branch that still follow the earlier answers.** They drive tests, so each is
changed when its build is planned with the owner, not here:

- `main` as the shared schema and in addresses: `features/foundations/database/database.md`,
  `features/foundations/pages/pages.md` and the mock-up (decision 37).
- A key picked at import, and rows listed in key order: `proposing.md`, `confirming.md`,
  `changing.md`, `browsing.md`, journey 2, `samples/employees/README.md`, and the word "Key" in
  `AGENTS.md` (decision 38).
- "Who created or changed a row is added when people sign in" in `database.md` (decision 42 allows
  it from the start).

## 10. A suggested order, for the owner and the planning session to challenge

The first builds, as decided in section 11:

- The home page on a fresh install, with the one gate already in place (decision 42).
- Importing a clean CSV into Masters (decisions 31, 36, 37).
- Links between Tables, from a clean workbook; a link with no match refuses the import (decision 32).
- Import and clean-up; the refusal softens into an Issue (decision 32).

Where the journey "Claude Code does the same" sits among these was not re-asked. After those, a
suggestion for where this half enters. The review has not reached this list yet:

1. Editing in a list people can work in (filter, sort, search).
2. People, sign-in and access, whenever the owner schedules them, on the gate that already exists
   (decisions 42 to 47).
3. Packages: a readable definition file (the owner prefers readable code to large JSON), installed by
   comparison, with declared uses and the instance check.
4. Extension points: sections first (HTML fragments), then events, then fields, then package slots.
5. Instance to instance, starting with the Connection ceiling.
6. Dash and the data move.

## 11. The first-principles review (19 and 20 November 2026)

A third session. Siraj asked for everything to be rethought from first principles across both halves
of the design, one question at a time. Each decision below names the earlier decision it re-examines.
The question numbers are the ones used in that session.

The review is not finished. It has covered purpose, the old system, the Table, and most of people and
access. Apps and packages, sharing between instances, how we build, and the build order are still to
come.

**Two rules that changed for the review:**

- Neither half of the design wins by default any more. Each conflict is brought to Siraj (section 2).
- The old vision document is a fifth input, beside the two halves, the shared roles brief and the
  first build's handover. Siraj on 20-Nov: keep most of its ideas in mind. Flows (action, loop,
  condition) as the one idea for automation. Table definitions as portable JSON. An AI chat that
  builds Tables and apps, with a person doing the same by hand as an equal way in. Developers and
  non-technical users are equal citizens. Where these meet earlier decisions is open (section 9).

### Purpose and the first real use

#### Decision 30 (Question 1) — What is the first real use the rebuild must serve?

**Re-examines:** "start from Excel" in `BIG-PICTURE.md` and the suggested order in section 10. The
inputs pulled three ways: a master-data tool, a platform for many apps, and a client's live app.

**Options.**
- **A. The owner's own warehouse clean-up.** A sheet he maintains today is imported, cleaned, edited
  and reaches the warehouse. *For:* he is the first user, so feedback is fast; it exercises the core;
  it needs no roles or packages to be useful. *Against:* the client's app stays on the old system
  longer.
- **B. Replacing the client's app in production.** *For:* ends the cost of two systems soonest.
  *Against:* it needs nearly everything at once, and the import core gets built last.
- **C. The app platform.** *For:* outside contributors can start early. *Against:* it builds the frame
  before there is a proven Table, list or form to extend.

**Chosen: A.** By Siraj, on my recommendation. **Firmness: leaning.**

#### Decision 31 (Question 2) — Which data is the first target?

**Options offered:** the employee master; a sheet that exists only in Excel today; budgets.

**Chosen: none of them yet. Made-up data first.** By Siraj, his own answer: "we cooked up some ideal
simple csv to start with then an excel with multiple sheets to demonstrate links." So the clean CSV in
`samples/employees/` comes first, then a workbook with several sheets that shows links between Tables.
A real sheet follows those. **Firmness: firm.**

**Owed:** the workbook is not on this branch. Siraj is to supply it (section 9).

#### Decision 32 (Question 3) — After the clean CSV, which build comes next?

**Re-examines:** the order in `BIG-PICTURE.md`, which put clean-up second and left links for later.

**Options.**
- **A. Links second, clean-up third.** *For:* links are what make it a database and not a spreadsheet.
  *Against:* a link to a missing row is itself a clean-up problem, so links are hard to get right
  before bad cells are handled.
- **B. Clean-up second, links third.** *For:* Issues are designed once, and a broken link becomes one
  more kind of Issue. *Against:* two builds on one flat Table before anything relational shows.
- **C. Links second, with clean files only.** A link that finds no match refuses the import. Clean-up
  comes third and softens that refusal into an Issue. *For:* links are seen early without designing
  Issues twice. *Against:* the workbook must be perfectly clean until the third build.

**Chosen: C.** By Siraj, on my recommendation. **Firmness: leaning.**

### The old system while the rebuild grows

#### Decision 33 (Question 4) — What may still be added to the old system?

**Re-examines:** section 9, item 1.

**Options.**
- **A. Bug fixes only.** *For:* the gap stops growing at once. *Against:* the client waits for the
  rebuild for anything new.
- **B. Only what the client needs in production, each addition logged.** *For:* the client is never
  blocked, the platform stops growing, and the log becomes the finish line. *Against:* someone has to
  say no to platform ideas.
- **C. No limit.** *For:* nothing changes for anyone. *Against:* the rebuild chases a moving target.

**Chosen: C.** By Siraj, **against my recommendation of B**. His words: "we have to respond to the
client requests and bug fixes. but i will keep it minimal." **Firmness: firm.** There is no log of
additions; he keeps the old system small himself.

#### Decision 34 (Question 5) — When is "what the client's app needs before it can move" written down?

**Re-examines:** section 9, item 2.

**Options.**
- **A. The full list now.** *For:* shows early how far away the move is. *Against:* goes stale with
  every change to the app.
- **B. The full list when the move is planned.** *For:* written once and correct. *Against:* a large
  surprise could come late.
- **C. A short list of the big pieces now, the full list later.** One line per area the app depends
  on. *For:* catches large surprises for almost no effort, and names areas, so it does not go stale.
  *Against:* it is not a finish line that can be ticked off.

**Chosen: C.** By Siraj, on my recommendation. He added: "the core parts of dash is done, so you can
take it from there for now." **Firmness: leaning.**

**Owed:** Claude drafts those lines from the app's manifest and brings them with the build order.

### What a Table is and where it lives

#### Decision 35 (Question 6) — What is a Table, physically?

**Re-examines:** the storage decision in `BIG-PICTURE.md`, which everything else rests on.

**Options.**
- **A. One real Postgres table per Table, one real column per Column.** *For:* the
  change-data-capture package reads an ordinary table; real types and unique rules; plain SQL; fast
  sorting and filtering. *Against:* adding a Column or importing a file changes the database's
  structure while people use it, and every rename is a change to the warehouse contract.
- **B. One shared table for all rows, values held as JSON.** *For:* no structure changes ever.
  *Against:* the warehouse receives one opaque table; no real types or unique rules; slow filters.
- **C. Real tables for designed Tables, JSON for drafts.** *For:* drafts never touch the structure.
  *Against:* two engines, the old system's worst problem.

**Chosen: A.** By Siraj, on my recommendation. **Firmness: firm.** It confirms what was already
written.

#### Decision 36 (Question 7) — Where does an imported file land before people sign in?

**Re-examines:** a conflict between the halves. `BIG-PICTURE.md` sends an import to the shared
schema. Decision 29 sends a file someone brings in for themselves to their own work area. The early
builds have no sign-in, so there is no person yet to own an area.

**Options.**
- **A. The shared area until people sign in; work areas arrive with sign-in.** *For:* nothing is
  built for a person who does not exist yet, and moving a Table between schemas is one cheap step.
  *Against:* for a while experiments sit beside designed Tables, and the change-data-capture package
  would see them.
- **B. A work area from the first build,** with a promote step to reach the shared area. *For:* the
  separation holds from day one. *Against:* one more step and screen in the very first demo.
- **C. The person chooses at import.** *For:* flexible. *Against:* it asks a design question of
  someone who only wants to drop a file.

**Chosen: A.** By Siraj, on my recommendation. **Firmness: leaning.** Recommended with it: the
change-data-capture package is not pointed at the shared area until work areas exist or Siraj says
so. Decision 29 stands for the time after sign-in.

#### Decision 37 (Question 8) — What are the places a Table can live called?

**Re-examines:** `database.md`, which put people's Tables in schema `main` and Featherbase's own
tables in schema `featherbase`. Siraj's concern: "Featherbase" meant both the whole system and one
area inside it, and "sometimes even I get confused" which one a person means. He also wants upkeep
tables kept out of sight: "When I want users to browse their tables, I don't want them to see system
tables."

**Options.**
- **A. Main and featherbase.** A shared Table is `main.site`; upkeep is `featherbase.uploads`.
  *For:* already written; "Featherbase" only means the whole system. *Against:* "Main" says nothing
  about what belongs there.
- **B. Masters and featherbase.** A shared Table is `masters.site`; upkeep is `featherbase.uploads`.
  *For:* it names the ideal use, so people know what belongs there. *Against:* not everything shared
  is a master.
- **C. Featherbase and system.** A shared Table is `featherbase.site`; upkeep is `system.uploads`.
  *For:* no change to what people say today. *Against:* it keeps the double meaning.

**Chosen: B.** By Siraj, **against my recommendation of A**. **Firmness: firm.** His reason: "My
ideal usage for Featherbase is a master data management system... masters fits the scene." On the
"against": something shared that is not a master, such as a budget, belongs to an app, and that is
fine because every app's Tables are usable inside the instance wall (decision 1).

**So there are four kinds of place:**
- **Masters,** schema `masters`. The shared, designed Tables. The default for an import until
  sign-in exists.
- **An app's own schema,** named after the app.
- **A person's work area** (decision 29), from the day people sign in.
- **`featherbase`,** Featherbase's own upkeep tables (uploads, raw rows, the list of Tables and
  Columns). Never shown when browsing Tables, to anyone.

"Featherbase" now means only the whole system. One consequence carried forward: making a small app
must be cheap, because an app is the home for anything shared that is not a master.

`masters` replaces `main` everywhere, including the address a person sees (`/masters/employees`) and
the mock-up.

#### Decision 38 (Question 9) — Must every Table have a key?

**Re-examines:** the rule that a key is always picked on the proposal screen, and that only a Column
that is never blank and never repeats can be picked.

**Options offered.** A, always required. B, optional, with a Table that has none losing re-import
and links. C, required, and Featherbase makes a running code when the file has none.

**Chosen: Siraj's own framing, none of the three as written.** "Let's not make the normal thing that
I expect people to do, which is to upload any Excel hard." **Firmness: firm.**

- Any Excel imports. A missing key never blocks an import.
- Every row gets an id made by Featherbase (`_id`). That is what tells rows apart.
- **What makes a record unique is a separate question from the id.** It can be one Column or several.
  It can be set at import, later, or when a re-import asks how to match and remove duplicates.

**Left open:** whether Featherbase also makes a visible running code (section 9).

#### Decision 39 (Question 10) — How does one Table point at another?

New, because links now come second (decision 32). Example: an Employees sheet has a Department column
holding "Sales", and a Departments sheet has a row for Sales.

**Options.**
- **A. Store the other row's id.** The screen shows "Sales". *For:* a rename needs no change anywhere
  else; works when uniqueness is several Columns; the warehouse joins on the id. *Against:* the raw
  column, here and in the warehouse, is an unreadable id.
- **B. Store the word.** *For:* readable everywhere with no join. *Against:* a rename must rewrite
  every pointing row in every Table and app; cannot work when uniqueness is several Columns.
- **C. Store both.** The id decides; a second column keeps a readable copy. *For:* stable and
  readable. *Against:* two columns per link in every Table and in the warehouse, and the copy can go
  stale.

**Chosen: C.** By Siraj, **against my recommendation of A**. **Firmness: firm.** What follows from
it: Featherbase refreshes the readable copy in the same save whenever the other row is renamed, so it
cannot go stale through normal use.

**Stated with it and not contested:** the import matches the sheet's "Sales" to the Departments row
by that Table's uniqueness rule, so a Table that others point at needs one.

#### Decision 40 (Question 11) — What happens when someone deletes a row that others point at?

**Re-examines:** nothing. The 16-Nov choice stands: delete really removes the row in the first build,
and soft delete comes later as a switch. This is the case that choice did not cover.

**Options.**
- **A. Refuse, and say who points at it.** "Sales can't be deleted: 3 Employees use it." *For:*
  nothing is left pointing at nothing, here or in the warehouse. *Against:* clearing a well-used row
  takes several steps.
- **B. Delete it and empty the links.** *For:* one step. *Against:* silent data loss in other Tables,
  possibly another app's.
- **C. Delete it and everything pointing at it.** *Against:* one click removes rows across several
  Tables.
- **D. Retire it, don't remove it.** The row stays, is hidden from pick lists, and still shows where
  it is used. *For:* what a master usually needs. *Against:* it is the soft delete that was put off.

**Chosen: A now; D arrives when soft delete is switched on.** By Siraj, on my recommendation.
**Firmness: leaning.**

#### Decision 41 (Question 12) — How does Featherbase read data it does not own?

**Re-examines:** point 3 of `BIG-PICTURE.md`, "three ways to read a source part" (live, cached copy,
brought over). The concern: the old system's worst problem was two engines, one for its own Tables
and a weaker one for outside Tables. Live reading brings the second engine back.

**Options.**
- **A. All three ways.** *For:* nothing is copied that need not be; always current. *Against:* two
  read engines from the day live reading is built.
- **B. Always a copy in Featherbase's Postgres.** Everything a person works on is in Postgres.
  Warehouse tables too large to copy are only browsed. *For:* one engine; lists, filters, links and
  people's additions work the same everywhere; a file import and a warehouse copy are one mechanism
  with different sources. *Against:* a copy can be stale, so each shows its "as of" time.
- **C. Decide when the warehouse work is planned.** *Against:* early builds could close a path
  without anyone noticing.

**Chosen: B.** By Siraj, on my recommendation. **Firmness: leaning.**

- **A copied Table can be refreshed,** on demand or on a schedule. Siraj added this himself. A
  refresh works like a re-import: the source's Columns are updated and what people added is kept.
- **The warehouse is a read-only browser.** Pick a database, schema and table, page through rows,
  sort and filter simply. No edits, comments, links, own Columns or corrections there. To add any of
  those, the table is copied in and becomes an ordinary Table.
- **Live reading** is added later only if a real case cannot be served by a copy.

This is about outside *sources*. Claude's note, not a decision: decision 6 says reading between two
Featherbase instances is live by default, which points the other way. It has not been re-examined
yet (section 9).

### People, roles and access

#### Decision 42 (Question 13) — When does Featherbase start knowing who is acting?

**Re-examines:** "people, sign-in and access rules come later" (section 2). The timing of sign-in is
not questioned. The lesson is from the old system, where access was checked in five layers because
it was added around code that already existed.

**Options.**
- **A. As written.** No notion of a person until sign-in is built. *Against:* every route, page and
  agent tool written before then is reopened to pass through the gate.
- **B. Real sign-in from the first build.** *Against:* delays the first Table anyone can see.
- **C. The gate from the first build, sign-in later.** Every read and write passes one place that
  asks who this is and whether they may. Until sign-in exists the answer is always "the owner, yes".
  No sign-in screen and no roles. *For:* almost no work now, and only the gate changes when sign-in
  arrives. *Against:* a little structure before it visibly pays off.

**Chosen: C.** By Siraj, on my recommendation. **Firmness: leaning.** With it: who created and who
changed a row can be recorded from the start.

#### Decision 43 (Question 14) — What does the gate understand?

**Re-examines:** the old system's access design, where at least nine separate mechanisms decided
access.

**Options.**
- **A. One sentence form.** *A role* can *do something* to *a Table*, optionally *only for certain
  rows*. Example: "Store Managers can edit Sections in their area." The gate knows nothing about any
  business. A roles package answers two questions for it: which roles does this person hold, and
  where. *For:* one mechanism to build, test and explain; "why can this person see this?" always has
  a one-sentence answer. *Against:* a few old behaviours do not fit, such as sharing one row with
  one person.
- **B. Carry the old mechanisms over, behind the one gate.** *Against:* nine mechanisms again, two
  of which contradict each other.
- **C. Each app decides in its own code.** *Against:* no single answer to "who can see this row",
  which sharing between instances needs.

**Chosen: A.** By Siraj, on my recommendation. **Firmness: leaning.** A second form is added only if
a real case appears.

#### Decision 44 (Question 15) — What can an administrator see?

**Re-examines:** two old rules that contradicted each other. One said an administrator can do
anything on any Table. The other said private work stays private with no administrator exception.

**Options.**
- **A. Everything, always.** *For:* simplest. *Against:* nothing can be private from an
  administrator, including a client's own.
- **B. Everything by default, except Tables an app marks private.** The administrator role starts
  with the sentence "can do everything to every Table". On a private Table only that Table's own
  sentences apply, to administrators too. An administrator can still change the rules and so let
  themself in, and every rule change is recorded with who and when. *For:* daily work is as easy as
  A, and getting in leaves a visible trace. *Against:* it deters and records; it does not prevent.
- **C. Nothing by default.** Administrators manage structure and rules, and must give themselves a
  role to see rows. *Against:* constant friction for the person configuring an instance.

**Chosen: B.** By Siraj, on my recommendation. **Firmness: leaning.**

#### Decision 45 (Question 16) — Where do the "what a role may do" sentences live?

**Re-examines:** the old arrangement, where each app keeps its own table of what each role may do in
it.

**Options.**
- **A. One rule list in the platform; each package ships its starting sentences.** Installing a
  package adds its sentences to the one list, after showing them. An administrator edits them in one
  grid covering every app. *For:* one place answers "what can this role do, everywhere?", and the
  gate reads one list. *Against:* an upgrade must not overwrite a sentence someone changed by hand,
  so each sentence remembers whether it was edited.
- **B. Each app keeps its own table of sentences.** *For:* matches the old system. *Against:* the
  gate reads one table per app, and nobody sees a role's whole picture on one screen.

**Chosen: A.** By Siraj, on my recommendation. **Firmness: leaning.** It applies to the rebuild
only; the old system is unchanged.

**The split that follows.** The platform holds the gate and its rule list. It holds no business
roles. Roles, the mapping from job titles to roles, changes made by hand, the working-out of who
holds what and where, and the screens for all of these belong to a shared roles package. That
package is generic in shape, and a business's own role names are rows in it. Its design is kept with
the package, not in this repository. Put to Siraj with this question and not objected to.

#### Decision 46 (Question 17) — How is "where" expressed? In progress.

"A Store Manager **at one store**" and "can edit Sections **in their area**" both need a notion of
where. Siraj: "this is one of the most important things to get right and be flexible, yet somehow
keep it simple... Let's go extremely slow." It is being worked through real cases one at a time, and
is not settled as a whole.

**Options first offered.**
- **A. Fixed levels built into the roles package** (for example region, cluster, store). *Against:*
  the next business has different levels, and a role that reaches by merchandise has no answer.
- **B. A tree of places with parent links.** *Against:* the shape of places belongs to the source
  systems, so Featherbase would keep a second copy of the hierarchy.
- **C. A role is held at a row of any Table, and access follows links** from a row to that place.
  *For:* no new hierarchy; it uses the links the data already has; place and merchandise work the
  same way.

**Not chosen yet.** C is the idea under test: a role is held at a place, a place is a row, and a row
is in your area when it hangs off that place by links.

**Confirmed so far** (Siraj, 20-Nov: "yes exactly"). **Firmness: firm on the direction.**

- Row-level access is the larger question, not which Tables a role may open.
- The gate adds a filter to each Table before any list or save.
- "My things" (me, the places I hold roles at) are worked out once per request.
- Each reach is a plain filter or join:
  - **Own:** a Column on the row equals me.
  - **Team:** a join through who reports to whom.
  - **Area:** a Column on the row, or a join up from it, reaches one of my places.
  - **Handed:** a join to a list of grants.
  - **All:** no filter.

**Still to walk through:** the remaining cases, including a role held along two lines at once (a kind
of merchandise and a region together), a role given by hand, and a role that was corrected.

#### Decision 47 (Question 17a) — Who states how a row leads to a place?

**Options.**
- **A. Each sentence states the path.**
- **B. Once per Table.** The Table carries "belongs to" facts: a Section belongs to a Site by its
  site Column, to a Floor by its floor Column, and to a Department through another Table. A sentence
  only says "in their area". The gate picks the path that matches the kind of place the role is held
  at.
- **C. In code.**

**Chosen: B.** By Siraj, on my recommendation. **Firmness: leaning.**
