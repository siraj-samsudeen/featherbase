import { expect, it } from "bun:test";
import { createApp } from "./app";

const create = (title: string) =>
  new Request("http://localhost/todos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });

it("POST /todos returns 201 with the new to-do, not done", async () => {
  const res = await createApp(":memory:").handle(create("Buy milk"));
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ id: 1, title: "Buy milk", done: false });
});
