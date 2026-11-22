const welcomePage = "<!doctype html><title>Featherbase</title><h1>Welcome to Featherbase</h1>";
const notFoundPage = "<!doctype html><title>Page not found</title><h1>Page not found</h1>";

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch: (request) => (isHomeAddress(request) ? html(welcomePage) : html(notFoundPage, 404)),
});

function isHomeAddress(request: Request) {
  return new URL(request.url).pathname === "/";
}

function html(page: string, status = 200) {
  return new Response(page, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
