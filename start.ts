const welcomePage = "<!doctype html><title>Featherbase</title><h1>Welcome to Featherbase</h1>";

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch: () => html(welcomePage),
});

function html(page: string) {
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
}
