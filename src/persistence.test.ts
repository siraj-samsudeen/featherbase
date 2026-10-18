import { Database } from "bun:sqlite";
import { treaty } from "@elysiajs/eden";
import { describe, expect, it } from "bun:test";
import { createApp } from "./app";

describe("persistence", () => {
  it("keeps to-dos across app restarts", async () => {
    const db = new Database(":memory:");
    const before = treaty(createApp(db));
    const { data: created } = await before.todos.post({ title: "Persist me" });

    const after = treaty(createApp(db)); // a brand-new app, same database
    const { data } = await after.todos.get();
    expect(data).toContainEqual(created);
  });
});
