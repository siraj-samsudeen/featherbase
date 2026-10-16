import { Elysia, t } from "elysia";

type Todo = { id: number; title: string; completed: boolean };

const store: Todo[] = [];

export const todos = new Elysia({ prefix: "/todos" })
  .get("/", () => store)
  .post(
    "/",
    ({ body, status }) => {
      const todo = { id: 1, title: body.title, completed: false };
      store.push(todo);
      return status(201, todo);
    },
    { body: t.Object({ title: t.String() }) },
  );
