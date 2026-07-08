# Glide Product Research

> **Provenance:** research agent report, 2026-07-08, from Glide's official docs, changelog, launch blogs, community forum, and third-party reviews. Preserved verbatim. Addendum at the end covers GlideOS (verified separately the same day).

---

# Glide Product Research Report — for a Frappe-based Workflow Product

_Research date: July 2026. Sources: Glide's official docs (glideapps.com/docs), changelog, launch blogs, community forum, and third-party reviews._

---

## 1. Glide Workflows (automation engine, launched 2024, canvas editor GA 2025)

### Triggers (6 types)

| Trigger              | Mechanics                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App Interaction**  | Fired by a user act in the app (button press, checkbox, form submit). Bound to a source table — the triggering row is the workflow's row context. Cannot be converted to another trigger type later. |
| **Schedule**         | Backend cron: hourly / daily / weekly / monthly; **5-minute minimum interval**. Scheduled workflows must start with a Loop step (iterate rows of a table).                                           |
| **Webhook**          | Inbound POST to a generated URL; payload fields become workflow variables.                                                                                                                           |
| **Email**            | Glide generates an inbound email address; received message (subject/body/attachments) is parsed and passed downstream — docs show piping it straight into an AI categorization step.                 |
| **Manual**           | Started only via a "Trigger Workflow" step/action from another workflow or UI action — Glide's subroutine mechanism.                                                                                 |
| **Slack** (May 2025) | Fires when a Slack message is posted.                                                                                                                                                                |

### Steps — three primitives, not thirty

Workflow logic is composed from exactly three node kinds (up to **2,000 steps** per workflow):

1. **Actions** — native data ops (Add Row, Set Column Values, Delete Row), integrations (Slack, Gmail, Twilio, Stripe, DocuSign, HubSpot, OpenAI, ~40 total), AI steps, and **Call API** (any HTTP method; query string/headers/body configurable; a "JSON Object" column type builds request bodies from row data; response is mapped back into columns).
2. **Loops** — iterate a table or relation row-by-row, sequentially.
3. **Conditions** — if/else branching, stackable and nestable inside loops.

Plus two composition steps (May 2025): **Trigger Workflow** (chain/reuse workflows) and **Human-in-the-Loop** (pause the run; the approver gets a shareable link or Slack message with preset choice buttons; run resumes with their answer).

### Editor, run history, error handling

- Three-pane editor: searchable workflow list (left, with per-trigger-type icons), **interactive node canvas** (center), configuration + monitoring (right). It literally replaced the old Actions editor — same place, upgraded.
- **Run history**: "History" tab, 90 days of logs; failed runs flagged red; click a run → per-step detail, inspectable input/output payloads (`{}` viewer), and the update-credit count the run consumed.
- Known weaknesses (community): no retry policy on failed steps, no try/catch (a failed API step doesn't cleanly halt downstream steps), no workflow versioning/rollback, plan-gated triggers, 5-min schedule floor.

**Why it works:** radical vocabulary reduction. Trigger → {Action, Loop, Condition} is the whole mental model; power comes from composition (nesting, chaining via Trigger Workflow), not from a 200-node palette. And automation lives _inside_ the app builder with the same table/column pickers, so there's no context or auth switch à la Zapier.

---

## 2. Actions vs Workflows split

- **Actions** = single-step behaviors attached to UI: component tap, collection item click, form "after submit", screen level. Categories: Data (Add Row, Set Column Values, Upload Image, Copy to Clipboard), Navigation (Go to Tab, Go Back, Show Detail/Edit Screen, Show Notification, Open Link/Map), Communication (compose email/SMS/call), Advanced (Call API, Trigger Workflow).
- **Workflows** = anything multi-step. Glide's migration was a _rename_: the Action Editor became the Workflow Editor, "Custom Actions" became Workflows, and existing actions appeared in the new editor's sidebar automatically. A UI action is now just the App Interaction trigger of a workflow.
- Key scoping rule: an action/workflow is authored **against a source table**; it's reusable on any screen bound to that same table, and the current row flows in as context.

**Why it works:** one continuum instead of two products. A builder starts with "what happens when this button is tapped," and the same artifact scales into a scheduled, branching automation without rebuilding. Row-context scoping means no manual "pass the record ID" plumbing.

---

## 3. Data layer

### Sources

- **Glide Tables** — native, ~25k row ceiling, instant sync.
- **Big Tables** — native, up to **10M rows**; server-side querying; data edits don't consume update credits.
- External: Google Sheets (sync "in minutes"), Excel, Airtable, MySQL/PostgreSQL/SQL Server/Cloud SQL, BigQuery (higher plans). Each sheet/tab becomes a Glide table.

### Computed columns (the crown jewel)

Spreadsheet-like derived columns defined in the Data Editor, computed in Glide's layer, **never written back to the source**:

- **Math**, **Template** (string interpolation), **If→Then→Else**, **Relation** (single/multiple; the VLOOKUP replacement), **Lookup** (pull a column through a relation), **Rollup** (Count/Sum/Avg/Min/Max/Earliest/Latest/Count-True… over a column or relation), **Single Value**, **Joined List**, **Query** (filter/sort another table inline; on Big Tables it executes server-side and updates synchronously), **Call API** as a column, and the **AI column** family (§5).
- **User-specific columns**: a single column where _every user sees/writes their own cell value_ (favorites, per-user notes, draft form state). Lives only in Glide's layer; requires sign-in; inspectable via "Viewing as <user>" preview.
- Big Tables constraints: rollups/lookups/joined-lists through relations capped at 100 matching rows; Single Value only via Query→First — heavy aggregation is pushed to the Query column instead.

### Metering

Pricing is metered in "updates" (writes, external syncs, API calls). Reads from Big Tables/SQL/BigQuery are free. This shapes user behavior — and is the #1 billing complaint.

**Why it works:** computed columns give non-programmers a _reactive derived-data layer_ — relations, aggregations, and formatting live in the data model, not in screen logic, so every screen and workflow reuses them and they update live. The "external source mirrored into one grid + non-destructive computed overlay" model means users keep their spreadsheet while getting database semantics.

---

## 4. Layout / app builder UX

- **Data → Layout auto-generation**: importing a source instantly produces a working app — a screen per table, collection (list) view + detail screen, one component per column, sensibly typed (image column → image component). You edit _down_ from a working app rather than up from a blank canvas.
- **Layout editor**: component library (collections in multiple styles, fields, buttons, charts, forms, containers); right panel binds each component to columns; no free pixel positioning — components stack in an opinionated responsive system.
- **Visibility conditions** per component/tab, driven by any column (incl. user profile values). Docs explicitly warn: _visibility and filters are not security_ — data is still downloaded.
- **User Profiles** table (email, name, photo, **Role** column) hydrates the signed-in user context everywhere (conditions, filters, "user is signed-in user" comparisons).
- **Row Owners = real row-level security**: mark an email (or role) column as Row Owner and _Glide's servers refuse to send non-owned rows to the device_ — safe even against network inspection. Multiple owner columns = OR; array columns (Email 1..3) supported; roles-as-owners give group access. Doc guidance: enable it everywhere preemptively.
- **"Viewing as" impersonation** in both the data and layout editors previews the exact app any given user sees.

**Why it works:** two principles. (1) _Default to working_: auto-generated screens mean the first success is instant and every edit has visible feedback against real data. (2) _An opinionated design system as a feature_: reviewers consistently score Glide's out-of-box polish highest in its tier precisely because pixel control is withheld — internal-tool builders want function, and constraints guarantee professional output.

---

## 5. AI features

- **Glide AI = 10 typed primitives**, usable identically in three places (data columns, UI actions, workflow steps): Generate Text, Image to Text, Audio to Text, Document to Text, Text to Boolean, Text to Choice, Text to Date, Text to Number, Text to JSON, Text to Texts (+ "Advanced Reasoning" for Enterprise). Configuration is uniform: **Instructions** (the "how") + **Input** (the "what") + model picker on some. Note the design: most primitives are _coercions into a typed column_ — the AI must emit a boolean/date/choice/JSON, keeping outputs machine-usable downstream.
- AI columns recompute on row create/update; columns and steps chain into multi-stage pipelines (e.g., Email trigger → Document to Text → Text to Choice → Condition).
- A separate **OpenAI integration** exists for bring-your-own-key raw model access.
- **AI app generation**: prompt (+ optional CSV/Sheet/Airtable starter data, optional reference screenshot) → working app with schema, screens, role setup, and sample data; iteratively refined in the editor afterward.

**Why it works:** AI is _typed and placed_, not a chatbot bolted on. "Text to Choice" returning one of your enum values into a real column is composable with every existing condition/rollup/workflow; a free-text LLM answer would compose with nothing.

---

## 6. Publishing & distribution

- **PWA only** — publish is one click to a `*.glide.page` URL (or custom domain); installable from the browser, push notifications, partial offline. **No App Store/Play Store path** — the most cited limitation for consumer apps, a non-issue for internal tools.
- **Privacy tiers**: Public → Public with email (PIN-code email sign-in or Google) → Private with allowed email list / specific invited users / role-gated. Auto-publish toggle; invite flows built into the publish dialog.
- Auth is deliberately passwordless (emailed PIN or Google OAuth) — no password reset surface for builders to manage.

**Why it works:** distribution friction ≈ zero — "send a link" is the whole deployment story, and the same link carries the security model with it (sign-in gate + row owners), so shipping to 30 field staff takes minutes.

---

## 7. Practitioner consensus: what's exceptional, what's not

**Exceptional (recurring across reviews/community):**

- Fastest time-to-working-app in the category (minutes from a spreadsheet); auto-generation does the first 80%.
- Opinionated components → consistently polished output with zero design skill (rated above Adalo/Bubble/AppSheet on default aesthetics).
- The Data Editor: spreadsheet-familiar surface hiding real database semantics (relations, rollups, per-user data), sitting one tab away from the layout it feeds — edit data, watch the UI change live.
- Row Owners as genuinely server-enforced RLS in a no-code tool.
- Automation living inside the builder with the same data vocabulary.

**Known limitations:**

- No pixel-level design control or custom pages; PWA-only distribution.
- Update-credit pricing punishes high-write apps and external-sheet sync churn; costs scale steeply (Business $249/mo, 30-user cap, paid overages).
- Big Table computed-column caps (100-row relation aggregations) force query-column workarounds.
- Workflows: no retries, weak failure isolation, no versioning/environments/staging, 5-min schedule floor.
- Lock-in: Glide Tables and computed columns don't export cleanly.
- Fewer external sources than Softr/Noloco (no Notion/HubSpot as data sources).

---

## Top 8 aspects worth borrowing for a Frappe-based workflow product (ranked by impact)

1. **Three-primitive workflow grammar (Trigger → Action / Loop / Condition) on a visual canvas.** Frappe already has server scripts, notifications, and assignment rules scattered across DocTypes; unifying them into one canvas editor where any automation = trigger + composable {action, loop over child table/query, condition} nodes — with "Trigger Workflow" for subroutines — is the single highest-leverage move. Resist a giant node palette.

2. **Per-run history with inspectable per-step payloads.** 90-day log, red-flagged failed runs, click-through to each step's input/output JSON. Frappe's error log is developer-facing; Glide proves builder-facing run forensics is what makes non-programmers trust automation. (Opportunity: add retries/try-catch — Glide's known gap.)

3. **Computed columns as a reactive derived-data layer.** Let users add Relation / Rollup / Lookup / Template / If-Then-Else "virtual fields" to any DocType from a grid UI, evaluated on read and usable in list views, conditions, and workflow steps — without patching the schema or writing Python. This is what makes Glide's conditions and workflows expressive: the hard logic already lives in the data model.

4. **UI action and backend workflow as one continuum.** A button's on-click action should be the same artifact as a scheduled automation — same editor, same table-scoped row context. Frappe's split (client scripts vs server scripts vs Workflow doctype) is exactly the fragmentation Glide's rename-and-upgrade eliminated.

5. **Typed AI steps, not a chat box.** Ship "Text to Choice (into this Select field)", "Text to Number", "Document to Text", "Text to JSON" as columns _and_ workflow steps with uniform Instructions + Input config. Typed outputs compose with Frappe validations, link fields, and workflow conditions; free-text output composes with nothing.

6. **Data → Layout auto-generation.** From a DocType (or imported sheet), generate a working list + detail + form screen set with components mapped per-field, then let users edit down. Frappe half-does this with list/form views; the borrowable part is making the generated app feel _finished_ (opinionated components, mobile-first) rather than like scaffolding.

7. **Row Owners-style declarative row-level security.** "Mark this email/role field as owner → server never serves non-owned rows" is dramatically simpler than Frappe's User Permissions + permission-query hooks, and it's marketed honestly (docs repeat "visibility conditions are not security"). A one-toggle RLS with role-array support would be a standout.

8. **Human-in-the-Loop step.** Pause a run, send the approver a link/Slack message with preset choices, resume with the answer. Frappe has approval _states_; Glide shows approvals as a _workflow step_ — that inversion (the automation owns the approval, not the document) is what makes multi-system processes buildable by operators.

**Sources:** [Intro to Workflows](https://www.glideapps.com/docs/getting-started/introduction-to-workflows) · [Workflows beta blog](https://www.glideapps.com/blog/glide-workflows-beta) · [Introducing Workflows](https://www.glideapps.com/blog/introducing-workflows) · [New triggers & steps changelog](https://www.glideapps.com/changelog/new-workflow-triggers-and-steps) · [Glide Next: Workflows](https://www.glideapps.com/events/glide-next-workflows) · [App Interaction](https://www.glideapps.com/docs/automation/workflows/user-interaction) · [Actions](https://www.glideapps.com/docs/actions) · [Computed Columns](https://www.glideapps.com/docs/computed-columns) · [Big Tables](https://www.glideapps.com/docs/big-tables) · [Call API](https://www.glideapps.com/docs/call-api) · [Row Owners](https://www.glideapps.com/docs/essentials/security-and-user-data/row-owners) · [User-specific columns](https://www.glideapps.com/docs/user-specific-columns) · [Data Sources](https://www.glideapps.com/docs/data-sources) · [Glide AI](https://www.glideapps.com/docs/automation/ai) · [Integrations](https://www.glideapps.com/docs/automation/integrations) · [Publishing](https://www.glideapps.com/docs/sharing) · [Troubleshooting Workflows](https://www.glideapps.com/docs/troubleshooting-workflows) · [Adalo Glide review](https://www.adalo.com/posts/glide-review/) · [Softr alternatives](https://www.softr.io/blog/glide-alternatives) · [Noloco alternatives](https://noloco.io/blog/glide-alternatives) · [Glide community: workflow error handling](https://community.glideapps.com/t/error-handling-in-workflows-conditional-actions/86831) · [Kreante AI Creator](https://www.kreante.co/post/ai-glide-creator-how-to-used-ai-to-generate-app-prototypes-from-text-descriptions-with-glide)

---

## Addendum: GlideOS (verified 2026-07-08)

Glide has since evolved into **GlideOS**, "an agentic software development platform" — apps are built from a spreadsheet, a prompt, or a file, via a chat interface. AI Creator reached its current form in Q1 2026 with multi-model routing and improved schema inference; inputs are a text description, optional starter data (CSV/Google Sheet/Airtable), and an optional reference screenshot; output is a working prototype (schema, screens, roles, sample data). This is the direct product target for Featherbase's capability 9 (AI authoring loop) — with open source and the machine-validated test loop as the differentiators. Sources: [GlideOS](https://www.glideapps.com/new) · [AI Generator](https://www.glideapps.com/research/ai-generator) · [Create With: Glide returns to spreadsheet roots](https://www.createwith.com/tool/glide/updates/glide-returns-to-its-spreadsheet-roots-with-ai-powered-app-builder)
