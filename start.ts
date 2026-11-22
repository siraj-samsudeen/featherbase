import { Elysia } from "elysia";

const welcomePage = "<!doctype html><title>Featherbase</title><h1>Welcome to Featherbase</h1>";
const notFoundPage = "<!doctype html><title>Page not found</title><h1>Page not found</h1>";

new Elysia()
  .get("/", () => html(welcomePage))
  .onError(({ code }) => {
    if (code === "NOT_FOUND") return html(notFoundPage, 404);
  })
  .listen(Number(process.env.PORT ?? 3000));

function html(page: string, status = 200) {
  return new Response(page, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
