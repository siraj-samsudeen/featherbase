# Project 1 — Learn Elysia JS: build a to-do app step by step

Each step adds one real-world feature on top of the last one.

## Stack

- **Backend:** Bun + Elysia + TypeScript
- **Database:** SQLite + Drizzle ORM, with migrations
- **Frontend:** React + Vite, calling the API through Eden Treaty so the API
  calls are fully typed
- **Tests:** `bun test`. Every step comes with tests.
- **Layout:** one monorepo — `apps/api` and `apps/web`

## Workflow

- Each step is one PR into `elysia-learning` (this repo's `main` belongs to a
  different project, so `elysia-learning` plays the role of main).
- CI (tests + typecheck) must be green.
- Once it's green, merge it and move on to the next step. Reviews happen
  afterwards, without blocking.
- Fix review comments in a small follow-up PR before the current step is
  finished.

## The steps

### 0. Hello Elysia

Set up the project, add a `/health` route, write the first test, and set up CI.

### 1a. To-do API

Like TodoMVC (todomvc.com): add, edit, complete and delete to-dos, filter by
all / active / completed, and clear completed ones. Validate input, and return
proper 400/404 errors.

### 1b. To-do UI

A React frontend for 1a, using Eden Treaty.

### 2. Projects

A to-do can belong to a project or to none ("Inbox"). When a project is
deleted, the user chooses whether its to-dos are deleted too or moved to the
Inbox.

### 3. Users and sign-in

Sign up, log in and log out, with hashed passwords and cookie sessions. Every
to-do and project is visible to all signed-in users, and each one shows who
created it.

### 4. Personal vs shared

To-dos and projects can be personal (only the owner sees them) or shared
(everyone sees them). A to-do inside a personal project is always personal.
Test that another user gets a 404 on someone else's personal items.
**This is the most important step.**

### 5. Comments

Anyone who can see a to-do can comment on it. Only the author can edit or
delete their comment. Reuse the visibility rules from step 4 here.

### 6. Subtasks

One level deep only. Show progress like "2/5 done". When the parent is
completed, ask whether to complete its subtasks too.

### 7. Bonus: migrate to Postgres

Move the database from SQLite to Postgres. Switch the Drizzle driver and the
schema types, and create the migrations again. Then get every test passing
against Postgres. Pay attention to how dates, booleans and auto-increment IDs
differ between the two databases.
