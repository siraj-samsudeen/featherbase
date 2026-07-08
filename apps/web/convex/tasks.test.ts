import { expect } from "vitest";
import { test } from "./test.setup";
import { api } from "./_generated/api";

// Matrix rows B1–B6 (docs/capabilities/1-scaffold/2_spec.md)

test("returns empty list for a new user", async ({ client }) => {
  const tasks = await client.query(api.tasks.list, {});
  expect(tasks).toEqual([]);
});

test("returns the seeded task", async ({ client, seed }) => {
  await seed("tasks", { text: "Buy milk", completed: false });

  const tasks = await client.query(api.tasks.list, {});
  expect(tasks).toHaveLength(1);
  expect(tasks[0]?.text).toBe("Buy milk");
  expect(tasks[0]?.completed).toBe(false);
});

test("scopes tasks to their owner", async ({ client, seed, createUser }) => {
  const bob = await createUser();
  await seed("tasks", {
    text: "Bob's task",
    completed: false,
    userId: bob.userId,
  });

  const myTasks = await client.query(api.tasks.list, {});
  expect(myTasks).toHaveLength(0);

  const bobTasks = await bob.query(api.tasks.list, {});
  expect(bobTasks).toHaveLength(1);
  expect(bobTasks[0]?.text).toBe("Bob's task");
});

test("adds a task for the caller", async ({ client }) => {
  await client.mutation(api.tasks.add, { text: "  Ship capability 1  " });

  const tasks = await client.query(api.tasks.list, {});
  expect(tasks).toHaveLength(1);
  expect(tasks[0]?.text).toBe("Ship capability 1");
  expect(tasks[0]?.completed).toBe(false);
});

test("rejects blank task text", async ({ client }) => {
  await expect(client.mutation(api.tasks.add, { text: "   " })).rejects.toThrow(
    "Task text cannot be empty",
  );
});

test("rejects unauthenticated add", async ({ testClient }) => {
  await expect(
    testClient.mutation(api.tasks.add, { text: "Sneaky task" }),
  ).rejects.toThrow("Not authenticated");
});

test("returns empty list when unauthenticated", async ({ testClient }) => {
  const tasks = await testClient.query(api.tasks.list, {});
  expect(tasks).toEqual([]);
});
