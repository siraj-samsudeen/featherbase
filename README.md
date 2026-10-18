# featherbase

A Bun monorepo (Bun workspaces). Currently Project 1, a to-do app
(`docs/projects/01-todo-app.md`).

| Package | Path | What |
|---|---|---|
| `@todo/api` | `apps/api` | Elysia API on SQLite (Drizzle) |

From the repo root:

```bash
bun install   # install all workspaces
bun test      # run every test
bun check     # type check
bun --filter @todo/api dev   # run the API on http://localhost:3000 (data in apps/api/todos.sqlite)
```

Database migrations (from `apps/api`):

```bash
bunx drizzle-kit generate --name <change>
```

This project was created using `bun init` in bun v1.4.3. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
