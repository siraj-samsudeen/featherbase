import { treaty } from "@elysiajs/eden";
import { expect, it } from "bun:test";
import type { App } from "@todo/api";

it("the web app gets a fully typed API client", () => {
  const api = treaty<App>("localhost:3000");
  expect(api.todos.post).toBeFunction(); // POSITIVE: a real route must type-check
  // @ts-expect-error: unknown routes must be TYPE errors
  expect(api.todos.nope).toBeDefined(); // NEGATIVE: a made-up route must not
});
