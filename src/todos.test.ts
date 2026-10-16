import { treaty } from "@elysiajs/eden";
import { describe, expect, it } from "bun:test";
import { app } from "./app";

const api = treaty(app);

describe("POST /todos", () => {
  it("creates a to-do", async () => {
    const { status, data } = await api.todos.post({ title: "Buy milk" });
    expect(status).toBe(201);
    expect(data).toMatchObject({ title: "Buy milk", completed: false });
    expect(data?.id).toBeNumber();
  });
});

describe("GET /todos", () => {
  it("lists created to-dos", async () => {
    const { data: created } = await api.todos.post({ title: "Walk the dog" });
    const { status, data } = await api.todos.get();
    expect(status).toBe(200);
    expect(data).toContainEqual(created);
  });
});
