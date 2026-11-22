import { html } from "@elysiajs/html";
import { Elysia } from "elysia";

const welcomePage = "<!doctype html><title>Featherbase</title><h1>Welcome to Featherbase</h1>";
const notFoundPage = "<!doctype html><title>Page not found</title><h1>Page not found</h1>";

new Elysia()
  .use(html())
  .get("/", () => welcomePage)
  .onError(({ code }) => {
    if (code === "NOT_FOUND") return notFoundPage;
  })
  .listen(Number(process.env.PORT ?? 3000));
