# Rebuild capability ledger

This ledger gives every capability folder under `openspec/specs/` a verdict for the rebuild in `core/`.
Date: 19-Nov-2026. It covers 91 capabilities and 1006 requirements.
The verdicts are a first pass by an agent, for the owner to review. None is a decision yet.
Each verdict comes from the spec's Purpose and requirement titles, set against the stated purpose: drop an Excel file, get a Table, an API and screens.
Evidence is what the four shipped apps declare and call: Tasker, Tickets, Dash and Assets (the `equipment` folder). Dash is in production, so nothing Dash relies on is parked.

## Counts

- **Core now**: 12 capabilities, 298 requirements
- **Rethink**: 13 capabilities, 175 requirements
- **Carry later**: 56 capabilities, 465 requirements
- **Park**: 10 capabilities, 68 requirements

Of Carry later, 37 capabilities (219 requirements) are app promises, not platform promises. They move when their app is ported.

## Core now

Part of the core loop or its direct support. Ordered from most fundamental to least.

- **tables-and-fields** (57 requirements): A builder makes Tables with typed columns, and changes them later. All four apps are built from Tables. Core already has it.
- **permissions-and-roles** (22 requirements): Roles decide what each person can see and do. All four apps declare roles and permissions. This becomes the one access gate.
- **sign-in-and-accounts** (64 requirements): People sign in, and admins manage accounts, sessions and View as. Every app needs it. Core has sign-in; Dash also uses View as.
- **list-view** (35 requirements): Every Table gets a list with filters, sorting and editing. The "screens people can edit in" half of the core loop.
- **core-forms** (31 requirements): Every Table gets one form to open, create and edit rows. Part of the core loop. Rebuilt as server-rendered pages.
- **spreadsheet-import** (31 requirements): Bring rows from a CSV or Excel file into a Table. The core loop starts here. Core already has it, with type suggestion.
- **import-history-and-undo** (12 requirements): Each import can be looked back on and undone. Core already has import history, rows-to-fix and undo.
- **naming-and-numbering** (13 requirements): Every row gets an id from a pattern the builder chooses. All four apps set an id pattern on their Tables.
- **row-deletion** (15 requirements): Deleting a row is confirmed, checked and recorded. Direct support for rows. Core already has trash, which the old spec lacks.
- **table-deletion** (8 requirements): Deleting a Table removes it fully, after clear warnings. Direct support for Tables made at runtime.
- **comments-and-history** (5 requirements): A row carries comments and a history of its changes. Core already has both. Tasker and Dash read history.
- **app-management** (5 requirements): Admins inspect, choose and install apps on an instance. Needed to install any app. Dash and Tickets declare instance settings through it.

## Rethink

The need is real, but the new design replaces how it works. Do not port the old behaviour as written.

- **trusted-runtime-packages** (43 requirements): Apps install, upgrade and turn off without harming other apps. All four apps ship versions and migration steps. New design: packages and declarative upgrades.
- **transactional-runtime-actions** (15 requirements): An app offers named actions that write in one transaction. All four apps declare actions. New design: actions are one thing a package contributes.
- **app-roles-store-access** (13 requirements): App roles and store limits decide who reads and acts. Dash uses it through its scope provider. New design: one access gate.
- **mandatory-work-privacy** (3 requirements): Private work stays with admitted people, even from admins. Tasker and Assets set an access policy on Tables. Must fit the one access gate.
- **metadata-override-validation** (3 requirements): Table and column customisations apply cleanly or are refused clearly. No app uses it. New design: packages add fields to other Tables.
- **running-an-instance** (38 requirements): Safe releases, operator commands, limits and live page updates. Dash runs in production on it. Upgrades become declarative; core has its own deploy.
- **record-workspace** (7 requirements): A row's page keeps attention on the row and its work. Dash and Tickets map record pages. New design: packages add sections to record pages.
- **app-navigation** (3 requirements): People move between apps through one shared sidebar and bar. All apps sit in this chrome. It is React today; rebuilt on the server.
- **table-addresses** (5 requirements): Tables and rows have readable web addresses that stay stable. Need is real. Addresses are set again by the new server-rendered routes.
- **admin-ui-feedback** (16 requirements): Search bar, shortcuts, sidebar and theme behaviour in the Admin. Tied to the React Admin screens. No app depends on it.
- **dashboards-and-home-pages** (16 requirements): Home pages group links; dashboards show live numbers and charts. Home and navigation are needed. No app uses number cards or charts.
- **usable-on-any-device** (9 requirements): Every screen works on phone, by keyboard, with clear states. Applies to every screen, so it is rewritten for the new screens. Desktop first today.
- **native-prototype-library** (4 requirements): People explore working screen examples with made-up data. Dash keeps a prototype folder. The library is React components, which go away.

## Carry later

Needed to build ERP, CRM and data clean-up apps, but not in the first iterations.


### Platform

- **external-data-sources** (51 requirements): A Table can show data that lives in another database. Dash reads the warehouse through five MotherDuck datasets.
- **workflow-and-approvals** (16 requirements): Rows move through states; a change can wait for approval. Dash uses approvals for every correction. No app uses workflow states.
- **row-retirement** (13 requirements): A row is taken out of use without deleting it. Dash and Assets both read retired rows.
- **access-explanation** (6 requirements): One page says what a person can see, and why. Dash declares its own Why answer for a person.
- **actor-names** (2 requirements): Screens name who did something, to those allowed to see. Dash declares how it describes people.
- **instance-settings** (13 requirements): An instance's settings live in one reviewed file. The Dash production instance keeps its settings and data source in this file.
- **instance-health** (9 requirements): System Managers see whether the instance is set up and working. It checks the Tables behind Dash store access. Useful once apps run on core.
- **background-and-scheduled-jobs** (19 requirements): Long work runs in the background or on a schedule. Tasker declares two scheduled jobs. Copied tables need it to stay fresh.
- **notifications-email-and-webhooks** (14 requirements): Email people and call other systems when rows change. Tickets emails the person a ticket is assigned to. No app uses webhooks.
- **files-and-sharing** (10 requirements): Uploaded files are rows that follow the access of their row. Tasker and Assets attach evidence files to rows.
- **access-tokens** (16 requirements): Scripts and service accounts sign in with a personal token. Dash has a service account setting for embedded reports. Agents need tokens.
- **agent-access** (21 requirements): An AI agent reads and changes rows as its user. No app needs it, but the owner loads data through it. Fits the data clean-up purpose.
- **agent-sign-in** (6 requirements): An agent connects by the instance address, allowed once. Goes with agent-access. No app uses it.
- **master-data-sync** (4 requirements): A master Table stays in step with its source system. No app declares it. It serves data clean-up, and needs data sources first.
- **table-merge** (5 requirements): Two Tables that are the same thing can be merged. No app uses it. It is a data clean-up tool, so it fits the purpose.
- **table-views** (8 requirements): A view is a named filter on one Table. No app manifest declares one. Useful for master data, such as sites that are stores.
- **saved-views** (7 requirements): A list remembers its filters under a name. No app uses the platform one; Tasker built its own. Follows lists and filters.
- **search-and-explore** (20 requirements): Search, Explore and the relationship map across readable Tables. No app depends on it. Search is needed; Explore and the map may not be.
- **account-switcher** (6 requirements): One browser holds several signed-in accounts and switches between them. No app uses it. Built recently on request (#1255), so not a Frappe leftover.

### App: Dash

- **business-roles** (19 requirements): Business positions bring apps and permissions to each person. App: Dash. Dash decides access with it. Port when Dash moves.
- **feather-dash-people** (8 requirements): Dash holds who works for the group, in which stints. App: Dash. Its people and job Tables.
- **dash-reports** (12 requirements): Dash opens warehouse reports limited to what each reader reaches. App: Dash. Needs data sources and embedded MotherDuck Dives.
- **report-access** (4 requirements): Managers give Dash reports to people, within their own reach. App: Dash.
- **my-sections** (6 requirements): A person sees what is mapped to them and corrects it. App: Dash. Corrections go through approvals.
- **sales-target-report** (28 requirements): Each store employee sees sales against target on one page. App: Dash. Reads the warehouse datasets.

### App: Assets

- **asset-register** (7 requirements): One register of the group's physical assets. App: Assets (the equipment folder).
- **asset-custody-and-transfers** (8 requirements): Who holds each asset, and how it is handed over. App: Assets.
- **asset-repair-jobs** (7 requirements): Reported faults become repair jobs with a fix-by time. App: Assets.
- **asset-verification-counts** (8 requirements): Blind counts of a site's assets against an expected list. App: Assets.
- **asset-labels** (2 requirements): Printed tag labels with a tag number and QR code. App: Assets. It prints from the browser, not through the platform printing.
- **jeyarama-assets-tagging** (6 requirements): A fresh tagged inventory with one permanent tag series. App: Assets.

### App: Tasker

- **tasker-quick-task-capture** (1 requirements): Anyone writes a task down the moment it comes to mind. App: Tasker.
- **tasker-process-inbox-items** (3 requirements): Private captures wait in an Inbox to be organised. App: Tasker.
- **tasker-start-a-project** (3 requirements): A project is a named, shared group of tasks. App: Tasker.
- **tasker-reorganize-projects** (1 requirements): A project's name can be fixed without recreating it. App: Tasker.
- **tasker-star-projects** (2 requirements): A person stars projects so they show as tabs. App: Tasker.
- **tasker-shared-team-work** (5 requirements): Admitted members share projects and team work. App: Tasker.
- **tasker-responsibility-and-progress** (5 requirements): Each task says who is responsible and how far along. App: Tasker.
- **tasker-subtasks** (4 requirements): A task is broken into smaller pieces of work. App: Tasker.
- **tasker-due-dates** (3 requirements): A task carries start and due dates, and shows late work. App: Tasker.
- **tasker-plan-my-work** (6 requirements): Each person picks tasks into a private, ordered My Focus. App: Tasker.
- **tasker-review-team-workload** (1 requirements): Together shows active work grouped by who is responsible. App: Tasker.
- **tasker-find-and-reuse-task-view** (6 requirements): Search and filter task lists, and save the view. App: Tasker. It has its own saved views.
- **tasker-use-task-details** (3 requirements): Opening a task shows its details, discussion and history. App: Tasker. Reads row history.
- **tasker-use-workspace** (2 requirements): The Tasker workspace works the same way on every page. App: Tasker.
- **tasker-discussions** (6 requirements): A task's updates, questions and replies stay together. App: Tasker.
- **tasker-recurring-tasks** (6 requirements): Useful work repeats on a schedule or after completion. App: Tasker. Needs scheduled jobs.
- **tasker-verified-closure** (6 requirements): Work closes only after someone else has checked it. App: Tasker. Evidence files are attached to the task.
- **tasker-stores** (5 requirements): Work is tied to the store it is for. App: Tasker.
- **tasker-issues** (5 requirements): Problems raised in a store are tracked as issues. App: Tasker.

### App: Tickets

- **tickets-workspace** (5 requirements): Tickets sits inside the shared chrome, queue first. App: Tickets. Uses record pages.
- **tickets-type-transitions** (5 requirements): A ticket type says how its tickets move between states. App: Tickets. Its own state rules, not the platform workflow.
- **tickets-assignees** (2 requirements): Who may be assigned a ticket, apart from support rights. App: Tickets.
- **tickets-assignment-email** (5 requirements): Assigning a ticket emails the assignee after the save. App: Tickets. Needs platform email.
- **tickets-raiser** (6 requirements): A ticket's raiser is protected and can be corrected. App: Tickets.
- **tickets-data-quality-rules** (8 requirements): One rule and one ticket describe a master-data gap. App: Tickets. Reads other Tables. A data clean-up feature.

## Park

Peripheral to the stated purpose, and no shipped app relies on it.

- **printing** (6 requirements): Any row prints as a clean page or PDF. No app uses it. Assets prints labels from the browser itself. Not the purpose.
- **web-forms-and-portal** (8 requirements): Public forms and pages for people who are not signed in. No app uses it. Not a forms product or a public website.
- **reports-and-charts** (15 requirements): Summaries, script reports, charts and emailed reports from a Table. No app uses it. Dash shows warehouse reports as MotherDuck Dives.
- **board-calendar-and-timeline-views** (8 requirements): A Table's rows shown as a board, calendar or timeline. No app uses it. Tasker draws its own task screens.
- **checklists** (7 requirements): A Table whose rows each carry items to tick off. No app uses it.
- **assignments-tags-and-rules** (7 requirements): Assign, tag, auto-assign and script rows. No app uses it. Tickets keeps its own assignees.
- **glossary** (8 requirements): Apps ship their terms; help shows where the word appears. No app manifest ships any terms.
- **keyboard-shortcuts** (5 requirements): Quiet tips teach each person the keyboard shortcuts. No app uses it. Tied to the React Admin.
- **personal-preferences** (2 requirements): A person's chosen language follows them across devices. No app has translations.
- **captured-email-reading** (2 requirements): Email captured on a local machine can be read. A development aid. No app uses it. Comes back only with email.

## Doubtful calls

- **workflow-and-approvals**: Dash uses only approvals. Should approvals be carried alone, and workflow states parked?
- **dashboards-and-home-pages**: no app uses number cards or charts. Keep only home pages, and park dashboards?
- **reports-and-charts**: parked because Dash uses Dives. Will ERP and CRM apps need summaries of their own Tables?
- **comments-and-history**: marked Core now because core already has it. Is the built version enough, or does the old spec still apply?
- **row-deletion**: the old spec says deletion is permanent, but core has trash. Which one is the promise now?
- **trusted-runtime-packages**: 43 requirements under Rethink. Which survive as they are, such as "an app cannot harm another app"?
- **app-roles-store-access**: Dash access rests on its store limits. Do they become rules in the one access gate, or stay Dash's own?
- **search-and-explore**: search is clearly needed. Are Explore and the relationship map wanted in the rebuild?
- **agent-access** and **agent-sign-in**: should agents come early, since loading and clean-up already run through them?
- **account-switcher**: built recently on request, yet no app needs it. Carry later, or park?
- **glossary** and **keyboard-shortcuts**: parked for lack of use, but both are the owner's own designs, not Frappe's. Keep them?
- **table-views** and **master-data-sync**: no app manifest declares either. Does the Dash instance rely on them through its settings?
