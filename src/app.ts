import { Elysia } from "elysia";
import { createTodos } from "./todos";

export const createApp = () =>
  new Elysia()
    .get("/", () => "Hello Elysia, Siraj")
    .get("/health", () => ({ status: "ok" }))
    .use(createTodos());

export const app = createApp();
