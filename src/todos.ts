import { Elysia, t } from "elysia";

type Todo = { id: number; title: string; completed: boolean };

const store: Todo[] = [];
let nextId = 1;

export const todos = new Elysia({ prefix: "/todos" })
  .get("/", () => store)
  .post(
    "/",
    ({ body, status }) => {
      const todo = { id: nextId++, title: body.title, completed: false };
      store.push(todo);
      return status(201, todo);
    },
    { body: t.Object({ title: t.String({ minLength: 1 }) }) },
  )
  .patch(
    "/:id",
    ({ params, body, status }) => {
      const todo = store.find((todo) => todo.id === params.id);
      if (!todo) return status(404, "Not found");
      todo.title = body.title;
      return todo;
    },
    {
      params: t.Object({ id: t.Number() }),
      body: t.Object({ title: t.String({ minLength: 1 }) }),
    },
  );
