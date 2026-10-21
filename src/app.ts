import { Database } from "bun:sqlite";
import { Elysia, t } from "elysia";

export function createApp(dbFile: string) {
  const db = new Database(dbFile);
  db.run("create table if not exists todos (id integer primary key, title text not null)");

  return new Elysia()
    .get("/todos", () =>
      db
        .query<{ id: number; title: string }, []>("select id, title from todos")
        .all()
        .map((row) => ({ ...row, done: false })),
    )
    .post(
      "/todos",
      ({ body, status }) => {
        const { lastInsertRowid } = db.run("insert into todos (title) values (?)", [body.title]);
        return status(201, { id: Number(lastInsertRowid), title: body.title, done: false });
      },
      { body: t.Object({ title: t.String() }) },
    );
}
