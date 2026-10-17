import { Elysia, t } from "elysia";

type Todo = { id: number; title: string; completed: boolean };

let store: Todo[] = [];
let nextId = 1;

const filters = {
  all: () => true,
  active: (todo: Todo) => !todo.completed,
  completed: (todo: Todo) => todo.completed,
};

export const todos = new Elysia({ prefix: "/todos" })
  .get("/", ({ query }) => store.filter(filters[query.filter ?? "all"]), {
    query: t.Object({ filter: t.Optional(t.UnionEnum(["all", "active", "completed"])) }),
  })
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
      return Object.assign(todo, body);
    },
    {
      params: t.Object({ id: t.Number() }),
      body: t.Object(
        {
          title: t.Optional(t.String({ minLength: 1 })),
          completed: t.Optional(t.Boolean()),
        },
        { minProperties: 1 },
      ),
    },
  )
  .delete(
    "/:id",
    ({ params, status }) => {
      if (!store.some((todo) => todo.id === params.id)) return status(404, "Not found");
      store = store.filter((todo) => todo.id !== params.id);
      return status(204);
    },
    { params: t.Object({ id: t.Number() }) },
  );
