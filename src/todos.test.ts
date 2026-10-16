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
