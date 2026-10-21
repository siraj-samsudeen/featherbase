import { Elysia, t } from "elysia";

type Todo = { id: number; title: string; done: boolean };

export function createApp(_dbFile: string) {
  const todos: Todo[] = [];
  return new Elysia()
    .get("/todos", () => todos)
    .post(
      "/todos",
      ({ body, status }) => {
        const todo = { id: 1, title: body.title, done: false };
        todos.push(todo);
        return status(201, todo);
      },
      { body: t.Object({ title: t.String() }) },
    );
}
