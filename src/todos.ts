import { Elysia, t } from "elysia";

type Todo = { id: number; title: string; completed: boolean };

const filters = {
  all: () => true,
  active: (todo: Todo) => !todo.completed,
  completed: (todo: Todo) => todo.completed,
};

const title = t.String({ minLength: 1 });

export const createTodos = () => {
  let store: Todo[] = [];
  let nextId = 1;

  return new Elysia({ prefix: "/todos" })
    .model({
      "todo.id": t.Object({ id: t.Number() }),
      "todo.create": t.Object({ title }),
      "todo.update": t.Object(
        { title: t.Optional(title), completed: t.Optional(t.Boolean()) },
        { minProperties: 1 },
      ),
    })
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
      { body: "todo.create" },
    )
    .patch(
      "/:id",
      ({ params, body, status }) => {
        const todo = store.find((todo) => todo.id === params.id);
        if (!todo) return status(404, "Not found");
        return Object.assign(todo, body);
      },
      { params: "todo.id", body: "todo.update" },
    )
    .delete("/completed", ({ status }) => {
      store = store.filter((todo) => !todo.completed);
      return status(204);
    })
    .delete(
      "/:id",
      ({ params, status }) => {
        if (!store.some((todo) => todo.id === params.id)) return status(404, "Not found");
        store = store.filter((todo) => todo.id !== params.id);
        return status(204);
      },
      { params: "todo.id" },
    );
};
