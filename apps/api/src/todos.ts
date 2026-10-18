import type { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createSchemaFactory } from "drizzle-typebox";
import { Elysia, t } from "elysia";
import { todos } from "./schema";

const { createInsertSchema, createUpdateSchema } = createSchemaFactory({ typeboxInstance: t });

const where = {
  all: undefined,
  active: eq(todos.completed, false),
  completed: eq(todos.completed, true),
};

const refine = {
  title: (schema: ReturnType<typeof t.String>) => t.String({ ...schema, minLength: 1 }),
};

export const createTodos = (sqlite: Database) => {
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` });

  return new Elysia({ prefix: "/todos" })
    .model({
      "todo.id": t.Object({ id: t.Number() }),
      "todo.create": t.Pick(createInsertSchema(todos, refine), ["title"]),
      "todo.update": t.Omit(createUpdateSchema(todos, refine), ["id"], { minProperties: 1 }),
    })
    .get(
      "/",
      ({ query }) =>
        db.select().from(todos).where(where[query.filter ?? "all"]).orderBy(todos.id).all(),
      { query: t.Object({ filter: t.Optional(t.UnionEnum(["all", "active", "completed"])) }) },
    )
    .post(
      "/",
      ({ body, status }) =>
        status(201, db.insert(todos).values({ title: body.title }).returning().get()),
      { body: "todo.create" },
    )
    .patch(
      "/:id",
      ({ params, body, status }) => {
        const todo = db.update(todos).set(body).where(eq(todos.id, params.id)).returning().get();
        if (!todo) return status(404, "Not found");
        return todo;
      },
      { params: "todo.id", body: "todo.update" },
    )
    .delete("/completed", ({ status }) => {
      db.delete(todos).where(eq(todos.completed, true)).run();
      return status(204);
    })
    .delete(
      "/:id",
      ({ params, status }) => {
        const deleted = db.delete(todos).where(eq(todos.id, params.id)).returning().get();
        if (!deleted) return status(404, "Not found");
        return status(204);
      },
      { params: "todo.id" },
    );
};
