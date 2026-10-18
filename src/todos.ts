import type { Database } from "bun:sqlite";
import { Elysia, t } from "elysia";

type Todo = { id: number; title: string; completed: boolean };
type Row = { id: number; title: string; completed: number };

const toTodo = (row: Row): Todo => ({ ...row, completed: row.completed === 1 });

const where = {
  all: "",
  active: "WHERE completed = 0",
  completed: "WHERE completed = 1",
};

const title = t.String({ minLength: 1 });

export const createTodos = (db: Database) => {
  db.run(`CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0
  )`);

  return new Elysia({ prefix: "/todos" })
    .model({
      "todo.id": t.Object({ id: t.Number() }),
      "todo.create": t.Object({ title }),
      "todo.update": t.Object(
        { title: t.Optional(title), completed: t.Optional(t.Boolean()) },
        { minProperties: 1 },
      ),
    })
    .get(
      "/",
      ({ query }) =>
        db
          .query<Row, []>(`SELECT * FROM todos ${where[query.filter ?? "all"]} ORDER BY id`)
          .all()
          .map(toTodo),
      { query: t.Object({ filter: t.Optional(t.UnionEnum(["all", "active", "completed"])) }) },
    )
    .post(
      "/",
      ({ body, status }) => {
        const row = db
          .query<Row, { $title: string }>("INSERT INTO todos (title) VALUES ($title) RETURNING *")
          .get({ $title: body.title })!;
        return status(201, toTodo(row));
      },
      { body: "todo.create" },
    )
    .patch(
      "/:id",
      ({ params, body, status }) => {
        const row = db
          .query<Row, { $id: number; $title: string | null; $completed: number | null }>(
            `UPDATE todos
             SET title = COALESCE($title, title), completed = COALESCE($completed, completed)
             WHERE id = $id RETURNING *`,
          )
          .get({
            $id: params.id,
            $title: body.title ?? null,
            $completed: body.completed === undefined ? null : Number(body.completed),
          });
        if (!row) return status(404, "Not found");
        return toTodo(row);
      },
      { params: "todo.id", body: "todo.update" },
    )
    .delete("/completed", ({ status }) => {
      db.run("DELETE FROM todos WHERE completed = 1");
      return status(204);
    })
    .delete(
      "/:id",
      ({ params, status }) => {
        const deleted = db
          .query<{ id: number }, { $id: number }>("DELETE FROM todos WHERE id = $id RETURNING id")
          .get({ $id: params.id });
        if (!deleted) return status(404, "Not found");
        return status(204);
      },
      { params: "todo.id" },
    );
};
