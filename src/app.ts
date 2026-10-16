import { Elysia } from "elysia";
import { todos } from "./todos";

export const app = new Elysia()
  .get("/", () => "Hello Elysia, Siraj")
  .get("/health", () => ({ status: "ok" }))
  .use(todos);
