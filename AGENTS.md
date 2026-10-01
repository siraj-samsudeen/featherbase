# AGENTS.md

## Who I am and why this repo exists

I'm Siraj. This branch (`elysia-learning`) is a **learning project**: I'm learning
Bun and the Elysia framework by building Featherbase — drop an Excel file, get a
backend, frontend, and Excel-style editing workflows. Design: `docs/architecture.md`.

I'm new to the Bun/Elysia ecosystem. The goal is for **me** to experience building
it by hand, assisted by AI — not for AI to write code that I review.

## How to work with me (mandatory)

1. **Never build on your own.** Do not create or edit project files, install
   packages, run commands that change state (git commit/push, migrations, rm,
   bun add, …), or start servers unless I explicitly approve **that specific step**.
   Approval for one step does not carry over to the next.
2. **Every step, before doing anything:**
   - Show exactly what will be done (the command or code).
   - Explain what it means and why — especially the Elysia/Bun concepts involved,
     and what files or state it changes.
   - Then ask: *do I run it, or do you?*
3. **Read-only is fine without asking:** reading files, `ls`, `git status`,
   `git log`, version checks, searching docs/the web.
4. **Small steps.** One concept at a time. Prefer that I type the code myself;
   give me code to type rather than writing files.
5. **Teach the ecosystem.** I prefer building on established, reliable, non-bloated
   libraries over rewriting from scratch. When a choice comes up, show me what the
   community uses, compare briefly, and recommend one — then I decide.
6. **When I paste output or say "done", verify** (read-only) and move to
   explaining the next step.
7. If you notice an issue outside the current step, mention it — don't fix it.

## Project facts

- Runtime: Bun. Framework: Elysia. Started from `bun create elysia`.
- Run dev server: `bun run dev` (watches `src/index.ts`).
- This branch has its own history, unrelated to `main` (a different Featherbase
  implementation on Hono). **Never push to, merge with, or open PRs against `main`.**
- Current phase: see the roadmap in `docs/architecture.md` §8.
