import { Database } from "bun:sqlite";
import { treaty } from "@elysiajs/eden";
import { beforeEach, describe, expect, it } from "bun:test";
import { createApp } from "./app";

const freshApi = () => treaty(createApp(new Database(":memory:")));

let api: ReturnType<typeof freshApi>;
beforeEach(() => {
  api = freshApi(); // every test starts with its own empty database
});

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

describe("GET /todos?filter=", () => {
  it("lists only active to-dos", async () => {
    const { data: open } = await api.todos.post({ title: "Open" });
    const { data: done } = await api.todos.post({ title: "Done" });
    await api.todos({ id: done!.id }).patch({ completed: true });

    const { data } = await api.todos.get({ query: { filter: "active" } });
    expect(data).toContainEqual(open);
    expect(data!.every((todo) => !todo.completed)).toBe(true);
  });

  it("lists only completed to-dos", async () => {
    const { data: done } = await api.todos.post({ title: "Finished" });
    const { data: completed } = await api.todos({ id: done!.id }).patch({ completed: true });

    const { data } = await api.todos.get({ query: { filter: "completed" } });
    expect(data).toContainEqual(completed);
    expect(data!.every((todo) => todo.completed)).toBe(true);
  });

  it("rejects an unknown filter", async () => {
    // @ts-expect-error: deliberately invalid, to prove the server rejects it
    const { status } = await api.todos.get({ query: { filter: "nope" } });
    expect(status).toBe(422);
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

  it("rejects an empty update", async () => {
    const { data: created } = await api.todos.post({ title: "Keep me" });
    const { status } = await api.todos({ id: created!.id }).patch({});
    expect(status).toBe(422);
  });

  it("returns 404 for an unknown id", async () => {
    const { status } = await api.todos({ id: 999_999 }).patch({ title: "Nope" });
    expect(status).toBe(404);
  });
});

describe("DELETE /todos/:id", () => {
  it("deletes a to-do", async () => {
    const { data: created } = await api.todos.post({ title: "Temporary" });
    const { status } = await api.todos({ id: created!.id }).delete();
    expect(status).toBe(204);
    const { data: list } = await api.todos.get();
    expect(list).not.toContainEqual(created);
  });

  it("returns 404 for an unknown id", async () => {
    const { status } = await api.todos({ id: 999_999 }).delete();
    expect(status).toBe(404);
  });
});

describe("DELETE /todos/completed", () => {
  it("clears completed to-dos and keeps active ones", async () => {
    const { data: open } = await api.todos.post({ title: "Still open" });
    const { data: done } = await api.todos.post({ title: "All done" });
    await api.todos({ id: done!.id }).patch({ completed: true });

    const { status } = await api.todos.completed.delete();
    expect(status).toBe(204);

    const { data: remaining } = await api.todos.get();
    expect(remaining).toContainEqual(open);
    expect(remaining!.some((todo) => todo.completed)).toBe(false);
  });
});
