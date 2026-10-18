import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { createTodos } from "./todos";

export const createApp = (db: Database) =>
  new Elysia()
    .get("/", () => "Hello Elysia, Siraj")
    .get("/health", () => ({ status: "ok" }))
    .use(createTodos(db));

export const app = createApp(new Database(":memory:"));

export type App = ReturnType<typeof createApp>;
