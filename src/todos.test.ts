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

  it("gives each to-do a different id", async () => {
    const { data: first } = await api.todos.post({ title: "First" });
    const { data: second } = await api.todos.post({ title: "Second" });
    expect(first?.id).not.toBe(second?.id);
  });

  it("rejects an empty title", async () => {
    const { status } = await api.todos.post({ title: "" });
    expect(status).toBe(422);
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

describe("PATCH /todos/:id", () => {
  it("edits the title", async () => {
    const { data: created } = await api.todos.post({ title: "Draft" });
    const { status, data } = await api.todos({ id: created!.id }).patch({ title: "Final" });
    expect(status).toBe(200);
    expect(data).toEqual({ ...created!, title: "Final" });
  });

  it("completes a to-do", async () => {
    const { data: created } = await api.todos.post({ title: "Pay bills" });
    const { status, data } = await api.todos({ id: created!.id }).patch({ completed: true });
    expect(status).toBe(200);
    expect(data).toEqual({ ...created!, completed: true });
  });

  it("returns 404 for an unknown id", async () => {
    const { status } = await api.todos({ id: 999_999 }).patch({ title: "Nope" });
    expect(status).toBe(404);
  });
});
