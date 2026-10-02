import { Elysia } from "elysia";

const app = new Elysia()
  .get("/", () => "Hello Elysia, Siraj")
  .get("/about", () => ({
    name: "featherbase",
    framework: "elysia",
  }))
  .get("/hello/:name", ({ params }) => `Hello, ${params.name}!`)
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
