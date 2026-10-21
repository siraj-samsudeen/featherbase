import { Elysia, t } from "elysia";

export function createApp(_dbFile: string) {
  return new Elysia().post(
    "/todos",
    ({ body, status }) => status(201, { id: 1, title: body.title, done: false }),
    { body: t.Object({ title: t.String() }) },
  );
}
