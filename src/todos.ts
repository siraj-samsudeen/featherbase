import { Elysia, t } from "elysia";

export const todos = new Elysia({ prefix: "/todos" }).post(
  "/",
  ({ body, status }) => status(201, { id: 1, title: body.title, completed: false }),
  { body: t.Object({ title: t.String() }) },
);
