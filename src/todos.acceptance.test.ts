import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";

const freshDbFile = () => join(mkdtempSync(join(tmpdir(), "todos-")), "todos.sqlite");

const create = (title: string) =>
  new Request("http://localhost/todos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });

// @spec created-to-dos-are-listed
test("a to-do created before a restart is listed after it, not done", async () => {
  const dbFile = freshDbFile();
  const created = await createApp(dbFile).handle(create("Buy milk"));
  expect(created.status).toBe(201);

  // A new app on the same file is what a restart looks like to the data.
  const listed = await createApp(dbFile).handle(new Request("http://localhost/todos"));
  expect(await listed.json()).toEqual([{ id: 1, title: "Buy milk", done: false }]);
});

// @spec created-to-dos-are-listed
test("to-dos are listed in the order they were created", async () => {
  const app = createApp(freshDbFile());
  await app.handle(create("Buy milk"));
  await app.handle(create("Pay rent"));

  const listed = await app.handle(new Request("http://localhost/todos"));
  const titles = ((await listed.json()) as { title: string }[]).map((todo) => todo.title);
  expect(titles).toEqual(["Buy milk", "Pay rent"]);
});
